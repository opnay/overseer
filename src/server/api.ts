import { Hono, type Context } from "hono";
import type {
  ComposeBuilderProjectDetail,
  DockerDaemonConfigurationSection,
  OperationAccepted,
  PullImageInput,
  RegisterRemoteComposeInput,
  StartupInstallTarget,
  ToolUpdateId,
} from "../shared/contracts.ts";
import { parseContainerSpec, parseUpdateContainerInput } from "./container-spec.ts";
import {
  parseUpdateDockerDaemonConfigurationInput,
  parseUpdateDockerDaemonConfigurationSectionInput,
} from "./docker-daemon-configuration.ts";
import {
  parseComposeBuilderSpec,
  parseUpdateComposeBuilderInput,
} from "./compose-builder-input.ts";
import { ExpectedError } from "./errors.ts";
import { LimaDockerRuntime, type RuntimeController } from "./lima-docker-runtime.ts";
import {
  SqliteOperationHistoryStore,
  type OperationRetryMethod,
  type OperationRetryRequest,
} from "./operation-history.ts";
import { OperationQueue, type EnqueueOperation } from "./operations.ts";
import { SqliteRuntimeInstanceStore } from "./runtime-instance-store.ts";
import { deriveRemoteComposeProjectName } from "./remote-compose.ts";
import {
  parseCreateRuntimeInstanceInput,
  parseRecreateDockerEngineInput,
  parseRuntimeStartInput,
  requireRuntimeInstanceName,
} from "./runtime-configuration.ts";
import { requireLocalRequest } from "./security.ts";
import { StartupPrerequisiteService, type StartupPrerequisiteController } from "./startup.ts";
import {
  requireContainerReference,
  requireComposeUrl,
  requireImageIdentifier,
  requireImageReference,
  optionalComposeProjectName,
  requireResourceName,
} from "./validation.ts";

async function readObject(context: { req: { json: () => Promise<unknown> } }) {
  try {
    const value = await context.req.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new ExpectedError("invalid_body", "요청 본문은 객체여야 합니다.", 400);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ExpectedError) throw error;
    throw new ExpectedError("invalid_json", "JSON 요청 본문을 확인하십시오.", 400);
  }
}

const dockerDaemonSectionLabels: Record<DockerDaemonConfigurationSection, string> = {
  advanced: "고급 JSON",
  logging: "컨테이너 로그",
  network: "네트워크",
  proxy: "프록시",
  registry: "Registry",
  stability: "daemon 동작 및 진단",
  transfer: "전송",
};

async function readOptionalObject(context: Context): Promise<Record<string, unknown> | undefined> {
  const source = await context.req.text();
  if (!source.trim()) return undefined;
  try {
    const value = JSON.parse(source) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new ExpectedError("invalid_body", "요청 본문은 객체여야 합니다.", 400);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ExpectedError) throw error;
    throw new ExpectedError("invalid_json", "JSON 요청 본문을 확인하십시오.", 400);
  }
}

function requirePageNumber(value: string | undefined): number {
  if (value === undefined) return 1;
  if (!/^\d+$/.test(value)) {
    throw new ExpectedError("invalid_page", "페이지 번호를 확인하십시오.", 400);
  }
  const page = Number(value);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) {
    throw new ExpectedError("invalid_page", "페이지 번호를 확인하십시오.", 400);
  }
  return page;
}

function retryRequest(context: Context, body?: unknown): OperationRetryRequest {
  const method = context.req.method;
  if (method !== "DELETE" && method !== "PATCH" && method !== "POST") {
    throw new Error(`unsupported operation retry method: ${method}`);
  }
  const pathname = new URL(context.req.url).pathname;
  const path = pathname.startsWith("/api/") ? pathname.slice("/api".length) : pathname;
  return {
    ...(body === undefined ? {} : { body }),
    method: method as OperationRetryMethod,
    path,
  };
}

