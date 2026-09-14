import type { Hono } from "hono";
import type { DockerDaemonConfigurationSection } from "../../../shared/contracts.ts";
import type {
  DockerEngineController,
  RuntimeInstanceController,
} from "../../application/overseer-controller.ts";
import {
  parseUpdateDockerDaemonConfigurationInput,
  parseUpdateDockerDaemonConfigurationSectionInput,
} from "../../modules/engine/index.ts";
import {
  parseCreateRuntimeInstanceInput,
  parseDeleteRuntimeInstanceInput,
  parseRecreateDockerEngineInput,
  parseRuntimeStartInput,
  parseUpdateRuntimeInstanceInput,
  requireRuntimeInstanceName,
} from "../../modules/instances/index.ts";
import { readObject, readOptionalObject, type EnqueueApiOperation } from "../http.ts";

const dockerDaemonSectionLabels: Record<DockerDaemonConfigurationSection, string> = {
  advanced: "고급 JSON",
  logging: "컨테이너 로그",
  network: "네트워크",
  proxy: "프록시",
  registry: "레지스트리",
  stability: "Docker Engine 동작 및 진단",
  transfer: "전송",
};

type RuntimeController = DockerEngineController & RuntimeInstanceController;

export function registerRuntimeRoutes(
  app: Hono,
  controller: RuntimeController,
  enqueue: EnqueueApiOperation,
): void {
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
  app.patch("/runtime/instances/:name", async (context) => {
    const name = requireRuntimeInstanceName(context.req.param("name"));
    const input = parseUpdateRuntimeInstanceInput(await readObject(context));
    const operation = enqueue(
      context,
      {
        exclusive: true,
        kind: "runtime.instance.update",
        locks: [],
        run: (progress) => controller.updateRuntimeInstance(name, input, progress),
        successMessage: `${name} 인스턴스의 VM 리소스를 수정했습니다.`,
        target: { name, resource: "runtime" },
        title: "Lima 인스턴스 수정",
      },
      undefined,
      false,
    );
    return context.json({ operation }, 202);
  });
  app.delete("/runtime/instances/:name", async (context) => {
    const name = requireRuntimeInstanceName(context.req.param("name"));
    parseDeleteRuntimeInstanceInput(await readObject(context), name);
    const operation = enqueue(
      context,
      {
        exclusive: true,
        kind: "runtime.instance.delete",
        locks: [],
        run: (progress) => controller.deleteRuntimeInstance(name, progress),
        successMessage: `${name} Lima 인스턴스를 삭제했습니다.`,
        target: { name, resource: "runtime" },
        title: "Lima 인스턴스 삭제",
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
  app.post("/runtime/instances/:name/force-stop", (context) => {
    const name = requireRuntimeInstanceName(context.req.param("name"));
    const operation = enqueue(
      context,
      {
        exclusive: true,
        kind: "runtime.instance.force-stop",
        locks: [],
        run: (progress) => controller.forceStopRuntimeInstance(name, progress),
        successMessage: `${name} 인스턴스를 강제로 중지했습니다.`,
        target: { name, resource: "runtime" },
        title: "Lima 인스턴스 강제 중지",
      },
      undefined,
      false,
    );
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
        successMessage: "Docker Engine 설정을 적용했습니다.",
        target: { name: "Docker Engine", resource: "runtime" },
        title: "Docker Engine 설정 적용",
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
  app.post("/runtime/restart", (context) => {
    const operation = enqueue(context, {
      exclusive: true,
      kind: "runtime.restart",
      locks: [],
      run: async (progress) => void (await controller.restartRuntime(progress)),
      successMessage: "활성 VM을 재시작했습니다.",
      target: { name: "Docker Engine", resource: "runtime" },
      title: "VM 재시작",
    });
    return context.json({ operation }, 202);
  });
  app.post("/runtime/force-restart", (context) => {
    const operation = enqueue(
      context,
      {
        exclusive: true,
        kind: "runtime.force-restart",
        locks: [],
        run: async (progress) => void (await controller.forceRestartRuntime(progress)),
        successMessage: "Docker Engine을 강제로 재시작했습니다.",
        target: { name: "Docker Engine", resource: "runtime" },
        title: "Docker Engine 강제 재시작",
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
}