export function createApi(
  controller: RuntimeController,
  operations = new OperationQueue(),
  startup: StartupPrerequisiteController = new StartupPrerequisiteService(),
) {
  const app = new Hono();
  const enqueue = (
    context: Context,
    input: Omit<EnqueueOperation, "retryRequest">,
    body?: unknown,
    retryable = true,
  ) =>
    operations.enqueue({
      ...input,
      ...(retryable ? { retryRequest: retryRequest(context, body) } : {}),
    });

  app.use("*", requireLocalRequest);

  app.get("/health", (context) => context.json({ ok: true }));
  app.get("/startup", async (context) => context.json(await startup.getSnapshot()));
  app.get("/startup/updates", async (context) => context.json(await startup.getUpdates()));
  app.post("/startup/updates/check", (context) => {
    const operation = enqueue(context, {
      kind: "startup.update.check",
      locks: ["homebrew"],
      run: (progress) => startup.checkUpdates(progress),
      successMessage: "Docker CLI·Compose·Lima 업데이트를 확인했습니다.",
      target: { name: "Docker CLI·Compose·Lima", resource: "startup" },
      title: "도구 업데이트 확인",
    });
    return context.json({ operation }, 202);
  });
  app.post("/startup/prerequisites/:id/update", (context) => {
    const source = context.req.param("id");
    if (source !== "docker" && source !== "compose" && source !== "lima") {
      throw new ExpectedError("invalid_tool_update", "지원하지 않는 업데이트 항목입니다.", 400);
    }
    const target: ToolUpdateId = source;
    const label =
      target === "docker" ? "Docker CLI" : target === "compose" ? "Docker Compose" : "Lima";
    const operation = enqueue(
      context,
      {
        exclusive: true,
        kind: "startup.update",
        locks: ["homebrew"],
        run: (progress) => startup.update(target, progress),
        successMessage: `${label}를 업데이트했습니다.`,
        target: { id: target, name: label, resource: "startup" },
        title: `${label} 업데이트`,
      },
      undefined,
      false,
    );
    return context.json({ operation }, 202);
  });
  app.post("/startup/prerequisites/:id/install", async (context) => {
    const source = context.req.param("id");
    if (
      source !== "homebrew" &&
      source !== "docker" &&
      source !== "docker-with-compose" &&
      source !== "compose" &&
      source !== "lima"
    ) {
      throw new ExpectedError(
        "invalid_startup_prerequisite",
        "지원하지 않는 설치 항목입니다.",
        400,
      );
    }
    const target: StartupInstallTarget = source;
    const id = target === "docker-with-compose" ? "docker" : target;
    const prerequisite = (await startup.getSnapshot()).prerequisites.find(
      (candidate) => candidate.id === id,
    );
    if (!prerequisite) {
      throw new ExpectedError(
        "startup_prerequisite_not_found",
        "설치 항목 상태를 확인할 수 없습니다.",
        503,
      );
    }
    if (prerequisite.installed) {
      throw new ExpectedError(
        "startup_prerequisite_installed",
        `${prerequisite.label}는 이미 설치되어 있습니다.`,
        409,
      );
    }
    if (!prerequisite.automaticInstall) {
      throw new ExpectedError(
        "startup_manual_install_required",
        prerequisite.automaticInstallUnavailableReason ??
          "Terminal에서 설치한 뒤 상태를 다시 확인하십시오.",
        409,
      );
    }
    const operation = enqueue(context, {
      exclusive: true,
      kind: "startup.install",
      locks: ["homebrew"],
      run: (progress) => startup.install(target, progress),
      successMessage: `${target === "docker-with-compose" ? "Docker CLI와 Compose" : prerequisite.label}를 설치했습니다.`,
      target: { name: id, resource: "startup" },
      title: `${target === "docker-with-compose" ? "Docker CLI와 Compose" : prerequisite.label} 설치`,
    });
    return context.json({ operation }, 202);
  });
  app.get("/dashboard", async (context) => context.json(await controller.getDashboard()));
  app.get("/runtime/configuration", async (context) =>
    context.json(await controller.getDockerEngineConfiguration()),
  );
  app.get("/runtime/instances", async (context) =>
    context.json(await controller.getRuntimeInstances()),
  );
  app.post("/runtime/instances", async (context) => {
    const input = parseCreateRuntimeInstanceInput(await readObject(context));
    const operation = enqueue(
      context,
      {
        exclusive: true,
        kind: "runtime.start",
        locks: [],
        run: (progress) => controller.createRuntimeInstance(input, progress),
        successMessage: `${input.name} Lima 인스턴스를 만들었습니다.`,
        target: { name: input.name, resource: "runtime" },
        title: "Lima 인스턴스 만들기",
      },
      undefined,
      false,
    );
    return context.json({ operation }, 202);
  });
  app.post("/runtime/instances/:name/select", (context) => {
    const name = requireRuntimeInstanceName(context.req.param("name"));
    const operation = enqueue(context, {
      exclusive: true,
      kind: "runtime.connect",
      locks: [],
      run: (progress) => controller.selectRuntimeInstance(name, progress),
      successMessage: `${name} 인스턴스를 활성 Docker Engine으로 선택했습니다.`,
      target: { name, resource: "runtime" },
      title: "활성 인스턴스 선택",
    });
    return context.json({ operation }, 202);
  });
  app.post("/runtime/instances/:name/prepare", (context) => {
    const name = requireRuntimeInstanceName(context.req.param("name"));
    const operation = enqueue(
      context,
      {
        exclusive: true,
        kind: "runtime.connect",
        locks: [],
        run: (progress) => controller.prepareRuntimeInstance(name, progress),
        successMessage: `${name} 인스턴스를 Overseer에서 사용할 수 있게 준비했습니다.`,
        target: { name, resource: "runtime" },
        title: "Lima 인스턴스 사용 준비",
      },
      undefined,
      false,
    );
    return context.json({ operation }, 202);
  });
  app.post("/runtime/instances/:name/start", (context) => {
    const name = requireRuntimeInstanceName(context.req.param("name"));
    const operation = enqueue(context, {
      exclusive: true,
      kind: "runtime.start",
      locks: [],
      run: (progress) => controller.startRuntimeInstance(name, progress),
      successMessage: `${name} 인스턴스를 시작했습니다.`,
      target: { name, resource: "runtime" },
      title: "Lima 인스턴스 시작",
    });
    return context.json({ operation }, 202);
  });
  app.post("/runtime/instances/:name/stop", (context) => {
    const name = requireRuntimeInstanceName(context.req.param("name"));
    const operation = enqueue(context, {
      exclusive: true,
      kind: "runtime.stop",
      locks: [],
      run: (progress) => controller.stopRuntimeInstance(name, progress),
      successMessage: `${name} 인스턴스를 중지했습니다.`,
      target: { name, resource: "runtime" },
      title: "Lima 인스턴스 중지",
    });
    return context.json({ operation }, 202);
  });
  app.get("/runtime/engine/configuration", async (context) =>
    context.json(await controller.getDockerDaemonConfiguration()),
  );
  app.patch("/runtime/engine/configuration", async (context) => {
    const input = parseUpdateDockerDaemonConfigurationInput(await readObject(context));
    const operation = enqueue(
      context,
      {
        exclusive: true,
        kind: "runtime.daemon.configure",
        locks: [],
        run: (progress) => controller.applyDockerDaemonConfiguration(input, progress),
        successMessage: "Docker daemon 설정을 적용했습니다.",
        target: { name: "Docker Engine", resource: "runtime" },
        title: "Docker daemon 설정 적용",
      },
      undefined,
      false,
    );
    return context.json({ operation }, 202);
  });
  app.patch("/runtime/engine/configuration/:section", async (context) => {
    const input = parseUpdateDockerDaemonConfigurationSectionInput(
      context.req.param("section"),
      await readObject(context),
    );
    const label = dockerDaemonSectionLabels[input.section];
    const operation = enqueue(
      context,
      {
        exclusive: true,
        kind: "runtime.daemon.configure",
        locks: [],
        run: (progress) => controller.applyDockerDaemonConfigurationSection(input, progress),
        successMessage: `${label} 설정을 적용했습니다.`,
        target: { name: "Docker Engine", resource: "runtime" },
        title: `${label} 설정 적용`,
      },
      undefined,
      false,
    );
    return context.json({ operation }, 202);
  });

  app.get("/operations", (context) => context.json({ operations: operations.list() }));
  app.get("/operations/:id", (context) => {
    const operation = operations.get(context.req.param("id"));
    if (!operation) throw new ExpectedError("operation_not_found", "작업을 찾을 수 없습니다.", 404);
    return context.json({ operation });
  });
  app.delete("/operations/:id", (context) =>
    context.json({ operation: operations.cancel(context.req.param("id")) }),
  );
  app.post("/operations/:id/retry", async (context) => {
    const sourceId = context.req.param("id");
    const request = operations.getRetryRequest(sourceId);
    const headers = new Headers({ host: "localhost", origin: "http://localhost" });
    const body = request.body === undefined ? undefined : JSON.stringify(request.body);
    if (body !== undefined) headers.set("content-type", "application/json");
    const response = await app.request(request.path, {
      ...(body === undefined ? {} : { body }),
      headers,
      method: request.method,
    });
    if (response.status !== 202) return response;
    const value = (await response.json()) as OperationAccepted;
    return context.json({ operation: operations.markRetried(value.operation.id, sourceId) }, 202);
  });

  app.post("/runtime/start", async (context) => {
    const body = await readOptionalObject(context);
    const configuration = body ? parseRuntimeStartInput(body) : undefined;
    const operation = enqueue(
      context,
      {
        exclusive: true,
        kind: "runtime.start",
        locks: [],
        run: async (progress) => void (await controller.startRuntime(progress, configuration)),
        successMessage: configuration
          ? "Docker Engine을 만들었습니다."
          : "Lima 런타임을 시작했습니다.",
        target: { name: "Docker Engine", resource: "runtime" },
        title: configuration ? "Docker Engine 만들기" : "런타임 시작",
      },
      configuration ? { configuration } : undefined,
    );
    return context.json({ operation }, 202);
  });

  app.post("/runtime/cli/connect", (context) => {
    const operation = enqueue(context, {
      exclusive: true,
      kind: "runtime.connect",
      locks: [],
      run: (progress) => controller.connectDockerCli(progress),
      successMessage: "Docker CLI를 overseer context에 연결했습니다.",
      target: { name: "Docker Engine", resource: "runtime" },
      title: "Docker CLI 연결",
    });
    return context.json({ operation }, 202);
  });

  app.post("/runtime/recreate", async (context) => {
    const input = parseRecreateDockerEngineInput(await readObject(context));
    const operation = enqueue(
      context,
      {
        exclusive: true,
        kind: "runtime.recreate",
        locks: [],
        run: async (progress) =>
          void (await controller.recreateRuntime(input.configuration, progress)),
        successMessage: "Docker Engine을 재생성했습니다.",
        target: { name: "Docker Engine", resource: "runtime" },
        title: "Docker Engine 재생성",
      },
      undefined,
      false,
    );
    return context.json({ operation }, 202);
  });

  app.post("/runtime/stop", (context) => {
    const operation = enqueue(context, {
      exclusive: true,
      kind: "runtime.stop",
      locks: [],
      run: async (progress) => void (await controller.stopRuntime(progress)),
      successMessage: "Lima 런타임을 중지했습니다.",
      target: { name: "Docker Engine", resource: "runtime" },
      title: "런타임 중지",
    });
    return context.json({ operation }, 202);
  });

  app.get("/compose/projects", async (context) =>
    context.json({ projects: await controller.getComposeProjects() }),
  );
  app.post("/compose/builder", async (context) => {
    const spec = parseComposeBuilderSpec(await readObject(context));
    const operation = enqueue(
      context,
      {
        kind: "compose.builder.register",
        locks: [`compose:${spec.name}`],
        run: (progress) => controller.registerBuilderCompose(spec, progress),
        successMessage: `${spec.name} 폼 Compose 프로젝트를 등록했습니다.`,
        target: { name: spec.name, resource: "compose" },
        title: "폼 Compose 등록",
      },
      spec,
    );
    return context.json({ operation }, 202);
  });
  app.get("/compose/projects/:name/builder", async (context) => {
    const project: ComposeBuilderProjectDetail = await controller.getBuilderComposeProject(
      requireResourceName(context.req.param("name")),
    );
    return context.json({ project });
  });
  app.patch("/compose/projects/:name/builder", async (context) => {
    const name = requireResourceName(context.req.param("name"));
    const input = parseUpdateComposeBuilderInput(await readObject(context));
    const operation = enqueue(
      context,
      {
        kind: "compose.builder.update",
        locks: [`compose:${name}`],
        run: (progress) => controller.updateBuilderCompose(name, input, progress),
        successMessage: `${name} 폼 Compose 구성을 수정했습니다.`,
        target: { name, resource: "compose" },
        title: "폼 Compose 수정",
      },
      input,
    );
    return context.json({ operation }, 202);
  });
  app.delete("/compose/projects/:name/builder", (context) => {
    const name = requireResourceName(context.req.param("name"));
    const operation = enqueue(context, {
      kind: "compose.builder.remove",
      locks: [`compose:${name}`],
      run: (progress) => controller.removeBuilderCompose(name, progress),
      successMessage: `${name} 폼 Compose 등록을 해제했습니다.`,
      target: { name, resource: "compose" },
      title: "폼 Compose 등록 해제",
    });
    return context.json({ operation }, 202);
  });
  app.post("/compose/remote", async (context) => {
    const body = await readObject(context);
    const requestedName = optionalComposeProjectName(body.name);
    const input: RegisterRemoteComposeInput = {
      ...(requestedName ? { name: requestedName } : {}),
      url: requireComposeUrl(body.url),
    };
    const name = input.name ?? deriveRemoteComposeProjectName(input.url);
    const operation = enqueue(
      context,
      {
        kind: "compose.remote.register",
        locks: [`compose:${name}`],
        run: (progress) => controller.registerRemoteCompose(input, progress),
        successMessage: `${name} URL Compose 프로젝트를 등록했습니다.`,
        target: { name, resource: "compose" },
        title: "URL Compose 등록",
      },
      input,
    );
    return context.json({ operation }, 202);
  });
  app.post("/compose/projects/:name/remote/check", (context) => {
    const name = requireResourceName(context.req.param("name"));
    const operation = enqueue(context, {
      kind: "compose.remote.check",
      locks: [`compose:${name}`],
      run: (progress) => controller.checkRemoteComposeUpdate(name, progress),
      successMessage: `${name} Compose 업데이트를 확인했습니다.`,
      target: { name, resource: "compose" },
      title: "Compose 업데이트 확인",
    });
    return context.json({ operation }, 202);
  });
  app.post("/compose/projects/:name/remote/update", (context) => {
    const name = requireResourceName(context.req.param("name"));
    const operation = enqueue(context, {
      kind: "compose.remote.update",
      locks: [`compose:${name}`],
      run: (progress) => controller.applyRemoteComposeUpdate(name, progress),
      successMessage: `${name} Compose 파일을 업데이트했습니다.`,
      target: { name, resource: "compose" },
      title: "Compose 업데이트 적용",
    });
    return context.json({ operation }, 202);
  });
  app.delete("/compose/projects/:name/remote", (context) => {
    const name = requireResourceName(context.req.param("name"));
    const operation = enqueue(context, {
      kind: "compose.remote.remove",
      locks: [`compose:${name}`],
      run: (progress) => controller.removeRemoteCompose(name, progress),
      successMessage: `${name} URL Compose 등록을 해제했습니다.`,
      target: { name, resource: "compose" },
      title: "URL Compose 등록 해제",
    });
    return context.json({ operation }, 202);
  });
  app.get("/compose/projects/:name/logs", async (context) => {
    const logs = await controller.getComposeProjectLogs(
      requireResourceName(context.req.param("name")),
    );
    return context.json({ logs });
  });
  app.get("/compose/projects/:name", async (context) =>
    context.json({
      project: await controller.getComposeProject(requireResourceName(context.req.param("name"))),
    }),
  );
  app.post("/compose/projects/:name/actions/:action", (context) => {
    const name = requireResourceName(context.req.param("name"));
    const action = context.req.param("action");
    if (action !== "up" && action !== "stop" && action !== "restart" && action !== "down") {
      throw new ExpectedError("invalid_action", "지원하지 않는 Compose 작업입니다.", 400);
    }
    const operation = enqueue(context, {
      kind: `compose.${action}`,
      locks: [`compose:${name}`],
      run: (progress) => controller.composeProjectAction(name, action, progress),
      successMessage: `${name} Compose 작업을 완료했습니다.`,
      target: { name, resource: "compose" },
      title: `Compose ${action}`,
    });
    return context.json({ operation }, 202);
  });

  app.get("/containers", async (context) =>
    context.json({ containers: await controller.getContainers() }),
  );
  app.post("/containers", async (context) => {
    const spec = parseContainerSpec(await readObject(context));
    const name = spec.name ?? spec.image;
    const operation = enqueue(
      context,
      {
        kind: "container.create",
        locks: [
          ...(spec.name ? [`container-name:${spec.name}`] : []),
          ...spec.networks.map((network) => `network:${network}`),
          ...spec.volumes.map(({ volume }) => `volume:${volume}`),
        ],
        run: (progress) => controller.runContainer(spec, progress),
        successMessage: `${name} 컨테이너를 실행했습니다.`,
        target: { name, resource: "container" },
        title: "컨테이너 실행",
      },
      spec,
    );
    return context.json({ operation }, 202);
  });
  app.get("/containers/:id", async (context) =>
    context.json({
      container: await controller.getContainer(requireContainerReference(context.req.param("id"))),
    }),
  );
  app.get("/containers/:id/inspect", async (context) =>
    context.json({
      inspection: await controller.getContainerInspection(
        requireContainerReference(context.req.param("id")),
      ),
    }),
  );
  app.patch("/containers/:id", async (context) => {
    const id = requireContainerReference(context.req.param("id"));
    const input = parseUpdateContainerInput(await readObject(context));
    const name = input.spec.name ?? id;
    const operation = enqueue(
      context,
      {
        kind: "container.update",
        locks: [
          `container:${id}`,
          `container-name:${name}`,
          ...input.spec.networks.map((network) => `network:${network}`),
          ...input.spec.volumes.map(({ volume }) => `volume:${volume}`),
        ],
        run: (progress) => controller.updateContainer(id, input, progress),
        successMessage: `${name} 컨테이너 설정을 변경했습니다.`,
        target: { id, name, resource: "container" },
        title: "컨테이너 설정 변경",
      },
      input,
    );
    return context.json({ operation }, 202);
  });
  app.post("/containers/:id/actions/:action", (context) => {
    const id = requireContainerReference(context.req.param("id"));
    const action = context.req.param("action");
    if (action !== "start" && action !== "stop" && action !== "restart") {
      throw new ExpectedError("invalid_action", "지원하지 않는 컨테이너 작업입니다.", 400);
    }
    const operation = enqueue(context, {
      kind: `container.${action}`,
      locks: [`container:${id}`],
      run: (progress) => controller.containerAction(id, action, progress),
      successMessage: `컨테이너 ${action} 작업을 완료했습니다.`,
      target: { id, name: id, resource: "container" },
      title: `컨테이너 ${action}`,
    });
    return context.json({ operation }, 202);
  });
  app.delete("/containers/:id", (context) => {
    const id = requireContainerReference(context.req.param("id"));
    const operation = enqueue(context, {
      kind: "container.remove",
      locks: [`container:${id}`],
      run: (progress) => controller.removeContainer(id, progress),
      successMessage: "컨테이너를 삭제했습니다.",
      target: { id, name: id, resource: "container" },
      title: "컨테이너 삭제",
    });
    return context.json({ operation }, 202);
  });
  app.get("/containers/:id/logs", async (context) => {
    const logs = await controller.getContainerLogs(
      requireContainerReference(context.req.param("id")),
    );
    return context.json({ logs });
  });

  app.get("/images", async (context) => context.json({ images: await controller.getImages() }));
  app.get("/images/:id/history", async (context) => {
    const history = await controller.getImageHistory(
      requireImageIdentifier(context.req.param("id")),
    );
    return context.json({ history });
  });
  app.get("/images/:id/tags", async (context) => {
    const tags = await controller.getImageRepositoryTags(
      requireImageIdentifier(context.req.param("id")),
      requirePageNumber(context.req.query("page")),
    );
    return context.json({ tags });
  });
  app.get("/images/:id", async (context) => {
    const image = await controller.getImage(requireImageIdentifier(context.req.param("id")));
    return context.json({ image });
  });
  app.post("/images/pull", async (context) => {
    const body = await readObject(context);
    const input: PullImageInput = { image: requireImageReference(body.image) };
    const operation = enqueue(
      context,
      {
        kind: "image.pull",
        locks: [`image:${input.image}`],
        run: (progress) => controller.pullImage(input, progress),
        successMessage: `${input.image} 이미지를 받았습니다.`,
        target: { name: input.image, resource: "image" },
        title: "이미지 받기",
      },
      input,
    );
    return context.json({ operation }, 202);
  });
  app.delete("/images/:id", (context) => {
    const id = requireContainerReference(context.req.param("id"));
    const operation = enqueue(context, {
      kind: "image.remove",
      locks: [`image:${id}`],
      run: (progress) => controller.removeImage(id, progress),
      successMessage: "이미지를 삭제했습니다.",
      target: { id, name: id, resource: "image" },
      title: "이미지 삭제",
    });
    return context.json({ operation }, 202);
  });

  app.get("/volumes", async (context) => context.json({ volumes: await controller.getVolumes() }));
  app.post("/volumes", async (context) => {
    const body = await readObject(context);
    const name = requireResourceName(body.name);
    const operation = enqueue(
      context,
      {
        kind: "volume.create",
        locks: [`volume:${name}`],
        run: (progress) => controller.createVolume({ name }, progress),
        successMessage: `${name} 볼륨을 만들었습니다.`,
        target: { name, resource: "volume" },
        title: "볼륨 만들기",
      },
      { name },
    );
    return context.json({ operation }, 202);
  });
  app.delete("/volumes/:name", (context) => {
    const name = requireResourceName(context.req.param("name"));
    const operation = enqueue(context, {
      kind: "volume.remove",
      locks: [`volume:${name}`],
      run: (progress) => controller.removeVolume(name, progress),
      successMessage: `${name} 볼륨을 삭제했습니다.`,
      target: { name, resource: "volume" },
      title: "볼륨 삭제",
    });
    return context.json({ operation }, 202);
  });

  app.get("/networks", async (context) =>
    context.json({ networks: await controller.getNetworks() }),
  );
  app.post("/networks", async (context) => {
    const body = await readObject(context);
    const name = requireResourceName(body.name);
    const operation = enqueue(
      context,
      {
        kind: "network.create",
        locks: [`network:${name}`],
        run: (progress) => controller.createNetwork({ name }, progress),
        successMessage: `${name} 네트워크를 만들었습니다.`,
        target: { name, resource: "network" },
        title: "네트워크 만들기",
      },
      { name },
    );
    return context.json({ operation }, 202);
  });
  app.delete("/networks/:name", (context) => {
    const name = requireResourceName(context.req.param("name"));
    const operation = enqueue(context, {
      kind: "network.remove",
      locks: [`network:${name}`],
      run: (progress) => controller.removeNetwork(name, progress),
      successMessage: `${name} 네트워크를 삭제했습니다.`,
      target: { name, resource: "network" },
      title: "네트워크 삭제",
    });
    return context.json({ operation }, 202);
  });

  app.onError((error, context) => {
    if (error instanceof ExpectedError) {
      return context.json({ error: { code: error.code, message: error.message } }, error.status);
    }
    console.error(error);
    return context.json(
      { error: { code: "internal_error", message: "요청을 처리하지 못했습니다." } },
      500,
    );
  });

  return app;
}

export function createPersistentApi() {
  const history = new SqliteOperationHistoryStore();
  const instances = new SqliteRuntimeInstanceStore();
  return createApi(
    new LimaDockerRuntime(undefined, undefined, undefined, undefined, instances),
    new OperationQueue(3, history),
  );
}

export type ApiType = ReturnType<typeof createApi>;
