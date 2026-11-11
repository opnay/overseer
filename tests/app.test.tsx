import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/client/app/index.ts";
import { formatDateTime } from "../src/client/shared/lib/date-time/index.ts";
import { emptyContainerSpec } from "../src/shared/container-spec.ts";
import {
  emptyComposeBuilderService,
  emptyComposeBuilderSpec,
} from "../src/shared/compose-builder.ts";
import type {
  DashboardSnapshot,
  DockerDaemonConfigurationSnapshot,
  DockerEngineConfigurationSnapshot,
  OperationSnapshot,
  RuntimeInstancesSnapshot,
  StartupSnapshot,
  ToolUpdateSnapshot,
} from "../src/shared/contracts.ts";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function operation(
  status: OperationSnapshot["status"] = "queued",
  overrides: Partial<OperationSnapshot> = {},
): OperationSnapshot {
  return {
    createdAt: "2026-08-23T10:00:00.000Z",
    id: "operation-id",
    kind: "volume.create",
    output: [],
    retryable: false,
    status,
    step: status === "succeeded" ? "완료됨" : "대기 중",
    successMessage: "app-data 볼륨을 만들었습니다.",
    target: { name: "app-data", resource: "volume" },
    title: "볼륨 만들기",
    ...overrides,
  };
}

function dockerEngineSnapshot(
  source: DockerEngineConfigurationSnapshot["source"] = "default",
  qemuAvailable = false,
  dockerCliReady = source === "instance",
): DockerEngineConfigurationSnapshot {
  return {
    configuration: {
      cpus: 4,
      diskGiB: 100,
      memoryGiB: 4,
      provider: "lima",
      vmType: "vz",
    },
    dockerCli:
      source === "instance" && dockerCliReady
        ? {
            activeContext: "overseer",
            contextEndpoint: "unix:///tmp/overseer/sock/docker.sock",
            contextName: "overseer",
            expectedEndpoint: "unix:///tmp/overseer/sock/docker.sock",
            homeMountWritable: true,
            message: "터미널에서 별도 환경 변수 없이 docker 명령을 사용할 수 있습니다.",
            ready: true,
          }
        : source === "instance"
          ? {
              activeContext: "default",
              contextName: "overseer",
              expectedEndpoint: "unix:///tmp/overseer/sock/docker.sock",
              homeMountWritable: false,
              message:
                "로컬 Compose bind mount를 위해 macOS 홈 공유를 쓰기 가능하게 설정해야 합니다.",
              ready: false,
            }
          : {
              contextName: "overseer",
              homeMountWritable: false,
              message: "Docker Engine을 만들면 macOS Docker CLI가 자동으로 연결됩니다.",
              ready: false,
            },
    providers: [{ available: true, label: "Lima VM", value: "lima" }],
    source,
    vmTypes: [
      { available: true, label: "Apple Virtualization (VZ)", value: "vz" },
      {
        available: qemuAvailable,
        label: "QEMU",
        ...(qemuAvailable
          ? {}
          : { unavailableReason: "QEMU가 설치되지 않았습니다. brew install qemu" }),
        value: "qemu",
      },
    ],
  };
}

function dockerDaemonSnapshot(available = true): DockerDaemonConfigurationSnapshot {
  return {
    additionalJson: '{\n  "features": {\n    "containerd-snapshotter": true\n  }\n}\n',
    available,
    configuration: {
      debug: false,
      defaultAddressPools: [],
      dns: [],
      insecureRegistries: [],
      liveRestore: false,
      logDriver: "json-file",
      maxConcurrentDownloads: 3,
      maxConcurrentUploads: 5,
      proxies: { noProxy: [] },
      registryMirrors: [],
    },
    message: available
      ? "저장하면 Docker Engine만 다시 시작합니다."
      : "Docker Engine을 시작한 뒤 설정을 변경할 수 있습니다.",
    path: "~/.config/docker/daemon.json",
    source: available ? "file" : "default",
  };
}

function runtimeInstancesSnapshot(
  instances: RuntimeInstancesSnapshot["instances"] = [],
): RuntimeInstancesSnapshot {
  return {
    activeInstanceName: instances.find(({ active }) => active)?.name ?? "overseer",
    instances,
    selectionLocked: false,
  };
}

function runtimeInstance(
  overrides: Partial<RuntimeInstancesSnapshot["instances"][number]> = {},
): RuntimeInstancesSnapshot["instances"][number] {
  return {
    active: true,
    architecture: "aarch64",
    compatible: true,
    configuration: dockerEngineSnapshot("instance", true).configuration,
    containerCount: { running: 1, total: 2 },
    dockerVersion: "29.7.2",
    homeMountWritable: true,
    managed: true,
    message: "Overseer에서 사용할 수 있습니다.",
    name: "overseer",
    prepared: true,
    status: "Running",
    ...overrides,
  };
}

function startupSnapshot(
  installed: { compose?: boolean; docker?: boolean; homebrew?: boolean; lima?: boolean } = {},
): StartupSnapshot {
  const values = { compose: true, docker: true, homebrew: true, lima: true, ...installed };
  return {
    prerequisites: [
      {
        automaticInstall: false,
        automaticInstallUnavailableReason:
          "Homebrew는 관리자 인증이 필요하므로 터미널에서 설치해야 합니다.",
        description: "Docker CLI와 Lima를 설치하는 macOS 패키지 관리자입니다.",
        id: "homebrew",
        installCommand:
          '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
        installed: values.homebrew,
        label: "Homebrew",
        required: true,
      },
      {
        automaticInstall: values.homebrew,
        description: "Overseer가 Lima의 Docker Engine을 제어할 때 사용하는 명령 도구입니다.",
        id: "docker",
        installCommand: "brew install docker",
        installed: values.docker,
        label: "Docker CLI",
        required: true,
      },
      {
        automaticInstall: values.homebrew && values.docker,
        description: "Compose 프로젝트를 사용하려는 경우에만 추가로 설치합니다.",
        id: "compose",
        installCommand: "brew install docker-compose",
        installed: values.compose,
        label: "Docker Compose",
        required: false,
      },
      {
        automaticInstall: values.homebrew,
        description: "macOS에서 단일 overseer VM과 Docker Engine을 실행합니다.",
        id: "lima",
        installCommand: "brew install lima",
        installed: values.lima,
        label: "Lima",
        required: true,
      },
    ],
    ready: values.homebrew && values.docker && values.lima,
  };
}

function toolUpdateSnapshot(): ToolUpdateSnapshot {
  return {
    checkedAt: "2026-08-24T10:00:00.000Z",
    items: [
      {
        automaticUpdate: true,
        currentVersion: "29.7.2",
        id: "docker",
        installed: true,
        label: "Docker CLI",
        latestVersion: "30.0.0",
        managedByHomebrew: true,
        updateAvailable: true,
      },
      {
        automaticUpdate: true,
        currentVersion: "5.5.0",
        id: "compose",
        installed: true,
        label: "Docker Compose",
        latestVersion: "5.5.0",
        managedByHomebrew: true,
        updateAvailable: false,
      },
      {
        automaticUpdate: false,
        automaticUpdateUnavailableReason: "Homebrew로 설치된 도구만 자동 업데이트할 수 있습니다.",
        currentVersion: "2.2.0",
        id: "lima",
        installed: true,
        label: "Lima",
        managedByHomebrew: false,
      },
    ],
  };
}

function mockViewport(width: number) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      const maximumRem = Number(query.match(/max-width:\s*([\d.]+)rem/)?.[1]);
      return {
        addEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: Number.isFinite(maximumRem) ? width <= maximumRem * 16 : false,
        media: query,
        onchange: null,
        removeEventListener: vi.fn(),
      };
    }),
  );
}

function renderDockerPluginBulkUpdateApp() {
  const user = userEvent.setup();
  let checked = false;
  let operationHistory: OperationSnapshot[] = [];
  let omittedOperationOnNextRead: string | undefined;
  let failNextOperationsRead = false;
  let failedOperationsReadCount = 0;
  const completedOperationIds = new Set<string>();
  const updateRequests: string[] = [];
  const dashboard: DashboardSnapshot = {
    composeProjects: [],
    containers: [],
    images: [],
    networks: [],
    volumes: [],
    runtime: { phase: "running", instance: "overseer", message: "정상", dockerVersion: "29.7.2" },
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
    if (url.endsWith("/api/operations")) {
      if (omittedOperationOnNextRead) {
        const omittedId = omittedOperationOnNextRead;
        omittedOperationOnNextRead = undefined;
        failNextOperationsRead = true;
        return jsonResponse({
          operations: operationHistory.filter(({ id }) => id !== omittedId),
        });
      }
      if (failNextOperationsRead) {
        failNextOperationsRead = false;
        failedOperationsReadCount += 1;
        return jsonResponse({ error: "일시적인 작업 조회 오류" }, 503);
      }
      operationHistory = operationHistory.map((current) =>
        completedOperationIds.has(current.id) &&
        (current.status === "queued" || current.status === "running")
          ? { ...current, status: "succeeded", step: "완료됨" }
          : current,
      );
      return jsonResponse({ operations: operationHistory });
    }
    if (url.endsWith("/api/docker-cli/plugins/updates/check") && init?.method === "POST") {
      checked = true;
      const accepted = operation("succeeded", {
        id: "bulk-check",
        kind: "docker.plugin.update.check",
        target: { resource: "dockerPlugin", name: "CLI 도구" },
        title: "CLI 도구 업데이트 확인",
      });
      operationHistory = [accepted, ...operationHistory];
      return jsonResponse({ operation: accepted }, 202);
    }
    if (url.endsWith("/api/docker-cli/plugins")) {
      const plugin = (
        id: "docker" | "compose" | "buildx" | "lima",
        label: string,
        management: "extensions" | "startup",
      ) => ({
        automaticUpdate: true,
        description: `${label} 관리`,
        id,
        installAvailable: false,
        installed: true,
        label,
        management,
        source: "homebrew" as const,
        version: "1.0.0",
        latestVersion: "2.0.0",
        ...(checked ? { updateAvailable: true } : {}),
      });
      return jsonResponse({
        ...(checked ? { checkedAt: "2026-10-22T00:00:00Z" } : {}),
        plugins: [
          plugin("docker", "Docker CLI", "startup"),
          plugin("compose", "Docker Compose", "startup"),
          plugin("buildx", "Docker Buildx", "extensions"),
          plugin("lima", "Lima", "startup"),
        ],
      });
    }
    const updateMatch = url.match(
      /\/api\/docker-cli\/plugins\/(docker|compose|buildx|lima)\/update$/,
    );
    if (updateMatch && init?.method === "POST") {
      const id = updateMatch[1]!;
      const label =
        id === "docker"
          ? "Docker CLI"
          : id === "compose"
            ? "Docker Compose"
            : id === "buildx"
              ? "Docker Buildx"
              : "Lima";
      updateRequests.push(id);
      const accepted = operation("running", {
        id: `bulk-${id}`,
        kind: "docker.plugin.update",
        target: { id, name: label, resource: "dockerPlugin" },
        title: `${label} 업데이트`,
      });
      operationHistory = [accepted, ...operationHistory];
      return jsonResponse({ operation: accepted }, 202);
    }
    return jsonResponse(dashboard);
  });
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", "/docker-plugins");
  render(<App />);

  return {
    addUnrelatedNewestOperation() {
      operationHistory = [
        operation("succeeded", {
          id: "external-newer-plugin-update",
          kind: "docker.plugin.update",
          target: { id: "buildx", name: "Docker Buildx", resource: "dockerPlugin" },
          title: "Docker Buildx 업데이트",
        }),
        ...operationHistory,
      ];
    },
    completeOperation(id: string) {
      completedOperationIds.add(id);
    },
    failedOperationsReadCount() {
      return failedOperationsReadCount;
    },
    hideOperationOnceThenFailOperationsRead(id: string) {
      omittedOperationOnNextRead = id;
    },
    removeOperation(id: string) {
      operationHistory = operationHistory.filter((current) => current.id !== id);
    },
    fetchMock,
    updateRequests,
    user,
  };
}

describe("App", () => {
  it.each([
    {
      installed: { homebrew: false, docker: false, lima: false, compose: false },
      heading: "Homebrew를 설치해야 합니다.",
    },
    {
      installed: { docker: false, lima: false, compose: false },
      heading: "Docker CLI를 설치해야 합니다.",
    },
    { installed: { lima: false }, heading: "Lima를 설치해야 합니다." },
  ])(
    "opens required setup despite a dashboard failure: $heading",
    async ({ installed, heading }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot(installed));
          if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
          return jsonResponse(
            { error: { code: "internal_error", message: "런타임 조회 실패" } },
            500,
          );
        }),
      );
      window.history.replaceState(null, "", "/containers");

      render(<App />);

      expect(await screen.findByRole("heading", { name: heading, level: 2 })).toBeInTheDocument();
      await waitFor(() => expect(window.location.pathname).toBe("/startup"));
    },
  );

  it("keeps a configured stopped engine out of setup even without optional Compose", async () => {
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      volumes: [],
      runtime: { instance: "overseer", phase: "stopped", message: "중지됨" },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot({ compose: false }));
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/settings?section=general");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "시작 준비" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/settings");
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/runtime/start")),
    ).toBe(false);
  });
  it("matches the loading skeleton to the resource collection pattern", () => {
    window.history.replaceState(null, "", "/containers");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    const { container } = render(<App />);

    expect(container.querySelectorAll(".overseer-loading-rail-icon")).toHaveLength(5);
    expect(
      container.querySelector(".overseer-secondary-sidebar .overseer-loading-nav-items"),
    ).toBeInTheDocument();
    expect(container.querySelector('[data-loading-pattern="collection"]')).toBeInTheDocument();
    expect(container.querySelectorAll(".overseer-loading-table-row")).toHaveLength(6);
    expect(container.querySelector(".overseer-stat-grid")).not.toBeInTheDocument();
  });

  it.each([
    ["/containers/c79426952635", "detail"],
    ["/settings", "settings"],
  ])("matches the %s loading skeleton to the %s pattern", (path, pattern) => {
    window.history.replaceState(null, "", path);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    const { container } = render(<App />);

    expect(container.querySelector(`[data-loading-pattern="${pattern}"]`)).toBeInTheDocument();
  });

  it("uses the guided setup skeleton on the startup route", () => {
    window.history.replaceState(null, "", "/startup");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    render(<App />);

    expect(screen.getByLabelText("시작 준비 화면 불러오는 중")).toHaveAttribute(
      "data-loading-pattern",
      "startup",
    );
    expect(screen.queryByLabelText("화면 준비 중")).not.toBeInTheDocument();
  });

  it("keeps the window titlebar while loading without flashing desktop navigation", () => {
    mockViewport(390);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    const { container } = render(<App />);

    expect(screen.getByRole("banner", { name: "창 제목 표시줄" })).toBeInTheDocument();
    expect(container.querySelector(".overseer-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "화면 이동" })).not.toBeInTheDocument();
  });

  it("does not flash the requested resource page before startup state resolves", async () => {
    let resolveStartup!: (response: Response) => void;
    const delayedStartup = new Promise<Response>((resolve) => {
      resolveStartup = resolve;
    });
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return delayedStartup;
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/containers?startup-preview=homebrew");

    render(<App />);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/startup"))).toBe(
        true,
      ),
    );
    expect(screen.getByLabelText("화면 준비 중")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "컨테이너", level: 1 })).not.toBeInTheDocument();

    resolveStartup(jsonResponse(startupSnapshot()));

    expect(
      await screen.findByRole("heading", { name: "Homebrew를 설치해야 합니다.", level: 2 }),
    ).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/startup"));
    expect(window.location.search).toBe("?startup-preview=homebrew");
  });

  it("guides manual Homebrew installation before enabling automatic steps", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        instance: "overseer",
        message: "Lima 실행 파일을 찾을 수 없습니다.",
        phase: "error",
      },
      volumes: [],
    };
    let homebrewInstalled = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/startup")) {
          return jsonResponse(
            startupSnapshot({
              compose: false,
              docker: false,
              homebrew: homebrewInstalled,
              lima: false,
            }),
          );
        }
        if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
        return jsonResponse(dashboard);
      }),
    );
    window.history.replaceState(null, "", "/containers");

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Homebrew를 설치해야 합니다.", level: 2 }),
    ).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/startup"));
    expect(screen.getByText("CLI 설치")).toBeInTheDocument();
    expect(screen.getByText("zshrc 등록")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CLI 설치 명령 복사" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "zshrc 등록 명령 복사" })).toBeEnabled();
    expect(screen.getByLabelText("Homebrew CLI 설치 명령")).toHaveTextContent(
      "raw.githubusercontent.com/Homebrew/install",
    );
    expect(screen.getByLabelText("Homebrew zshrc 등록 명령")).toHaveTextContent(
      "BREW_BIN=/opt/homebrew/bin/brew",
    );
    expect(screen.getByLabelText("Homebrew zshrc 등록 명령")).toHaveTextContent(
      "BREW_BIN=/usr/local/bin/brew",
    );
    expect(screen.getByLabelText("Homebrew zshrc 등록 명령")).toHaveTextContent(
      "printf '\\n%s\\n'",
    );
    expect(screen.getByLabelText("Homebrew zshrc 등록 명령")).toHaveTextContent(">> ~/.zshrc");
    expect(screen.queryByRole("button", { name: /Homebrew 자동 설치/ })).not.toBeInTheDocument();
    expect(
      screen.getByText("다음 단계부터 Docker CLI와 Lima를 자동 설치할 수 있습니다."),
    ).toBeInTheDocument();
    expect(screen.queryByText("터미널에서 설치하십시오.")).not.toBeInTheDocument();
    expect(screen.queryByText("또는")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "공식 홈페이지" })).toHaveAttribute(
      "href",
      "https://brew.sh/",
    );

    const installCheck = screen.getByRole("button", { name: "설치 확인" });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "상태 새로고침" })).toBeEnabled(),
    );
    await waitFor(() => expect(installCheck).toBeEnabled());
    homebrewInstalled = true;
    await user.click(installCheck);
    expect(
      await screen.findByRole("heading", { name: "Homebrew 설치를 확인했습니다.", level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Homebrew CLI 설치 명령")).toBeInTheDocument();
    expect(
      screen.getByText("Docker CLI와 Lima를 설치하는 macOS 패키지 관리자입니다."),
    ).toBeInTheDocument();
    expect(screen.queryByText("또는")).not.toBeInTheDocument();
    const nextButton = screen.getByRole("button", { name: "다음" });
    expect(nextButton.closest(".overseer-startup-completion-action")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "다음" }));

    expect(
      await screen.findByRole("heading", { name: "Docker CLI를 설치해야 합니다.", level: 2 }),
    ).toBeInTheDocument();
  });

  it("previews a missing Homebrew state without changing the detected tools", async () => {
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
        return jsonResponse(dashboard);
      }),
    );
    window.history.replaceState(null, "", "/startup?startup-preview=homebrew");

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Homebrew를 설치해야 합니다.", level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByText("미리보기")).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/startup"));
    expect(screen.getByLabelText("Homebrew CLI 설치 명령")).toHaveTextContent(
      "raw.githubusercontent.com/Homebrew/install",
    );
    expect(screen.getByLabelText("Homebrew zshrc 등록 명령")).toHaveTextContent(">> ~/.zshrc");
  });

  it.each([
    {
      completedSteps: 1,
      command: "brew install docker docker-compose",
      commandLabel: "Docker CLI와 Compose 설치 명령",
      heading: "Docker CLI를 설치해야 합니다.",
      preview: "docker",
    },
    {
      completedSteps: 2,
      command: "brew install lima",
      commandLabel: "Lima 설치 명령",
      heading: "Lima를 설치해야 합니다.",
      preview: "lima",
    },
  ])(
    "previews the $preview installation step without changing the detected tools",
    async ({ command, commandLabel, completedSteps, heading, preview }) => {
      const dashboard: DashboardSnapshot = {
        composeProjects: [],
        containers: [],
        images: [],
        networks: [],
        runtime: {
          dockerVersion: "29.7.2",
          instance: "overseer",
          message: "정상",
          phase: "running",
        },
        volumes: [],
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
          if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
          return jsonResponse(dashboard);
        }),
      );
      window.history.replaceState(null, "", `/startup?startup-preview=${preview}`);

      render(<App />);

      expect(await screen.findByRole("heading", { name: heading, level: 2 })).toBeInTheDocument();
      expect(screen.getByText("미리보기")).toBeInTheDocument();
      await waitFor(() => expect(window.location.pathname).toBe("/startup"));
      expect(screen.getAllByText("완료")).toHaveLength(completedSteps);
      expect(screen.getByLabelText(commandLabel)).toHaveTextContent(command);
    },
  );

  it("keeps the startup flow available at /startup after every tool is installed", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
        return jsonResponse(dashboard);
      }),
    );
    window.history.replaceState(null, "", "/startup");

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Homebrew 설치를 확인했습니다.", level: 2 }),
    ).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/startup"));
    expect(screen.getByLabelText("Homebrew CLI 설치 명령")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(
      await screen.findByRole("heading", {
        name: "Docker CLI 설치를 확인했습니다.",
        level: 2,
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(
      await screen.findByRole("heading", { name: "Lima 설치를 확인했습니다.", level: 2 }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(
      await screen.findByRole("heading", {
        name: "Docker Engine 준비를 마쳤습니다.",
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("4 / 4")).toBeInTheDocument();
    const engineStatus = screen.getByRole("region", { name: "Docker Engine 준비 상태" });
    expect(within(engineStatus).getByText("준비 완료")).toBeInTheDocument();
    expect(within(engineStatus).getByText("overseer")).toBeInTheDocument();
    expect(within(engineStatus).getByText("29.7.2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(await screen.findByRole("heading", { name: "컨테이너", level: 1 })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/containers");
  });

  it("lets the user choose Docker CLI only or include Compose", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        instance: "overseer",
        message: "전용 Lima 인스턴스가 아직 없습니다.",
        phase: "missing",
      },
      volumes: [],
    };
    const accepted = operation("queued", {
      kind: "startup.install",
      successMessage: "Docker CLI와 Compose를 설치했습니다.",
      target: { name: "docker", resource: "startup" },
      title: "Docker CLI와 Compose 설치",
    });
    const finished = operation("succeeded", {
      kind: "startup.install",
      output: ["Docker CLI 설치 완료", "Docker Compose 설치 완료"],
      successMessage: "Docker CLI와 Compose를 설치했습니다.",
      target: { name: "docker", resource: "startup" },
      title: "Docker CLI와 Compose 설치",
    });
    let installStarted = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) {
        return jsonResponse(
          installStarted
            ? startupSnapshot({ compose: true, docker: true, lima: false })
            : startupSnapshot({ compose: false, docker: false, lima: false }),
        );
      }
      if (url.endsWith("/api/operations")) {
        return jsonResponse({ operations: installStarted ? [finished] : [] });
      }
      if (
        url.endsWith("/api/startup/prerequisites/docker-with-compose/install") &&
        init?.method === "POST"
      ) {
        installStarted = true;
        return jsonResponse({ operation: accepted }, 202);
      }
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: "Docker CLI를 설치해야 합니다.",
        level: 2,
      }),
    ).toBeInTheDocument();
    const installGroup = container.querySelector(".overseer-startup-install-group");
    expect(installGroup).not.toBeNull();
    expect(
      within(installGroup as HTMLElement).getByLabelText("Docker CLI와 Compose 설치 명령"),
    ).toHaveTextContent("brew install docker docker-compose");
    expect(
      within(installGroup as HTMLElement).getByRole("button", {
        name: "Docker CLI와 Compose 자동 설치",
      }),
    ).toBeEnabled();
    expect(within(installGroup as HTMLElement).getByText("또는")).toBeInTheDocument();
    expect(screen.queryByText(/cli-plugins/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Docker 설치 옵션" }));
    const includeCompose = screen.getByRole("checkbox", { name: /^Docker Compose/ });
    expect(includeCompose).toBeChecked();

    await user.click(includeCompose);
    expect(screen.getByLabelText("Docker CLI 설치 명령")).toHaveTextContent("brew install docker");
    expect(screen.getByRole("button", { name: "Docker CLI 자동 설치" })).toBeEnabled();

    await user.click(includeCompose);

    await user.click(screen.getByRole("button", { name: "Docker CLI와 Compose 자동 설치" }));

    expect(
      await screen.findByRole("progressbar", { name: "Docker CLI와 Compose 설치 진행 중" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/startup/prerequisites/docker-with-compose/install") &&
            init?.method === "POST",
        ),
      ).toBe(true),
    );

    expect(
      await screen.findByRole(
        "heading",
        { name: "Docker CLI 설치를 확인했습니다.", level: 2 },
        { timeout: 3_000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Docker CLI와 Compose 설치 명령")).toBeInTheDocument();
    expect(screen.queryByText("또는")).not.toBeInTheDocument();
    const automaticInstallLog = screen.getByRole("button", { name: "자동 설치 로그" });
    expect(automaticInstallLog.closest(".overseer-startup-install-group")).not.toBeNull();
    expect(automaticInstallLog).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "다음" })).toBeEnabled();

    await user.click(automaticInstallLog);
    const startupLog = screen.getByRole("region", {
      name: "Docker CLI와 Compose 설치 로그",
    });
    expect(startupLog).toHaveTextContent("Docker Compose 설치 완료");
    await user.click(within(startupLog).getByRole("button", { name: "로그 옵션" }));
    const startupLogOptions = await screen.findByRole("menu");
    expect(
      within(startupLogOptions).getByRole("menuitemcheckbox", { name: "줄 바꿈" }),
    ).toBeInTheDocument();
    expect(within(startupLogOptions).getByRole("menuitemradio", { name: "보통" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(
      await screen.findByRole("heading", { name: "Lima를 설치해야 합니다.", level: 2 }),
    ).toBeInTheDocument();
  });

  it("refreshes startup status every 10 seconds and allows skipping Compose", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        instance: "overseer",
        message: "전용 Lima 인스턴스가 아직 없습니다.",
        phase: "missing",
      },
      volumes: [],
    };
    const snapshot = startupSnapshot({ compose: false, lima: false });
    const intervalSpy = vi.spyOn(window, "setInterval");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/startup")) return jsonResponse(snapshot);
        if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
        return jsonResponse(dashboard);
      }),
    );

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Docker Compose를 설치할까요?", level: 2 }),
    ).toBeInTheDocument();
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 10_000);

    await user.click(screen.getByRole("button", { name: "건너뛰기" }));
    expect(
      await screen.findByRole("heading", {
        name: "Docker Compose 설치를 건너뛰었습니다.",
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Docker Compose 설치 명령")).toBeInTheDocument();
    expect(screen.queryByText("또는")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(
      await screen.findByRole("heading", { name: "Lima를 설치해야 합니다.", level: 2 }),
    ).toBeInTheDocument();
  });

  it("moves from the detected Lima step to Docker Engine setup", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        instance: "overseer",
        message: "전용 Lima 인스턴스가 아직 없습니다.",
        phase: "missing",
      },
      volumes: [],
    };
    let limaInstalled = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/startup")) {
          return jsonResponse(startupSnapshot({ lima: limaInstalled }));
        }
        if (url.endsWith("/api/runtime/configuration")) {
          return jsonResponse(dockerEngineSnapshot());
        }
        if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
        return jsonResponse(dashboard);
      }),
    );
    window.history.replaceState(null, "", "/images");

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Lima를 설치해야 합니다.", level: 2 }),
    ).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/startup"));

    const refreshButton = await screen.findByRole("button", { name: "상태 새로고침" });
    await waitFor(() => expect(refreshButton).toBeEnabled());
    limaInstalled = true;
    await user.click(refreshButton);

    expect(
      await screen.findByRole("heading", { name: "Lima 설치를 확인했습니다.", level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Lima 설치 명령")).toBeInTheDocument();
    expect(screen.queryByText("또는")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다음" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "다음" }));

    expect(
      await screen.findByRole("heading", {
        name: "Docker Engine을 설정할 차례입니다.",
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("combobox", { name: "실행 환경" })).toHaveTextContent("Lima VM");
    const vmType = screen.getByRole("combobox", { name: "VM 드라이버" });
    expect(vmType).toHaveTextContent("Apple Virtualization (VZ)");
    expect(screen.getByLabelText("CPU")).toHaveValue("4");
    expect(screen.getByLabelText("메모리")).toHaveValue("4");
    expect(screen.getByLabelText("디스크")).toHaveValue("100");
    expect(
      screen.queryByText("QEMU가 설치되지 않았습니다. brew install qemu"),
    ).not.toBeInTheDocument();
    await user.click(vmType);
    expect(await screen.findByRole("option", { name: /QEMU/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Docker Engine 만들기" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "다음" })).not.toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/startup"));
  });

  it.each([1280, 390])("disables unavailable Compose navigation at viewport %i", async (width) => {
    mockViewport(width);
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      capabilities: { dockerCompose: false },
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    const accepted = operation("queued", {
      kind: "startup.install",
      successMessage: "Docker Compose를 설치했습니다.",
      target: { name: "compose", resource: "startup" },
      title: "Docker Compose 설치",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      if (url.endsWith("/api/startup/prerequisites/compose/install") && init?.method === "POST") {
        return jsonResponse({ operation: accepted }, 202);
      }
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/compose");

    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: "Docker Compose가 설치되지 않았습니다.",
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "직접 작성" })).not.toBeInTheDocument();

    if (width === 390) await user.click(screen.getByRole("button", { name: "주요 메뉴 열기" }));
    const composeLink = screen.getByRole("link", { name: "Compose" });
    expect(composeLink).toHaveAttribute("aria-disabled", "true");
    expect(composeLink).not.toHaveAttribute("href");
    await user.hover(composeLink);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "CLI 메뉴에서 Docker Compose를 설치해 주세요.",
    );
    await user.unhover(composeLink);
    await user.click(composeLink);
    expect(window.location.pathname).toBe("/compose");
    if (width === 390) await user.click(screen.getByRole("button", { name: "주요 메뉴 닫기" }));

    await user.click(screen.getByRole("button", { name: "Docker Compose 설치" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/startup/prerequisites/compose/install") &&
            init?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("creates the first Docker Engine from the startup setup form", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        instance: "overseer",
        message: "전용 Lima 인스턴스가 아직 없습니다.",
        phase: "missing",
      },
      volumes: [],
    };
    const accepted = operation("queued", {
      kind: "runtime.start",
      successMessage: "Docker Engine을 만들었습니다.",
      target: { name: "overseer", resource: "runtime" },
      title: "Docker Engine 만들기",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/runtime/configuration")) {
        return jsonResponse(dockerEngineSnapshot());
      }
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      if (url.endsWith("/api/runtime/start") && init?.method === "POST") {
        return jsonResponse({ operation: accepted }, 202);
      }
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: "Docker Engine을 설정할 차례입니다.",
        level: 2,
      }),
    ).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/startup"));
    const engineStatus = await screen.findByRole("region", { name: "Docker Engine 준비 상태" });
    expect(within(engineStatus).getByText("설정 필요")).toBeInTheDocument();
    expect(within(engineStatus).getByText("overseer")).toBeInTheDocument();
    expect(await screen.findByLabelText("CPU")).toHaveValue("4");
    await user.click(screen.getByRole("button", { name: "Docker Engine 만들기" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/runtime/start") && init?.method === "POST",
        ),
      ).toBe(true),
    );
    const createCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/runtime/start"),
    );
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      configuration: dockerEngineSnapshot().configuration,
    });
    expect(
      screen.getByRole("progressbar", { name: "Docker Engine 만들기 진행 중" }),
    ).toBeInTheDocument();
  });

  it("starts an existing stopped Docker Engine from the startup step", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        instance: "overseer",
        message: "중지됨",
        phase: "stopped",
      },
      volumes: [],
    };
    const accepted = operation("queued", {
      kind: "runtime.start",
      successMessage: "Lima 런타임을 시작했습니다.",
      target: { name: "overseer", resource: "runtime" },
      title: "런타임 시작",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      if (url.endsWith("/api/runtime/start") && init?.method === "POST") {
        return jsonResponse({ operation: accepted }, 202);
      }
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);

    window.history.replaceState(null, "", "/startup");
    render(<App />);
    for (let step = 0; step < 3; step += 1) {
      await user.click(await screen.findByRole("button", { name: "다음" }));
    }

    expect(
      await screen.findByRole("heading", {
        name: "Docker Engine을 시작할 차례입니다.",
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("CPU")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Docker Engine 시작" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/runtime/start") &&
            init?.method === "POST" &&
            init.body === undefined,
        ),
      ).toBe(true),
    );
    expect(screen.getByRole("progressbar", { name: "런타임 시작 진행 중" })).toBeInTheDocument();
  });

  it("force restarts a broken Docker Engine from the startup step", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        instance: "overseer-docker",
        message: "Lima 인스턴스 상태를 복구해야 합니다.",
        phase: "error",
      },
      volumes: [],
    };
    const accepted = operation("queued", {
      kind: "runtime.force-restart",
      target: { name: "Docker Engine", resource: "runtime" },
      title: "Docker Engine 강제 재시작",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      if (url.endsWith("/api/runtime/force-restart") && init?.method === "POST") {
        return jsonResponse({ operation: accepted }, 202);
      }
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Docker Engine 강제 재시작" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Docker Engine을 강제로 재시작하시겠습니까?",
    });
    await user.click(within(dialog).getByRole("button", { name: "강제 재시작" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/runtime/force-restart") && init?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("allows the engine setup to be deferred for the current app session", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        instance: "overseer-docker",
        message: "Lima 인스턴스 상태를 복구해야 합니다.",
        phase: "error",
      },
      volumes: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        if (String(input).endsWith("/api/operations")) return jsonResponse({ operations: [] });
        return jsonResponse(dashboard);
      }),
    );
    window.history.replaceState(null, "", "/containers");

    render(<App />);
    await user.click(await screen.findByRole("button", { name: "나중에 설정" }));

    expect(await screen.findByRole("heading", { name: "컨테이너", level: 1 })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/containers");
    expect(window.sessionStorage.getItem("overseer-engine-setup")).toBe("skipped");
  });

  it("creates a Lima instance from Instance settings", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        instance: "overseer",
        message: "전용 Lima 인스턴스가 아직 없습니다.",
        phase: "missing",
      },
      volumes: [],
    };
    const accepted = operation("queued", {
      kind: "runtime.start",
      successMessage: "dev Lima 인스턴스를 만들었습니다.",
      target: { name: "dev", resource: "runtime" },
      title: "Lima 인스턴스 만들기",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/startup/updates")) return jsonResponse(toolUpdateSnapshot());
      if (url.endsWith("/api/runtime/configuration")) return jsonResponse(dockerEngineSnapshot());
      if (url.endsWith("/api/runtime/instances")) {
        if (init?.method === "POST") return jsonResponse({ operation: accepted }, 202);
        return jsonResponse(runtimeInstancesSnapshot());
      }
      if (url.endsWith("/api/runtime/engine/configuration")) {
        return jsonResponse(dockerDaemonSnapshot(false));
      }
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/instances");
    render(<App />);

    const pageHeading = await screen.findByRole("heading", { name: "인스턴스", level: 1 });
    expect(
      within(pageHeading.closest(".overseer-page-header") as HTMLElement).getByText("엔진"),
    ).toBeInTheDocument();
    expect(await screen.findByRole("columnheader", { name: "가상화" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "컨테이너" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "활성" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "VM 인스턴스" })).not.toBeInTheDocument();
    const createButton = screen.getByRole("button", { name: "인스턴스 만들기" });
    expect(pageHeading.closest(".overseer-page-header")).toContainElement(createButton);
    const refreshButton = screen.getByRole("button", { name: "새로고침" });
    expect(
      refreshButton.compareDocumentPosition(createButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await waitFor(() => expect(createButton).toBeEnabled());
    await user.click(createButton);
    const dialog = await screen.findByRole("dialog", { name: "VM 인스턴스 만들기" });
    expect(within(dialog).getByLabelText("실행 환경")).toBeDisabled();
    await user.click(within(dialog).getByRole("combobox", { name: "VM 드라이버" }));
    expect(await screen.findByRole("option", { name: /QEMU/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.keyboard("{Escape}");
    expect(within(dialog).getByLabelText("CPU")).toHaveValue("4");
    expect(within(dialog).getByLabelText("메모리")).toHaveValue("4");
    expect(within(dialog).getByLabelText("디스크")).toHaveValue("100");
    await user.type(within(dialog).getByLabelText("인스턴스 이름"), "dev");
    await user.click(within(dialog).getByRole("button", { name: "인스턴스 만들기" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/runtime/instances") && init?.method === "POST",
        ),
      ).toBe(true),
    );
    const createCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/api/runtime/instances") && init?.method === "POST",
    );
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      configuration: dockerEngineSnapshot().configuration,
      name: "dev",
    });
  });

  it("moves VM and Docker connection details into an instance detail page", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        if (url.endsWith("/api/startup/updates")) return jsonResponse(toolUpdateSnapshot());
        if (url.endsWith("/api/runtime/configuration"))
          return jsonResponse(dockerEngineSnapshot("instance", true));
        if (url.endsWith("/api/runtime/instances")) {
          return jsonResponse(runtimeInstancesSnapshot([runtimeInstance()]));
        }
        if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
        return jsonResponse(dashboard);
      }),
    );
    window.history.replaceState(null, "", "/instances/overseer");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "overseer", level: 1 })).toBeInTheDocument();
    expect(await screen.findByText("1개 실행 중 · 전체 2개")).toBeInTheDocument();

    const pageHeader = screen
      .getByRole("heading", { name: "overseer", level: 1 })
      .closest(".overseer-page-header");
    const stopButton = await screen.findByRole("button", { name: "overseer 인스턴스 중지" });
    const instanceMenu = screen.getByRole("button", { name: "overseer 인스턴스 메뉴" });
    expect(pageHeader).toContainElement(stopButton);
    expect(pageHeader).toContainElement(instanceMenu);
    const instanceActions = stopButton.closest(".overseer-instance-header-actions");
    expect(instanceActions).toContainElement(instanceMenu);

    await user.click(instanceMenu);
    expect(
      await screen.findByRole("menuitem", { name: "현재 Docker Engine으로 사용 중" }),
    ).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");

    const navigation = screen.getByRole("navigation", { name: "VM 인스턴스 상세 메뉴" });
    const sidebar = screen.getByRole("complementary", { name: "Overseer 주요 탐색" });
    expect(sidebar).toContainElement(navigation);
    expect(screen.getByRole("main")).not.toContainElement(navigation);
    expect(within(sidebar).getByRole("link", { name: "인스턴스 목록으로" })).toHaveAttribute(
      "href",
      "/instances",
    );
    await user.click(within(navigation).getByRole("link", { name: "VM 설정" }));
    expect(window.location.search).toBe("?section=settings");
    expect(screen.getByText("Lima VM")).toBeInTheDocument();
    expect(screen.getByText("Apple Virtualization (VZ)")).toBeInTheDocument();
    expect(screen.getByText("100GiB")).toBeInTheDocument();

    await user.click(within(navigation).getByRole("link", { name: "터미널" }));
    expect(window.location.search).toBe("?section=terminal");
    expect(screen.getByLabelText("VM 인스턴스 터미널 명령")).toHaveTextContent(
      "limactl shell overseer",
    );
    expect(screen.getByRole("button", { name: "터미널 명령 복사" })).toBeEnabled();

    await user.click(within(navigation).getByRole("link", { name: "Docker 연결" }));
    expect(window.location.search).toBe("?section=connection");
    expect(screen.getByText("현재 사용 중")).toBeInTheDocument();
    expect(screen.getByText("29.7.2")).toBeInTheDocument();
    expect(screen.getByText("읽기/쓰기")).toBeInTheDocument();
    act(() => {
      window.history.replaceState(null, "", "/instances/overseer?section=settings");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(await screen.findByText("Lima VM")).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "VM 설정" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await user.click(within(sidebar).getByRole("link", { name: "인스턴스 목록으로" }));
    expect(await screen.findByRole("heading", { name: "인스턴스", level: 1 })).toBeInTheDocument();
    expect(window.location.search).toBe("");
    expect(
      screen.queryByRole("navigation", { name: "VM 인스턴스 상세 메뉴" }),
    ).not.toBeInTheDocument();
  });

  it("edits Docker daemon settings without network fields from Engine settings", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    const accepted = operation("queued", {
      kind: "runtime.daemon.configure",
      successMessage: "Docker Engine 설정을 적용했습니다.",
      target: { name: "overseer", resource: "runtime" },
      title: "Docker Engine 설정 적용",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/startup/updates")) return jsonResponse(toolUpdateSnapshot());
      if (url.endsWith("/api/runtime/configuration")) {
        return jsonResponse(dockerEngineSnapshot("instance", true));
      }
      if (url.includes("/api/runtime/engine/configuration/") && init?.method === "PATCH") {
        return jsonResponse({ operation: accepted }, 202);
      }
      if (url.endsWith("/api/runtime/engine/configuration")) {
        return jsonResponse(dockerDaemonSnapshot());
      }
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/settings?section=engine");
    render(<App />);

    await screen.findByRole("heading", { name: "엔진 설정", level: 1 });
    const navigation = screen.getByRole("navigation", { name: "주요 메뉴" });
    expect(
      within(navigation)
        .getAllByRole("link")
        .map(({ textContent }) => textContent),
    ).toEqual(["인스턴스", "엔진 설정", "네트워크 설정"]);
    expect(screen.queryByRole("navigation", { name: "설정 상세 메뉴" })).not.toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "엔진 설정" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      within(navigation).queryByRole("link", { name: "인스턴스 설정" }),
    ).not.toBeInTheDocument();
    await user.click(within(navigation).getByRole("link", { name: "엔진 설정" }));
    expect(window.location.search).toBe("?section=engine");
    const liveRestore = await screen.findByRole("switch", { name: "컨테이너 실행 유지" });
    expect(liveRestore).not.toBeChecked();
    expect(liveRestore.children).toHaveLength(1);
    expect(screen.getByRole("switch", { name: "디버그 모드" }).children).toHaveLength(1);
    expect(screen.queryByLabelText("DNS 서버")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Docker Engine 동작 및 진단 설정 저장" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "컨테이너 로그 설정 저장" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "전송 설정 저장" })).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "컨테이너 실행 유지" }));
    await user.click(screen.getByRole("combobox", { name: "로그 드라이버" }));
    await user.click(await screen.findByRole("option", { name: "로컬" }));
    await user.click(screen.getByRole("button", { name: "Docker Engine 동작 및 진단 설정 저장" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/runtime/engine/configuration/stability") &&
            init?.method === "PATCH",
        ),
      ).toBe(true),
    );
    const request = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/api/runtime/engine/configuration/stability") &&
        init?.method === "PATCH",
    );
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      configuration: { debug: false, liveRestore: true },
    });
  });

  it("owns Docker network and external connection fields in Network settings", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    const accepted = operation("queued", {
      kind: "runtime.daemon.configure",
      successMessage: "Docker Engine 설정을 적용했습니다.",
      target: { name: "overseer", resource: "runtime" },
      title: "Docker Engine 설정 적용",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/startup/updates")) return jsonResponse(toolUpdateSnapshot());
      if (url.endsWith("/api/runtime/configuration")) {
        return jsonResponse(dockerEngineSnapshot("instance", true));
      }
      if (url.includes("/api/runtime/engine/configuration/") && init?.method === "PATCH") {
        return jsonResponse({ operation: accepted }, 202);
      }
      if (url.endsWith("/api/runtime/engine/configuration")) {
        return jsonResponse(dockerDaemonSnapshot());
      }
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/settings?section=engine");
    render(<App />);

    await screen.findByRole("heading", { name: "엔진 설정", level: 1 });
    const navigation = screen.getByRole("navigation", { name: "주요 메뉴" });
    await user.click(within(navigation).getByRole("link", { name: "네트워크 설정" }));
    expect(window.location.search).toBe("?section=network");
    expect(
      await screen.findByRole("heading", { name: "네트워크 설정", level: 1 }),
    ).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "네트워크 설정" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await screen.findByLabelText("DNS 서버")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "컨테이너 실행 유지" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "추가 daemon.json 설정" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "네트워크 설정 저장" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "레지스트리 설정 저장" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "프록시 설정 저장" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("DNS 서버"), "1.1.1.1");
    await user.type(screen.getByLabelText("네트워크 주소 풀"), "172.30.0.0/16,24");
    await user.type(screen.getByLabelText("레지스트리 미러"), "https://mirror.gcr.io");
    await user.type(screen.getByLabelText("HTTP 프록시"), "http://proxy.example.com:3128");
    await user.type(screen.getByLabelText("프록시 제외"), "localhost");
    await user.click(screen.getByRole("button", { name: "네트워크 설정 초기화" }));
    expect(screen.getByLabelText("DNS 서버")).toHaveValue("");
    expect(screen.getByLabelText("네트워크 주소 풀")).toHaveValue("");
    expect(screen.getByLabelText("레지스트리 미러")).toHaveValue("https://mirror.gcr.io");
    expect(screen.getByLabelText("HTTP 프록시")).toHaveValue("http://proxy.example.com:3128");
    await user.type(screen.getByLabelText("DNS 서버"), "1.1.1.1");
    await user.type(screen.getByLabelText("네트워크 주소 풀"), "172.30.0.0/16,24");
    await user.click(screen.getByRole("button", { name: "네트워크 설정 저장" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/runtime/engine/configuration/network") &&
            init?.method === "PATCH",
        ),
      ).toBe(true),
    );
    const request = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith("/api/runtime/engine/configuration/network") &&
        init?.method === "PATCH",
    );
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      configuration: {
        defaultAddressPools: [{ base: "172.30.0.0/16", size: 24 }],
        dns: ["1.1.1.1"],
      },
    });
  });

  it("stops waiting for Docker network settings and retries after a timeout", async () => {
    const user = userEvent.setup();
    const firstRequest = new AbortController();
    const timeoutSpy = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValueOnce(firstRequest.signal)
      .mockImplementation(() => new AbortController().signal);
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    let configurationRequestCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/startup/updates")) return jsonResponse(toolUpdateSnapshot());
      if (url.endsWith("/api/runtime/configuration")) {
        return jsonResponse(dockerEngineSnapshot("instance", true));
      }
      if (url.endsWith("/api/runtime/engine/configuration")) {
        configurationRequestCount += 1;
        if (configurationRequestCount === 1) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
              once: true,
            });
          });
        }
        return jsonResponse(dockerDaemonSnapshot());
      }
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/settings?section=network");
    render(<App />);

    expect(await screen.findByLabelText("Docker Engine 설정 불러오는 중")).toBeInTheDocument();
    expect(timeoutSpy).toHaveBeenCalledWith(15_000);

    act(() => {
      firstRequest.abort(new DOMException("요청 시간이 초과되었습니다.", "TimeoutError"));
    });

    expect(
      await screen.findByText(
        "15초 안에 Docker Engine 설정 응답을 받지 못했습니다. VM 상태를 확인한 뒤 다시 시도하십시오.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(await screen.findByLabelText("DNS 서버")).toBeInTheDocument();
    expect(configurationRequestCount).toBe(2);
  });

  it("prepares a compatible Lima instance from Instance settings", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    const accepted = operation("queued", {
      kind: "runtime.connect",
      successMessage: "dev 인스턴스를 Overseer에서 사용할 수 있게 준비했습니다.",
      target: { name: "dev", resource: "runtime" },
      title: "Lima 인스턴스 사용 준비",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/startup/updates")) return jsonResponse(toolUpdateSnapshot());
      if (url.endsWith("/api/runtime/configuration")) {
        return jsonResponse(dockerEngineSnapshot("instance", true));
      }
      if (url.endsWith("/api/runtime/instances")) {
        return jsonResponse(
          runtimeInstancesSnapshot([
            runtimeInstance({
              active: false,
              homeMountWritable: false,
              managed: false,
              name: "dev",
              prepared: false,
            }),
          ]),
        );
      }
      if (url.endsWith("/api/runtime/engine/configuration")) {
        return jsonResponse(dockerDaemonSnapshot());
      }
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      if (url.endsWith("/api/runtime/instances/dev/prepare") && init?.method === "POST") {
        return jsonResponse({ operation: accepted }, 202);
      }
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/instances");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "dev Overseer 사용 준비" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/runtime/instances/dev/prepare") && init?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("keeps instance stop out of resource pages and owns it in Instance settings", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    const accepted = operation("queued", {
      kind: "runtime.stop",
      successMessage: "런타임을 중지했습니다.",
      target: { name: "overseer", resource: "runtime" },
      title: "런타임 중지",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/startup/updates")) return jsonResponse(toolUpdateSnapshot());
      if (url.endsWith("/api/runtime/configuration")) {
        return jsonResponse(dockerEngineSnapshot("instance", true));
      }
      if (url.endsWith("/api/runtime/instances")) {
        return jsonResponse(runtimeInstancesSnapshot([runtimeInstance()]));
      }
      if (url.endsWith("/api/runtime/engine/configuration")) {
        return jsonResponse(dockerDaemonSnapshot());
      }
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      if (url.endsWith("/api/runtime/instances/overseer/stop") && init?.method === "POST") {
        return jsonResponse({ operation: accepted }, 202);
      }
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/containers");
    render(<App />);

    await screen.findByRole("heading", { name: "컨테이너", level: 1 });
    expect(screen.queryByRole("button", { name: "런타임 중지" })).not.toBeInTheDocument();
    for (const page of ["Compose", "이미지", "볼륨", "네트워크", "작업 기록"] as const) {
      await user.click(screen.getByRole("link", { name: page }));
      expect(screen.queryByRole("button", { name: "런타임 중지" })).not.toBeInTheDocument();
    }

    await user.click(screen.getByRole("button", { name: "엔진" }));
    await user.click(screen.getByRole("link", { name: "인스턴스" }));
    await user.click(await screen.findByRole("button", { name: "overseer 인스턴스 중지" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/runtime/instances/overseer/stop") &&
            init?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("starts a stopped Lima instance from Instance settings", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        instance: "overseer",
        message: "중지됨",
        phase: "stopped",
      },
      volumes: [],
    };
    const accepted = operation("queued", {
      kind: "runtime.start",
      successMessage: "런타임을 시작했습니다.",
      target: { name: "overseer", resource: "runtime" },
      title: "런타임 시작",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/startup/updates")) return jsonResponse(toolUpdateSnapshot());
      if (url.endsWith("/api/runtime/configuration")) {
        return jsonResponse(dockerEngineSnapshot("instance", true));
      }
      if (url.endsWith("/api/runtime/instances")) {
        return jsonResponse(
          runtimeInstancesSnapshot([
            runtimeInstance({ dockerVersion: undefined, status: "Stopped" }),
          ]),
        );
      }
      if (url.endsWith("/api/runtime/engine/configuration")) {
        return jsonResponse(dockerDaemonSnapshot(false));
      }
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      if (url.endsWith("/api/runtime/instances/overseer/start") && init?.method === "POST") {
        return jsonResponse({ operation: accepted }, 202);
      }
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/instances");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "overseer 인스턴스 시작" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/runtime/instances/overseer/start") &&
            init?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("force stops a broken Lima instance from its row menu", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        instance: "overseer-docker",
        message: "Lima 인스턴스 상태를 복구해야 합니다.",
        phase: "error",
      },
      volumes: [],
    };
    const accepted = operation("queued", {
      kind: "runtime.instance.force-stop",
      target: { name: "overseer-docker", resource: "runtime" },
      title: "Lima 인스턴스 강제 중지",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/runtime/configuration")) {
        return jsonResponse(dockerEngineSnapshot("instance", true));
      }
      if (url.endsWith("/api/runtime/instances")) {
        return jsonResponse(
          runtimeInstancesSnapshot([
            runtimeInstance({ name: "overseer-docker", status: "Broken" }),
          ]),
        );
      }
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      if (
        url.endsWith("/api/runtime/instances/overseer-docker/force-stop") &&
        init?.method === "POST"
      ) {
        return jsonResponse({ operation: accepted }, 202);
      }
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/instances");

    render(<App />);
    await user.click(await screen.findByRole("button", { name: "overseer-docker 인스턴스 메뉴" }));
    await user.click(await screen.findByRole("menuitem", { name: "강제 중지" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "overseer-docker 인스턴스를 강제로 중지하시겠습니까?",
    });
    await user.click(within(dialog).getByRole("button", { name: "강제 중지" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/runtime/instances/overseer-docker/force-stop") &&
            init?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("updates and deletes managed instances from the row menu", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/startup/updates")) return jsonResponse(toolUpdateSnapshot());
      if (url.endsWith("/api/runtime/configuration")) {
        return jsonResponse(dockerEngineSnapshot("instance", true));
      }
      if (url.endsWith("/api/runtime/instances") && !init?.method) {
        return jsonResponse(
          runtimeInstancesSnapshot([
            runtimeInstance(),
            runtimeInstance({ active: false, managed: false, name: "external" }),
          ]),
        );
      }
      if (url.endsWith("/api/runtime/engine/configuration")) {
        return jsonResponse(dockerDaemonSnapshot());
      }
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      if (url.endsWith("/api/runtime/instances/overseer") && init?.method === "PATCH") {
        return jsonResponse(
          {
            operation: operation("succeeded", {
              kind: "runtime.instance.update",
              target: { name: "overseer", resource: "runtime" },
              title: "Lima 인스턴스 수정",
            }),
          },
          202,
        );
      }
      if (url.endsWith("/api/runtime/instances/overseer") && init?.method === "DELETE") {
        return jsonResponse(
          {
            operation: operation("succeeded", {
              kind: "runtime.instance.delete",
              target: { name: "overseer", resource: "runtime" },
              title: "Lima 인스턴스 삭제",
            }),
          },
          202,
        );
      }
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/instances");
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "overseer 인스턴스 메뉴" }));
    await user.click(await screen.findByRole("menuitem", { name: "수정" }));
    const editDialog = await screen.findByRole("dialog", { name: "overseer 인스턴스 수정" });
    const cpus = within(editDialog).getByLabelText("CPU");
    expect(cpus).toHaveValue("4");
    expect(within(editDialog).getByRole("button", { name: "저장" })).toBeDisabled();
    await user.clear(cpus);
    await user.type(cpus, "6");
    const save = within(editDialog).getByRole("button", { name: "저장" });
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([request, init]) =>
            String(request).endsWith("/api/runtime/instances/overseer") && init?.method === "PATCH",
        ),
      ).toBe(true),
    );
    const updateCall = fetchMock.mock.calls.find(
      ([request, init]) =>
        String(request).endsWith("/api/runtime/instances/overseer") && init?.method === "PATCH",
    );
    expect(JSON.parse(String(updateCall?.[1]?.body))).toEqual({
      configuration: { cpus: 6, diskGiB: 100, memoryGiB: 4 },
    });

    await user.click(screen.getByRole("button", { name: "overseer 인스턴스 메뉴" }));
    await user.click(await screen.findByRole("menuitem", { name: "삭제" }));
    const deleteDialog = await screen.findByRole("alertdialog", {
      name: "overseer 인스턴스를 삭제하시겠습니까?",
    });
    const deleteButton = within(deleteDialog).getByRole("button", { name: "삭제" });
    expect(deleteButton).toBeDisabled();
    await user.type(within(deleteDialog).getByLabelText("인스턴스 이름 확인"), "overseer");
    expect(deleteButton).toBeEnabled();
    await user.click(deleteButton);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([request, init]) =>
            String(request).endsWith("/api/runtime/instances/overseer") &&
            init?.method === "DELETE",
        ),
      ).toBe(true),
    );
    const deleteCall = fetchMock.mock.calls.find(
      ([request, init]) =>
        String(request).endsWith("/api/runtime/instances/overseer") && init?.method === "DELETE",
    );
    expect(JSON.parse(String(deleteCall?.[1]?.body))).toEqual({ confirmation: "overseer" });

    await user.click(screen.getByRole("button", { name: "external 인스턴스 메뉴" }));
    expect(await screen.findByRole("menuitem", { name: "수정" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("menuitem", { name: "삭제" })).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps startup preparation in general settings without duplicating CLI tool updates", async () => {
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/startup/updates")) return jsonResponse(toolUpdateSnapshot());
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/settings");
    render(<App />);

    const startupHeading = await screen.findByRole("heading", { name: "시작 준비", level: 2 });
    expect(startupHeading).toHaveClass("city-text-subsection-title");
    const startupLink = (await screen.findByText("시작 준비 열기")).closest("a");
    expect(startupLink).toHaveAttribute("href", "/startup");
    expect(screen.queryByRole("heading", { name: "도구 업데이트" })).not.toBeInTheDocument();
    const appUpdates = screen.getByRole("region", { name: "업데이트 관리" });
    expect(within(appUpdates).getByRole("button", { name: "업데이트 확인" })).toBeDisabled();
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("/api/startup/updates")),
    ).toBe(false);
  });

  it("selects one prepared instance as the active Docker Engine", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [
        { configFiles: ["/workspace/compose.yaml"], name: "demo", status: "running(1)" },
      ],
      containers: [
        {
          id: "container-id",
          image: "nginx:alpine",
          name: "web",
          ports: "",
          state: "running",
          status: "Up",
        },
      ],
      images: [
        {
          createdAt: "2026-08-24T10:00:00.000Z",
          createdSince: "today",
          id: "image-id",
          platform: "linux/arm64",
          repository: "nginx",
          size: "20MB",
          tag: "alpine",
          url: "docker.io/library/nginx:alpine",
        },
      ],
      networks: [
        {
          builtIn: false,
          createdAt: "today",
          driver: "bridge",
          id: "network-id",
          internal: false,
          ipv4: true,
          ipv6: false,
          labels: "",
          name: "app-network",
          scope: "local",
        },
      ],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [{ driver: "local", labels: "", name: "app-data", scope: "local" }],
    };
    const accepted = operation("queued", {
      kind: "runtime.connect",
      successMessage: "dev 인스턴스를 활성 Docker Engine으로 선택했습니다.",
      target: { name: "dev", resource: "runtime" },
      title: "활성 인스턴스 선택",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/startup/updates")) return jsonResponse(toolUpdateSnapshot());
      if (url.endsWith("/api/runtime/configuration")) {
        return jsonResponse(dockerEngineSnapshot("instance", true));
      }
      if (url.endsWith("/api/runtime/instances")) {
        return jsonResponse(
          runtimeInstancesSnapshot([
            runtimeInstance(),
            runtimeInstance({ active: false, managed: false, name: "dev" }),
          ]),
        );
      }
      if (url.endsWith("/api/runtime/engine/configuration")) {
        return jsonResponse(dockerDaemonSnapshot());
      }
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      if (url.endsWith("/api/runtime/instances/dev/select") && init?.method === "POST") {
        return jsonResponse({ operation: accepted }, 202);
      }
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/instances");
    render(<App />);
    const activeLabel = await screen.findByText("Docker Engine으로 사용 중");
    const activeRow = activeLabel.closest("tr");
    expect(activeRow).not.toBeNull();
    expect(within(activeRow!).getByRole("link", { name: "overseer" })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "dev 인스턴스 메뉴" }));
    await user.click(await screen.findByRole("menuitem", { name: "Docker Engine으로 사용" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/runtime/instances/dev/select") && init?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("shows the running empty state and primary actions", async () => {
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "Lima와 Docker가 정상적으로 실행 중입니다.",
        phase: "running",
      },
      volumes: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/api/startup")
          ? jsonResponse(startupSnapshot())
          : jsonResponse(dashboard),
      ),
    );

    render(<App />);

    expect(await screen.findByText("컨테이너가 없습니다.")).toBeInTheDocument();
    const primaryAction = await screen.findByRole("button", { name: "컨테이너 실행" });
    const pageHeader = screen
      .getByRole("heading", { name: "컨테이너", level: 1 })
      .closest(".overseer-page-header");
    expect(primaryAction).toBeEnabled();
    expect(pageHeader).toContainElement(primaryAction);
    expect(screen.getByText("컨테이너 0개 실행 중")).toBeInTheDocument();
  });

  it("shows the expanded City DS container configuration sections", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [
        {
          createdAt: "2026-08-24T10:00:00.000Z",
          createdSince: "today",
          id: "image-id",
          platform: "linux/arm64",
          repository: "nginx",
          size: "20MB",
          tag: "alpine",
          url: "docker.io/library/nginx:alpine",
        },
      ],
      networks: [
        {
          builtIn: true,
          createdAt: "today",
          driver: "bridge",
          id: "network-id",
          internal: false,
          ipv4: true,
          ipv6: false,
          labels: "",
          name: "bridge",
          scope: "local",
        },
      ],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [{ driver: "local", labels: "", name: "app-data", scope: "local" }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        return String(input).endsWith("/api/operations")
          ? jsonResponse({ operations: [] })
          : jsonResponse(dashboard);
      }),
    );
    render(<App />);
    await screen.findByText("컨테이너가 없습니다.");

    await user.click(await screen.findByRole("button", { name: "컨테이너 실행" }));
    const dialog = await screen.findByRole("dialog", { name: "컨테이너 실행" });
    expect(dialog).toHaveTextContent("기본 설정");
    expect(dialog).toHaveTextContent("실행 정책과 리소스");
    expect(dialog).toHaveTextContent("메타데이터");
    await user.click(screen.getByRole("button", { name: "포트 추가" }));
    expect(screen.getByLabelText("컨테이너 포트 1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "환경 변수 추가" }));
    expect(screen.getByRole("textbox", { name: "환경 변수 이름 1" })).toBeInTheDocument();
    expect(screen.getByLabelText("CPU 수")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog", { name: "컨테이너 실행" })).not.toBeInTheDocument();
    expect(document.querySelector("[data-base-ui-inert]")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "작업" }));
    expect(await screen.findByRole("heading", { name: "작업" })).toBeInTheDocument();
    expect(screen.getByText("확인할 작업이 없습니다.")).toBeInTheDocument();
  });

  it("keeps immutable fields read-only for an unmanaged container", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [
        {
          id: "container-id",
          image: "nginx:alpine",
          name: "web",
          ports: "",
          state: "running",
          status: "Up",
        },
      ],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
        if (url.endsWith("/api/containers/container-id")) {
          return jsonResponse({
            container: {
              configHash: "a".repeat(64),
              id: "container-id",
              mounts: [],
              replacementBlockers: ["Overseer에서 만든 컨테이너가 아닙니다."],
              running: true,
              spec: { ...emptyContainerSpec(), image: "nginx:alpine", name: "web" },
            },
          });
        }
        return jsonResponse(dashboard);
      }),
    );
    render(<App />);
    await screen.findByRole("row", { name: /web/ });

    await user.click(screen.getByRole("button", { name: "web 설정" }));
    expect(await screen.findByRole("dialog", { name: "web 설정" })).toBeInTheDocument();
    expect(screen.getByText("일부 설정은 읽기 전용입니다.")).toBeInTheDocument();
    expect(screen.getByLabelText("이미지")).toBeDisabled();
    expect(screen.getByLabelText("이름")).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "취소" }));
    expect(screen.queryByRole("dialog", { name: "web 설정" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "작업" }));
    expect(await screen.findByRole("heading", { name: "작업" })).toBeInTheDocument();
  });

  it("shows queued work in the City DS operation drawer and cancels it", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/api/startup")) return jsonResponse(startupSnapshot());

        if (String(input).endsWith("/api/operations/operation-id") && init?.method === "DELETE") {
          return jsonResponse({
            operation: { ...operation("cancelled"), finishedAt: "2026-08-23T10:00:01.000Z" },
          });
        }
        if (String(input).endsWith("/api/operations")) {
          return jsonResponse({ operations: [operation()] });
        }
        return jsonResponse(dashboard);
      }),
    );
    render(<App />);
    await screen.findByText("컨테이너가 없습니다.");

    await user.click(await screen.findByRole("button", { name: /^작업/ }));
    expect(await screen.findByRole("heading", { name: "작업" })).toBeInTheDocument();
    expect(screen.getByText("볼륨 만들기")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "대기 작업 취소" }));
    expect(await screen.findByText("확인할 작업이 없습니다.")).toBeInTheDocument();
  });

  it("separates attention work in the drawer from persistent history and retries failures", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    const operationOutputLines = Array.from({ length: 20 }, (_, index) => `docker output ${index}`);
    const history = [
      operation("queued", { id: "queued-id", title: "대기 작업" }),
      operation("running", { id: "running-id", step: "실행 중", title: "진행 작업" }),
      operation("failed", {
        error: { code: "docker_command_failed", message: "포트 충돌" },
        finishedAt: "2026-08-23T10:00:03.000Z",
        id: "failed-id",
        output: operationOutputLines,
        retryable: true,
        step: "실패함",
        title: "실패 작업",
      }),
      operation("succeeded", {
        finishedAt: "2026-08-23T10:00:02.000Z",
        id: "succeeded-id",
        title: "완료 작업",
      }),
      operation("cancelled", {
        finishedAt: "2026-08-23T10:00:01.000Z",
        id: "cancelled-id",
        step: "취소됨",
        title: "취소 작업",
      }),
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/operations/failed-id/retry") && init?.method === "POST") {
        return jsonResponse(
          {
            operation: operation("queued", {
              id: "retry-id",
              retriedFromId: "failed-id",
              title: "실패 작업",
            }),
          },
          202,
        );
      }
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: history });
      if (url.includes("/api/operations?")) {
        return jsonResponse({
          operations: history,
          pagination: {
            page: 1,
            pageSize: 20,
            total: history.length,
            totalPages: 1,
          },
        });
      }
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/containers");
    const app = render(<App />);
    await screen.findByText("컨테이너가 없습니다.");

    await user.click(await screen.findByRole("button", { name: /^작업/ }));
    const drawer = await screen.findByRole("dialog", { name: "작업" });
    expect(within(drawer).getByText("대기 작업")).toBeInTheDocument();
    expect(within(drawer).getByText("진행 작업")).toBeInTheDocument();
    expect(within(drawer).getByText("실패 작업")).toBeInTheDocument();
    expect(within(drawer).queryByText("완료 작업")).not.toBeInTheDocument();
    expect(within(drawer).queryByText("취소 작업")).not.toBeInTheDocument();
    expect(within(drawer).getByText("대기 중", { selector: "[data-city-badge]" })).toHaveAttribute(
      "data-tone",
      "neutral",
    );
    expect(within(drawer).getByText("진행 중", { selector: "[data-city-badge]" })).toHaveAttribute(
      "data-tone",
      "info",
    );
    const drawerOutput = within(drawer).getByRole("region", { name: "실패 작업 출력" });
    const drawerCode = drawerOutput.querySelector(".overseer-log-viewer-code");
    expect(drawerOutput).toHaveAttribute("data-height", "compact");
    expect(drawerCode?.querySelector("code")?.textContent).toBe(operationOutputLines.join("\n"));
    await user.click(within(drawerOutput).getByRole("button", { name: "크게 보기" }));
    const fullscreenOutput = await screen.findByRole("region", {
      name: "실패 작업 출력 전체 화면",
    });
    expect(fullscreenOutput.querySelector("code")?.textContent).toBe(
      operationOutputLines.join("\n"),
    );
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "실패 작업 출력 전체 화면" }),
      ).not.toBeInTheDocument(),
    );
    await user.click(within(drawerOutput).getByRole("button", { name: "로그 옵션" }));
    const drawerLogOptions = await screen.findByRole("menu");
    expect(
      within(drawerLogOptions).getByRole("menuitemcheckbox", { name: "줄 번호" }),
    ).toBeInTheDocument();
    expect(
      within(drawerLogOptions).getByRole("menuitemradio", { name: "크게" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");

    const dismissFailure = within(drawer).getByRole("button", {
      name: "실패 작업 패널에서 지우기",
    });
    expect(dismissFailure).toHaveAttribute("data-city-icon-only");
    await user.hover(dismissFailure);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("패널에서 지우기");
    await user.click(dismissFailure);
    expect(within(drawer).queryByText("실패 작업")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("overseer-dismissed-operation-failures")).toBe(
      '["failed-id"]',
    );

    const viewAllOperations = within(drawer).getByRole("button", { name: "전체 작업 보기" });
    expect(viewAllOperations).toHaveClass("bg-city-primary");
    await user.click(viewAllOperations);
    expect(await screen.findByRole("heading", { name: "작업 기록", level: 1 })).toBeInTheDocument();
    const historyTable = await screen.findByRole("table", { name: "전체 작업 기록" });
    expect(
      within(historyTable)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["요청 시각", "작업", "상태", "소요", "상세"]);
    expect(historyTable.querySelectorAll("thead .overseer-table-column-wide")).toHaveLength(1);
    expect(historyTable.querySelector("time")).toHaveTextContent(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
    expect(screen.getByText("완료 작업")).toBeInTheDocument();
    expect(screen.getByText("취소 작업")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/operations");

    const failedRow = screen.getByRole("row", { name: /실패 작업/ });
    expect(failedRow).toHaveTextContent("볼륨 · app-data");
    const failedStatus = within(failedRow).getByText("실패", { selector: "[data-city-badge]" });
    expect(failedStatus).toHaveAttribute("data-appearance", "subtle");
    expect(failedStatus).toHaveAttribute("data-city-size", "lg");
    expect(within(failedRow).queryByRole("button", { name: "재시도" })).not.toBeInTheDocument();
    await user.click(within(failedRow).getByRole("button", { name: "상세" }));
    const detail = await screen.findByRole("dialog", { name: "실패 작업" });
    expect(detail).toHaveTextContent("포트 충돌");
    expect(detail).toHaveTextContent("docker output 0");
    expect(detail).toHaveTextContent("docker output 19");
    expect(within(detail).getByText("실패", { selector: "[data-city-badge]" })).toHaveAttribute(
      "data-appearance",
      "subtle",
    );
    const operationOutput = detail.querySelector(".overseer-log-viewer-code");
    expect(operationOutput?.tagName).toBe("PRE");
    expect(operationOutput?.querySelector("code")?.textContent).toBe(
      operationOutputLines.join("\n"),
    );
    expect(operationOutput).toHaveAttribute("data-wrap", "false");
    expect(operationOutput).toHaveAttribute("data-line-numbers", "false");
    expect(operationOutput).toHaveAttribute("data-font-size", "medium");
    const operationOptionsTrigger = within(detail).getByRole("button", { name: "로그 옵션" });
    expect(operationOptionsTrigger).toHaveAttribute("data-city-icon-only");
    await user.click(operationOptionsTrigger);
    const operationOptions = await screen.findByRole("menu");
    const operationLineWrap = within(operationOptions).getByRole("menuitemcheckbox", {
      name: "줄 바꿈",
    });
    const operationLineNumbers = within(operationOptions).getByRole("menuitemcheckbox", {
      name: "줄 번호",
    });
    expect(operationLineWrap).toHaveAttribute("aria-checked", "false");
    expect(operationLineNumbers).toHaveAttribute("aria-checked", "false");
    expect(within(operationOptions).getByRole("menuitemradio", { name: "보통" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.click(operationLineWrap);
    expect(operationLineWrap).toHaveAttribute("aria-checked", "true");
    expect(operationOutput).toHaveAttribute("data-wrap", "true");
    await user.click(operationLineNumbers);
    expect(operationLineNumbers).toHaveAttribute("aria-checked", "true");
    expect(operationOutput).toHaveAttribute("data-line-numbers", "true");
    expect(operationOutput?.querySelectorAll(".overseer-log-code-line")).toHaveLength(20);
    await user.click(within(operationOptions).getByRole("menuitemradio", { name: "크게" }));
    expect(operationOutput).toHaveAttribute("data-font-size", "large");
    await user.keyboard("{Escape}");
    await user.click(within(detail).getByRole("button", { name: "작업 재시도" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/operations/failed-id/retry") && init?.method === "POST",
        ),
      ).toBe(true),
    );

    app.unmount();
    window.history.replaceState(null, "", "/containers");
    render(<App />);
    await screen.findByText("컨테이너가 없습니다.");
    await user.click(await screen.findByRole("button", { name: /^작업/ }));
    const reopenedDrawer = await screen.findByRole("dialog", { name: "작업" });
    expect(within(reopenedDrawer).queryByText("실패 작업")).not.toBeInTheDocument();
    expect(within(reopenedDrawer).getByText("대기 작업")).toBeInTheDocument();
  });

  it("paginates and searches persistent operation history", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    const history = Array.from({ length: 25 }, (_, index) =>
      operation("succeeded", {
        id: `operation-${index}`,
        target: { name: `service-${index}`, resource: "container" },
        title: `작업 ${index}`,
      }),
    );
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: history });
      if (url.includes("/api/operations?")) {
        const params = new URL(url, "http://localhost").searchParams;
        const query = params.get("query") ?? "";
        const page = Number(params.get("page") ?? "1");
        const pageSize = Number(params.get("pageSize") ?? "20");
        const filtered = history.filter(
          (item) => item.title.includes(query) || item.target.name.includes(query),
        );
        return jsonResponse({
          operations: filtered.slice((page - 1) * pageSize, page * pageSize),
          pagination: {
            page,
            pageSize,
            total: filtered.length,
            totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
          },
        });
      }
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/operations");
    render(<App />);

    expect(await screen.findByText("전체 25개 · 1 / 2페이지")).toBeInTheDocument();
    const operationSearch = screen.getByRole("searchbox", { name: "작업 검색" });
    const statusFilter = screen.getByRole("combobox", { name: "상태" });
    const resourceFilter = screen.getByRole("combobox", { name: "리소스" });
    expect(operationSearch.closest(".overseer-operation-search-filter")).toBeInTheDocument();
    expect(statusFilter.closest(".overseer-operation-select-filter")).toBeInTheDocument();
    expect(resourceFilter.closest(".overseer-operation-select-filter")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "검색" })).toHaveAttribute("data-city-icon-only");
    expect(screen.queryByText("작업 검색")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "2페이지" }));
    expect(await screen.findByText("작업 24")).toBeInTheDocument();
    expect(screen.getByText("전체 25개 · 2 / 2페이지")).toBeInTheDocument();

    await user.type(screen.getByRole("searchbox", { name: "작업 검색" }), "작업 24");
    await user.click(screen.getByRole("button", { name: "검색" }));
    expect(await screen.findByText("전체 1개 · 1 / 1페이지")).toBeInTheDocument();
    expect(screen.getByText("작업 24")).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("query=%EC%9E%91%EC%97%85+24")),
    ).toBe(true);
    await user.click(screen.getByRole("button", { name: "검색어 지우기" }));
    expect(await screen.findByText("전체 25개 · 1 / 2페이지")).toBeInTheDocument();
  });

  it("opens each category first page and keeps selection synchronized with the URL", async () => {
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
        if (url.endsWith("/api/runtime/instances")) return jsonResponse(runtimeInstancesSnapshot());
        if (url.endsWith("/api/runtime/configuration"))
          return jsonResponse(dockerEngineSnapshot("instance", true));
        if (url.endsWith("/api/runtime/engine/configuration"))
          return jsonResponse(dockerDaemonSnapshot());
        if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        if (url.endsWith("/api/startup/updates")) return jsonResponse(toolUpdateSnapshot());
        if (url.endsWith("/api/image-repositories")) return jsonResponse({ repositories: [] });
        if (url.endsWith("/api/docker-cli/plugins")) return jsonResponse({ plugins: [] });
        return jsonResponse(dashboard);
      }),
    );
    render(<App />);
    await screen.findByText("컨테이너가 없습니다.");

    const user = userEvent.setup();
    const sidebar = screen.getByRole("complementary", { name: "Overseer 주요 탐색" });
    const navigation = within(sidebar).getByRole("navigation", { name: "주요 메뉴" });
    expect(
      within(navigation)
        .getAllByRole("link")
        .map(({ textContent }) => textContent),
    ).toEqual(["Compose", "컨테이너", "이미지", "빌드", "볼륨", "네트워크"]);
    expect(within(sidebar).getByRole("button", { name: "도커" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(within(sidebar).getByRole("button", { name: "엔진" }));
    expect(await screen.findByRole("heading", { name: "인스턴스", level: 1 })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/instances");
    expect(within(navigation).getByRole("link", { name: "인스턴스" })).toHaveAttribute(
      "href",
      "/instances",
    );
    expect(within(navigation).getByRole("link", { name: "엔진 설정" })).toHaveAttribute(
      "href",
      "/settings?section=engine",
    );
    expect(within(navigation).getByRole("link", { name: "네트워크 설정" })).toHaveAttribute(
      "href",
      "/settings?section=network",
    );
    await user.click(within(navigation).getByRole("link", { name: "네트워크 설정" }));
    expect(
      await screen.findByRole("heading", { name: "네트워크 설정", level: 1 }),
    ).toBeInTheDocument();
    await user.click(within(sidebar).getByRole("button", { name: "엔진" }));
    expect(await screen.findByRole("heading", { name: "인스턴스", level: 1 })).toBeInTheDocument();
    expect(window.location.search).toBe("");
    await user.click(within(sidebar).getByRole("button", { name: "공급자" }));
    expect(
      await screen.findByRole("heading", { name: "이미지 저장소", level: 1 }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/image-repositories");
    expect(within(navigation).getByRole("link", { name: "이미지 저장소" })).toHaveAttribute(
      "href",
      "/image-repositories",
    );
    await user.click(within(sidebar).getByRole("button", { name: "CLI" }));
    expect(await screen.findByRole("heading", { name: "도구", level: 1 })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/docker-plugins");
    expect(within(navigation).getByRole("link", { name: "도구" })).toHaveAttribute(
      "href",
      "/docker-plugins",
    );
    const utilities = within(sidebar).getByRole("navigation", { name: "유틸리티 메뉴" });
    expect(within(utilities).getByRole("link", { name: "작업 기록" })).toHaveAttribute(
      "href",
      "/operations",
    );
    expect(within(utilities).getByRole("link", { name: "일반 설정" })).toHaveAttribute(
      "href",
      "/settings?section=general",
    );
    await user.click(within(utilities).getByRole("link", { name: "작업 기록" }));
    expect(await screen.findByRole("heading", { name: "작업 기록", level: 1 })).toBeInTheDocument();
    act(() => {
      window.history.replaceState(null, "", "/containers");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(await screen.findByRole("heading", { name: "컨테이너", level: 1 })).toBeInTheDocument();
    expect(within(sidebar).getByRole("button", { name: "도커" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.click(within(sidebar).getByRole("button", { name: "도커" }));
    expect(await screen.findByRole("heading", { name: "Compose", level: 1 })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/compose");
    await user.click(within(navigation).getByRole("link", { name: "이미지" }));
    expect(await screen.findByRole("heading", { name: "이미지", level: 1 })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/images");
  });

  it.each([
    { width: 1280, path: "/operations/lima", category: "lima", label: "Lima" },
    { width: 783, path: "/operations/docker-cli", category: "docker-cli", label: "Docker CLI" },
    { width: 390, path: "/operations/lima", category: "lima", label: "Lima" },
  ])(
    "restores and switches operation categories at $width px",
    async ({ width, path, category, label }) => {
      mockViewport(width);
      const dashboard: DashboardSnapshot = {
        composeProjects: [],
        containers: [],
        images: [],
        networks: [],
        volumes: [],
        runtime: { instance: "overseer", message: "중지됨", phase: "stopped" },
      };
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        if (url.includes("/api/operations"))
          return jsonResponse({
            operations: [],
            pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
          });
        return jsonResponse(dashboard);
      });
      vi.stubGlobal("fetch", fetchMock);
      window.history.replaceState(null, "", path);
      render(<App />);
      await screen.findByRole("heading", { name: `${label} 작업 기록`, level: 1 });
      await screen.findByRole("table", { name: `${label} 작업 기록` });
      const user = userEvent.setup();
      const menu = async () => {
        if (width > 672) return within(screen.getByRole("navigation", { name: "주요 메뉴" }));
        await user.click(screen.getByRole("button", { name: "주요 메뉴 열기" }));
        return within(await screen.findByRole("navigation", { name: "작업 기록 메뉴" }));
      };
      const initialMenu = await menu();
      expect(initialMenu.getByRole("link", { name: label })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(initialMenu.getAllByRole("link").map(({ textContent }) => textContent)).toEqual([
        "전체",
        "Lima",
        "Docker CLI",
      ]);
      if (width <= 672) await user.click(screen.getByRole("button", { name: "주요 메뉴 닫기" }));
      expect(
        fetchMock.mock.calls.some(
          ([input]) =>
            new URL(String(input), "http://localhost").searchParams.get("category") === category,
        ),
      ).toBe(true);
      await user.type(screen.getByRole("searchbox", { name: "작업 검색" }), "old-query");
      await user.click(screen.getByRole("button", { name: "검색" }));
      await waitFor(() =>
        expect(
          fetchMock.mock.calls.some(([input]) => String(input).includes("query=old-query")),
        ).toBe(true),
      );
      await user.click(
        (await menu()).getByRole("link", { name: category === "lima" ? "Docker CLI" : "Lima" }),
      );
      const nextLabel = category === "lima" ? "Docker CLI" : "Lima";
      const nextCategory = category === "lima" ? "docker-cli" : "lima";
      await screen.findByRole("table", { name: `${nextLabel} 작업 기록` });
      expect(window.location.pathname).toBe(`/operations/${nextCategory}`);
      expect(screen.getByRole("searchbox", { name: "작업 검색" })).toHaveValue("");
      const lastHistoryRequest = fetchMock.mock.calls
        .map(([input]) => String(input))
        .filter((url) => url.includes("/operations?"))
        .at(-1)!;
      expect(new URL(lastHistoryRequest, "http://localhost").searchParams.get("query")).toBeNull();
      expect(new URL(lastHistoryRequest, "http://localhost").searchParams.get("page")).toBe("1");
      await user.click((await menu()).getByRole("link", { name: "전체" }));
      await screen.findByRole("table", { name: "전체 작업 기록" });
      expect(window.location.pathname).toBe("/operations");
      act(() => {
        window.history.replaceState(null, "", path);
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      await screen.findByRole("table", { name: `${label} 작업 기록` });
      expect((await menu()).getByRole("link", { name: label })).toHaveAttribute(
        "aria-current",
        "page",
      );
    },
  );

  it("shows Docker CLI plugins and requests a Buildx installation", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        instance: "overseer",
        message: "중지됨",
        phase: "stopped",
      },
      volumes: [],
    };
    const accepted = operation("queued", {
      kind: "docker.plugin.install",
      target: { id: "buildx", name: "Docker Buildx", resource: "dockerPlugin" },
      title: "Docker Buildx 설치",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      if (url.endsWith("/api/docker-cli/plugins/buildx/install") && init?.method === "POST") {
        return jsonResponse({ operation: accepted }, 202);
      }
      if (url.endsWith("/api/docker-cli/plugins")) {
        return jsonResponse({
          plugins: [
            {
              description: "BuildKit 기반 빌드",
              id: "buildx",
              installAvailable: true,
              installed: false,
              label: "Docker Buildx",
              management: "extensions",
              source: "homebrew",
            },
            {
              description: "Compose 프로젝트 실행",
              id: "compose",
              installAvailable: false,
              installed: true,
              label: "Docker Compose",
              management: "startup",
              source: "homebrew",
              version: "2.40.0",
            },
          ],
        });
      }
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/docker-plugins");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "도구", level: 1 })).toBeInTheDocument();
    expect(await screen.findByRole("list", { name: "Docker CLI 도구 목록" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Docker Buildx 설치" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/docker-cli/plugins/buildx/install") &&
            init?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("uses an accessible icon rail at tablet width", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    mockViewport(783);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        return String(input).endsWith("/api/operations")
          ? jsonResponse({ operations: [] })
          : jsonResponse(dashboard);
      }),
    );
    window.history.replaceState(null, "", "/compose");

    render(<App />);
    await screen.findByRole("heading", { name: "Compose", level: 1 });

    const sidebar = screen.getByRole("complementary");
    expect(sidebar).toHaveAttribute("data-navigation-mode", "rail");
    const composeLink = within(sidebar).getByRole("link", { name: "Compose" });
    expect(composeLink).toHaveAttribute("aria-current", "page");
    await user.hover(within(sidebar).getByRole("button", { name: "도커" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("도커");
  });

  it("adds registry addresses without a provider selection", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    const repositories: Array<{
      createdAt: string;
      id: string;
      repository: string;
    }> = [];
    let favorite = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/metadata"))
        return jsonResponse({
          metadata: { description: "원본 저장소의 짧은 설명", fullDescription: "# 상세 본문" },
        });
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      if (url.endsWith("/api/image-repositories") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { repository: string };
        const repository = {
          createdAt: "2026-08-27T01:00:00.000Z",
          id: "11111111-1111-4111-8111-111111111111",
          repository: body.repository,
        };
        repositories.push(repository);
        return jsonResponse({ repository });
      }
      if (url.includes("/api/image-repositories/") && url.endsWith("/sync")) {
        return jsonResponse({
          operation: operation("queued", {
            id: "repository-sync",
            kind: "image.repository.sync",
            target: {
              id: "11111111-1111-4111-8111-111111111111",
              name: "ghcr.io/opnay/overseer",
              resource: "imageRepository",
            },
            title: "이미지 저장소 동기화",
          }),
        });
      }
      if (url.endsWith("/api/image-repositories/11111111-1111-4111-8111-111111111111")) {
        return jsonResponse({
          repository: {
            ...repositories[0],
            favoriteCount: favorite ? 1 : 0,
            favoriteTags: favorite ? ["latest"] : [],
            tagCount: 2,
          },
        });
      }
      if (
        url.includes(
          "/api/image-repositories/11111111-1111-4111-8111-111111111111/tags/latest/favorite",
        ) &&
        init?.method === "PATCH"
      ) {
        favorite = (JSON.parse(String(init.body)) as { favorite: boolean }).favorite;
        return jsonResponse({ tag: { favorite, name: "latest" } });
      }
      if (
        url.includes("/api/image-repositories/11111111-1111-4111-8111-111111111111/tags?page=1")
      ) {
        return jsonResponse({
          tags: {
            count: 2,
            page: 1,
            pageSize: 25,
            repository: "ghcr.io/opnay/overseer",
            tags: [
              { favorite, name: "latest" },
              { favorite: false, name: "v1" },
            ],
          },
        });
      }
      if (url.endsWith("/api/images/pull") && init?.method === "POST") {
        return jsonResponse({
          operation: operation("queued", {
            id: "repository-tag-pull",
            kind: "image.pull",
            target: { name: "ghcr.io/opnay/overseer:latest", resource: "image" },
            title: "이미지 받기",
          }),
        });
      }
      if (url.endsWith("/api/image-repositories")) return jsonResponse({ repositories });
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/image-repositories");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "이미지 저장소", level: 1 }),
    ).toBeInTheDocument();
    expect(await screen.findByText("등록된 이미지 저장소가 없습니다.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "저장소 추가" }));
    const dialog = await screen.findByRole("dialog", { name: "이미지 저장소 추가" });
    expect(within(dialog).queryByRole("textbox", { name: "공급자" })).not.toBeInTheDocument();
    await user.type(
      within(dialog).getByRole("textbox", { name: "저장소 주소" }),
      "ghcr.io/opnay/overseer",
    );
    await user.click(within(dialog).getByRole("button", { name: "추가" }));

    expect(await screen.findByText("ghcr.io/opnay/overseer")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "공급자" })).not.toBeInTheDocument();
    expect(screen.getByText("동기화 필요")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "ghcr.io/opnay/overseer 동기화" }));
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith("/api/image-repositories") &&
          init?.method === "POST" &&
          init.body === JSON.stringify({ repository: "ghcr.io/opnay/overseer" }),
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) => String(input).endsWith("/sync") && init?.method === "POST",
      ),
    ).toBe(true);

    await user.click(screen.getByRole("link", { name: "ghcr.io/opnay/overseer" }));
    expect(
      await screen.findByRole("heading", { name: "ghcr.io/opnay/overseer", level: 1 }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe(
      "/image-repositories/11111111-1111-4111-8111-111111111111",
    );
    expect(screen.queryByRole("table", { name: "이미지 저장소 목록" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "저장소 추가" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "개요", level: 2 })).not.toBeInTheDocument();
    expect(await screen.findByText("원본 저장소의 짧은 설명")).toBeInTheDocument();
    const readDescription = await screen.findByRole("button", { name: "상세 설명 열기" });
    expect(readDescription.closest(".overseer-page-actions")).toContainElement(
      screen.getByRole("button", { name: "새로고침" }),
    );
    expect(screen.getByText("즐겨찾기한 태그가 없습니다.")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "태그" }));
    expect(
      await screen.findByRole("table", { name: "ghcr.io/opnay/overseer 태그 목록" }),
    ).toBeInTheDocument();

    expect(screen.queryByRole("columnheader", { name: "즐겨찾기" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "latest 즐겨찾기 추가" }));
    expect(screen.getByRole("button", { name: "latest 즐겨찾기 해제" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("link", { name: "개요" }));
    expect(
      await screen.findByRole("list", { name: "ghcr.io/opnay/overseer 즐겨찾기 태그 목록" }),
    ).toHaveTextContent("latest");
    expect(
      screen.queryByRole("table", { name: "ghcr.io/opnay/overseer 태그 목록" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "태그" }));
    await user.click(screen.getByRole("button", { name: "latest 작업 메뉴" }));
    await user.click(await screen.findByRole("menuitem", { name: "컨테이너 생성" }));
    const runDialog = await screen.findByRole("dialog", { name: "컨테이너 실행" });
    expect(within(runDialog).getByRole("combobox", { name: "이미지" })).toHaveValue(
      "ghcr.io/opnay/overseer:latest",
    );
    await user.click(within(runDialog).getByRole("button", { name: "취소" }));

    await user.click(screen.getByRole("button", { name: "latest 이미지 다운로드" }));
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith("/api/images/pull") &&
          init?.method === "POST" &&
          init.body === JSON.stringify({ image: "ghcr.io/opnay/overseer:latest" }),
      ),
    ).toBe(true);
  });

  it("keeps tray navigation and browser back/forward in the same page history", async () => {
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      volumes: [],
      runtime: { instance: "overseer", message: "정상", phase: "running" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        if (String(input).includes("/api/operations")) return jsonResponse({ operations: [] });
        return jsonResponse(dashboard);
      }),
    );
    window.history.replaceState(null, "", "/containers");
    render(<App />);
    await screen.findByRole("heading", { name: "컨테이너", level: 1 });

    const openFromTray = (path: string) =>
      act(() => {
        window.dispatchEvent(new CustomEvent("overseer:navigate", { detail: { path } }));
      });
    openFromTray("/images");
    await screen.findByRole("heading", { name: "이미지", level: 1 });
    openFromTray("/volumes");
    await screen.findByRole("heading", { name: "볼륨", level: 1 });
    openFromTray("/volumes");

    act(() => window.history.back());
    await screen.findByRole("heading", { name: "이미지", level: 1 });
    expect(window.location.pathname).toBe("/images");
    act(() => window.history.back());
    await screen.findByRole("heading", { name: "컨테이너", level: 1 });
    expect(window.location.pathname).toBe("/containers");
    act(() => window.history.forward());
    await screen.findByRole("heading", { name: "이미지", level: 1 });
    expect(window.location.pathname).toBe("/images");
  });

  it("opens all navigation groups from one mobile header", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    mockViewport(390);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        return String(input).endsWith("/api/operations")
          ? jsonResponse({ operations: [] })
          : jsonResponse(dashboard);
      }),
    );
    window.history.replaceState(null, "", "/containers");

    render(<App />);
    await screen.findByRole("heading", { name: "컨테이너", level: 1 });

    expect(screen.queryByRole("navigation", { name: "주요 메뉴" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "주요 메뉴 열기" }));

    const drawer = await screen.findByRole("dialog", { name: "주요 메뉴" });
    const navigation = within(drawer).getByRole("navigation", { name: "주요 메뉴" });
    expect(within(navigation).getByRole("group", { name: "도커" })).toBeInTheDocument();
    expect(within(navigation).getByRole("group", { name: "CLI" })).toBeInTheDocument();
    expect(within(navigation).getByRole("group", { name: "공급자" })).toBeInTheDocument();
    expect(within(navigation).getByRole("group", { name: "엔진" })).toBeInTheDocument();
    expect(within(navigation).getByRole("link", { name: "컨테이너" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(drawer).getByRole("navigation", { name: "유틸리티 메뉴" })).toHaveTextContent(
      "설정",
    );

    await user.click(within(navigation).getByRole("link", { name: "이미지" }));
    expect(await screen.findByRole("heading", { name: "이미지", level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "주요 메뉴" })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/images");
  });

  it("renders container logs in the terminal viewer", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [
        {
          id: "container-id",
          image: "nginx:alpine",
          name: "web",
          ports: "127.0.0.1:8080->80/tcp",
          state: "running",
          status: "Up 1 minute",
        },
      ],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "Lima와 Docker가 정상적으로 실행 중입니다.",
        phase: "running",
      },
      volumes: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        return String(input).includes("/api/containers/container-id/logs")
          ? jsonResponse({ logs: "first line\nsecond line" })
          : jsonResponse(dashboard);
      }),
    );

    render(<App />);
    await screen.findByRole("row", { name: /web/ });
    await user.click(screen.getByRole("button", { name: "web 로그 보기" }));

    expect(await screen.findByRole("region", { name: "web 로그 터미널" })).toBeInTheDocument();
    expect(screen.getByText("tail -n 300")).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "로그 명령" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "복사" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "맨 아래" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "자동 갱신 켜짐" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "새로고침" })).toBeEnabled();
    const codeBlock = await waitFor(() => {
      const element = document.querySelector(".overseer-log-viewer-code");
      if (!element) throw new Error("로그 코드 블록을 찾지 못했습니다.");
      return element;
    });
    expect(codeBlock.tagName).toBe("PRE");
    expect(codeBlock.querySelector("code")?.textContent).toBe("first line\nsecond line");
    expect(codeBlock).toHaveAttribute("data-wrap", "false");
    expect(codeBlock).toHaveAttribute("data-line-numbers", "false");
    expect(codeBlock).toHaveAttribute("data-font-size", "medium");

    const logOptionsTrigger = screen.getByRole("button", { name: "로그 옵션" });
    expect(logOptionsTrigger).toHaveAttribute("data-city-icon-only");
    await user.click(logOptionsTrigger);
    const logOptions = await screen.findByRole("menu");
    const lineWrap = within(logOptions).getByRole("menuitemcheckbox", { name: "줄 바꿈" });
    const lineNumbers = within(logOptions).getByRole("menuitemcheckbox", { name: "줄 번호" });
    expect(lineWrap).toHaveAttribute("aria-checked", "false");
    expect(lineNumbers).toHaveAttribute("aria-checked", "false");
    expect(within(logOptions).getByRole("menuitemradio", { name: "보통" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.click(lineWrap);
    expect(lineWrap).toHaveAttribute("aria-checked", "true");
    expect(codeBlock).toHaveAttribute("data-wrap", "true");
    await user.click(lineNumbers);
    expect(lineNumbers).toHaveAttribute("aria-checked", "true");
    expect(codeBlock).toHaveAttribute("data-line-numbers", "true");
    expect(codeBlock.querySelectorAll(".overseer-log-code-line")).toHaveLength(2);
    await user.click(within(logOptions).getByRole("menuitemradio", { name: "크게" }));
    expect(codeBlock).toHaveAttribute("data-font-size", "large");
  });

  it("navigates to the images page from the sidebar", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "Lima와 Docker가 정상적으로 실행 중입니다.",
        phase: "running",
      },
      volumes: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/api/startup")
          ? jsonResponse(startupSnapshot())
          : jsonResponse(dashboard),
      ),
    );

    render(<App />);
    await screen.findByText("컨테이너가 없습니다.");

    await user.click(screen.getByRole("link", { name: "이미지" }));

    expect(await screen.findByRole("heading", { name: "이미지", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("로컬 이미지가 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "이미지" })).toHaveAttribute("aria-current", "page");
    expect(window.location.pathname).toBe("/images");
  });

  it("combines image references and navigates to image inspection details", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [
        {
          createdAt: "2026-08-22T09:22:08.000Z",
          createdSince: "2 days ago",
          id: "3e24e96c89ef",
          platform: "linux/arm64",
          repository: "louislam/uptime-kuma",
          size: "2.51GB",
          tag: "2",
          url: "docker.io/louislam/uptime-kuma:2",
        },
      ],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
        if (url.endsWith("/api/images/3e24e96c89ef/history")) {
          return jsonResponse({
            history: [
              {
                comment: "buildkit.dockerfile.v0",
                createdAt: "2026-08-22T18:22:08+09:00",
                createdBy: 'CMD ["node" "server/server.js"]',
                createdSince: "2 days ago",
                size: "0B",
              },
              {
                comment: "buildkit.dockerfile.v0",
                createdAt: "2026-08-22T18:21:00+09:00",
                createdBy:
                  "RUN /bin/sh -c apt update && apt install curl | tee /tmp/result # buildkit",
                createdSince: "2 days ago",
                size: "12MB",
              },
            ],
          });
        }
        if (url.endsWith("/api/images/3e24e96c89ef")) {
          return jsonResponse({
            image: {
              architecture: "arm64",
              command: ["node", "server/server.js"],
              comment: "buildkit.dockerfile.v0",
              createdAt: "2026-08-22T09:22:08.000Z",
              entrypoint: ["/usr/bin/dumb-init", "--"],
              environment: [{ key: "NODE_ENV", value: "production" }],
              exposedPorts: ["3001/tcp"],
              id: "sha256:3e24e96c89ef",
              inspectJson: '{\n  "Id": "sha256:3e24e96c89ef"\n}',
              labels: [
                {
                  key: "org.opencontainers.image.source",
                  value: "https://github.com/louislam/uptime-kuma",
                },
              ],
              layers: ["sha256:layer-one", "sha256:layer-two"],
              operatingSystem: "linux",
              repositoryDigests: ["louislam/uptime-kuma@sha256:digest"],
              repositoryTags: ["louislam/uptime-kuma:2"],
              sizeBytes: 601_204_055,
              workingDirectory: "/app",
            },
          });
        }
        return jsonResponse(dashboard);
      }),
    );
    window.history.replaceState(null, "", "/images");
    render(<App />);

    const imageUrl = await screen.findByText("docker.io/louislam/uptime-kuma:2", {
      selector: "code",
    });
    expect(imageUrl.closest(".overseer-primary-meta")).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "태그" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "플랫폼" })).toBeInTheDocument();
    expect(screen.getByText("linux/arm64", { selector: "code" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "louislam/uptime-kuma:2" }));

    expect(
      await screen.findByRole("heading", { name: "louislam/uptime-kuma:2", level: 1 }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/images/3e24e96c89ef");
    const imageNavigation = await screen.findByRole("navigation", { name: "이미지 상세 메뉴" });
    const imageGroup = within(imageNavigation).getByRole("group", { name: "이미지" });
    expect(within(imageGroup).getByRole("link", { name: "개요" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("linux/arm64")).toBeInTheDocument();
    expect(screen.getByText("sha256:3e24e96c89ef")).toBeInTheDocument();
    expect(screen.getByText("이미지 ID", { selector: "dt" }).parentElement).toHaveClass(
      "overseer-detail-definition--wide",
    );
    expect(screen.getByText("Digest", { selector: "dt" }).parentElement).toHaveClass(
      "overseer-detail-definition--wide",
    );
    expect(screen.getByRole("button", { name: "Docker Hub" })).toHaveAttribute(
      "href",
      "https://hub.docker.com/r/louislam/uptime-kuma",
    );
    expect(screen.getByRole("button", { name: "GitHub 저장소" })).toHaveAttribute(
      "href",
      "https://github.com/louislam/uptime-kuma",
    );

    expect(within(imageGroup).queryByRole("link", { name: "저장소 태그" })).not.toBeInTheDocument();

    await user.click(within(imageGroup).getByRole("link", { name: "실행 설정" }));
    expect(screen.getByText("/app")).toBeInTheDocument();
    expect(screen.getByText("3001/tcp")).toBeInTheDocument();
    expect(screen.getByText("2개")).toBeInTheDocument();

    await user.click(within(imageGroup).getByRole("link", { name: "환경 변수" }));
    expect(screen.getByText("NODE_ENV")).toBeInTheDocument();

    await user.click(within(imageGroup).getByRole("link", { name: "라벨" }));
    expect(screen.getByText("org.opencontainers.image.source")).toBeInTheDocument();

    await user.click(within(imageGroup).getByRole("link", { name: "레이어" }));
    const layerCode = await screen.findByRole("region", { name: "Dockerfile 레이어 코드" });
    expect(layerCode.querySelector("pre")).toHaveTextContent(
      "# Layer 1 · 12MB RUN apt update \\ && apt install curl \\ | tee /tmp/result",
    );
    expect(layerCode.querySelector("pre")).toHaveTextContent(
      '# Layer 2 · 0B CMD ["node" "server/server.js"]',
    );
    expect(within(layerCode).getByRole("button", { name: "코드 보기 옵션" })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "이미지 레이어 기록" })).not.toBeInTheDocument();

    await user.click(within(imageGroup).getByRole("link", { name: "원본 정보" }));
    const imageInspect = screen.getByRole("region", { name: "이미지 원본 JSON" });
    expect(imageInspect.querySelector("pre")).toHaveTextContent('"Id": "sha256:3e24e96c89ef"');
    expect(
      within(imageInspect).getByRole("button", { name: "원본 JSON 보기 옵션" }),
    ).toBeInTheDocument();

    await user.click(
      within(screen.getByRole("navigation", { name: "현재 위치" })).getByRole("link", {
        name: "이미지",
      }),
    );
    expect(window.location.pathname).toBe("/images");
  });

  it("navigates from the container list to the container detail page", async () => {
    const user = userEvent.setup();
    const healthStartedAt = "2026-08-25T01:01:00.000000000+09:00";
    const healthStartedAtLabel = formatDateTime(healthStartedAt);
    let includeHealth = true;
    let terminalStatus: "not-running" | "paused" | "ready" | "shell-not-found" = "ready";
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [
        {
          id: "container-id",
          image: "alpine:3.23",
          name: "worker",
          ports: "",
          state: "running",
          status: "Up 2 minutes",
        },
      ],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        if (url.endsWith("/api/containers/container-id/inspect")) {
          return jsonResponse({
            inspection: {
              ...(includeHealth
                ? {
                    health: {
                      failingStreak: 1,
                      history: [
                        {
                          endedAt: "2026-08-25T01:01:01.000000000+09:00",
                          exitCode: 1,
                          output: "service unavailable",
                          startedAt: healthStartedAt,
                        },
                      ],
                      status: "unhealthy",
                    },
                  }
                : {}),
              json: '{\n  "Id": "container-id",\n  "State": { "Status": "running" }\n}',
            },
          });
        }
        if (url.endsWith("/api/containers/container-id/terminal")) {
          return jsonResponse({
            terminal:
              terminalStatus === "ready"
                ? {
                    command: "docker --context overseer exec -it container-id sh",
                    shell: "sh",
                    status: "ready",
                  }
                : { status: terminalStatus },
          });
        }
        if (url.endsWith("/api/containers/container-id")) {
          return jsonResponse({
            container: {
              configHash: "a".repeat(64),
              id: "container-id",
              mounts: [
                {
                  containerPath: "/app/data",
                  hostPath: "/home/test.guest/.local/share/overseer/compose/demo/data",
                  readOnly: false,
                  type: "bind",
                },
                {
                  containerPath: "/audit",
                  readOnly: true,
                  type: "volume",
                  volume: "audit-data",
                },
              ],
              replacementBlockers: [],
              running: true,
              spec: {
                ...emptyContainerSpec(),
                command: ["sleep", "600"],
                environment: [{ key: "MODE", value: "worker" }],
                image: "alpine:3.23",
                labels: [{ key: "team", value: "platform" }],
                name: "worker",
                networks: ["bridge"],
              },
            },
          });
        }
        return jsonResponse(dashboard);
      }),
    );
    window.history.replaceState(null, "", "/containers");
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "worker" }));

    expect(await screen.findByRole("heading", { name: "worker", level: 1 })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/containers/container-id");
    expect((await screen.findByText("ID", { selector: "dt" })).parentElement).toHaveClass(
      "overseer-detail-definition--wide",
    );
    const containerNavigation = await screen.findByRole("navigation", {
      name: "컨테이너 상세 메뉴",
    });
    const containerGroup = within(containerNavigation).getByRole("group", { name: "컨테이너" });
    expect(within(containerGroup).getByRole("link", { name: "개요" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await user.click(within(containerGroup).getByRole("link", { name: "실행 설정" }));
    expect(screen.getByRole("heading", { name: "실행 설정", level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "기본 정보", level: 3 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "리소스 제한", level: 3 })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "네트워크 및 저장소", level: 3 }),
    ).toBeInTheDocument();
    expect(screen.getByText("sleep 600")).toBeInTheDocument();
    expect(screen.getByText("bridge")).toBeInTheDocument();
    expect(screen.getByText("바인드 마운트")).toBeInTheDocument();
    expect(
      screen.getByText("/home/test.guest/.local/share/overseer/compose/demo/data"),
    ).toBeInTheDocument();
    expect(screen.getByText("/app/data")).toBeInTheDocument();
    expect(screen.getByText("이름 있는 볼륨")).toBeInTheDocument();
    expect(screen.getByText("audit-data")).toBeInTheDocument();
    expect(within(containerGroup).queryByRole("link", { name: "연결" })).not.toBeInTheDocument();

    await user.click(within(containerGroup).getByRole("link", { name: "터미널" }));
    expect(await screen.findByText("sh", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByLabelText("컨테이너 터미널 명령")).toHaveTextContent(
      "docker --context overseer exec -it container-id sh",
    );
    expect(screen.getByRole("button", { name: "터미널 명령 복사" })).toBeEnabled();

    terminalStatus = "shell-not-found";
    await user.click(within(containerGroup).getByRole("link", { name: "실행 설정" }));
    await user.click(within(containerGroup).getByRole("link", { name: "터미널" }));
    expect(
      await screen.findByRole("heading", {
        name: "실행할 셸을 찾을 수 없습니다.",
        level: 3,
      }),
    ).toBeInTheDocument();

    terminalStatus = "not-running";
    await user.click(within(containerGroup).getByRole("link", { name: "실행 설정" }));
    await user.click(within(containerGroup).getByRole("link", { name: "터미널" }));
    expect(
      await screen.findByRole("heading", {
        name: "컨테이너가 실행 중이 아닙니다.",
        level: 3,
      }),
    ).toBeInTheDocument();

    terminalStatus = "paused";
    await user.click(within(containerGroup).getByRole("link", { name: "실행 설정" }));
    await user.click(within(containerGroup).getByRole("link", { name: "터미널" }));
    expect(
      await screen.findByRole("heading", {
        name: "컨테이너가 일시 중지되어 있습니다.",
        level: 3,
      }),
    ).toBeInTheDocument();

    await user.click(within(containerGroup).getByRole("link", { name: "상태 검사" }));
    expect(await screen.findByText("비정상")).toBeInTheDocument();
    expect(screen.getByText("1회")).toBeInTheDocument();
    expect(screen.getAllByText(healthStartedAtLabel)).toHaveLength(2);
    expect(
      await screen.findByRole("region", {
        name: `${healthStartedAtLabel} 상태 검사 출력`,
      }),
    ).toHaveTextContent("service unavailable");
    expect(screen.getByRole("button", { name: "상태 검사 출력 옵션" })).toBeInTheDocument();

    await user.click(within(containerGroup).getByRole("link", { name: "원본 정보" }));
    expect(screen.getByText("민감한 설정이 포함될 수 있습니다.")).toBeInTheDocument();
    const inspectViewer = await screen.findByRole("region", { name: "Docker 원본 JSON" });
    expect(inspectViewer).toHaveTextContent('"Id": "container-id"');
    expect(screen.getByRole("button", { name: "원본 정보 보기 옵션" })).toBeInTheDocument();

    includeHealth = false;
    await user.click(within(containerGroup).getByRole("link", { name: "실행 설정" }));
    await user.click(within(containerGroup).getByRole("link", { name: "상태 검사" }));
    expect(
      await screen.findByRole("heading", {
        name: "상태 검사가 설정되지 않았습니다.",
        level: 3,
      }),
    ).toBeInTheDocument();

    await user.click(within(containerGroup).getByRole("link", { name: "환경 변수" }));
    expect(screen.getByText("MODE")).toBeInTheDocument();

    await user.click(within(containerGroup).getByRole("link", { name: "라벨" }));
    expect(screen.getByText("team")).toBeInTheDocument();

    await user.click(
      within(screen.getByRole("navigation", { name: "현재 위치" })).getByRole("link", {
        name: "컨테이너",
      }),
    );

    expect(window.location.pathname).toBe("/containers");
    expect(screen.getByRole("heading", { name: "컨테이너", level: 1 })).toBeInTheDocument();
  });

  it("renders discovered Compose projects and service details", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [
        {
          configFiles: ["/workspace/compose.yaml"],
          name: "demo-stack",
          status: "running(1)",
        },
      ],
      containers: [
        {
          composeProject: "demo-stack",
          composeService: "web",
          id: "container-id",
          image: "nginx:alpine",
          name: "demo-stack-web-1",
          ports: "127.0.0.1:8080->80/tcp",
          state: "running",
          status: "Up 1 minute",
        },
      ],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "Lima와 Docker가 정상적으로 실행 중입니다.",
        phase: "running",
      },
      volumes: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        if (url.endsWith("/api/compose/projects/demo-stack/logs")) {
          return jsonResponse({ logs: "web | ready" });
        }
        if (url.includes("/api/compose/projects/demo-stack")) {
          return jsonResponse({
            project: {
              configFiles: ["/workspace/compose.yaml"],
              configuration: {
                configFiles: ["/workspace/compose.yaml"],
                kind: "discovered",
              },
              name: "demo-stack",
              services: [
                {
                  health: "",
                  id: "container-id",
                  image: "nginx:alpine",
                  name: "demo-stack-web-1",
                  ports: "127.0.0.1:8080->80/tcp",
                  service: "web",
                  state: "running",
                  status: "Up 1 minute",
                },
              ],
              status: "running(1)",
            },
          });
        }
        if (url.includes("/api/containers/container-id")) {
          return jsonResponse({
            container: {
              configHash: "a".repeat(64),
              id: "container-id",
              mounts: [],
              replacementBlockers: ["Compose에서 관리하는 컨테이너입니다."],
              running: true,
              spec: {
                ...emptyContainerSpec(),
                command: ["nginx", "-g", "daemon off;"],
                image: "nginx:alpine",
                name: "demo-stack-web-1",
                networks: ["demo-stack_default"],
                ports: [{ containerPort: 80, hostPort: 8080, protocol: "tcp" }],
              },
            },
          });
        }
        return jsonResponse(dashboard);
      }),
    );
    window.history.replaceState(null, "", "/compose");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Compose", level: 1 })).toBeInTheDocument();
    const composeRow = screen.getByRole("row", { name: /demo-stack/ });
    expect(composeRow).toBeInTheDocument();
    expect(screen.getByText("1개 실행 중")).toBeInTheDocument();
    expect(within(composeRow).queryByRole("img", { name: "1개 실행 중" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "demo-stack 서비스 보기" }));

    expect(
      await screen.findByRole("heading", { name: "demo-stack", level: 1 }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/compose/demo-stack");
    expect(screen.getByRole("button", { name: "중지" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "재시작" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "내리기" })).toBeEnabled();
    const composeNavigation = await screen.findByRole("navigation", { name: "Compose 상세 메뉴" });
    const composeGroup = within(composeNavigation).getByRole("group", {
      name: "Compose 프로젝트",
    });
    expect(within(composeGroup).getByRole("link", { name: "개요" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    expect(within(composeGroup).getByRole("link", { name: "구성" })).toBeInTheDocument();
    expect(within(composeGroup).getByRole("link", { name: "로그" })).toBeInTheDocument();
    expect(within(composeGroup).queryByRole("link", { name: "업데이트" })).not.toBeInTheDocument();
    expect(within(composeGroup).queryByRole("link", { name: "폼 설정" })).not.toBeInTheDocument();

    await user.click(within(composeGroup).getByRole("link", { name: "구성" }));
    expect(screen.getAllByText("/workspace/compose.yaml").length).toBeGreaterThan(0);

    await user.click(within(composeGroup).getByRole("link", { name: "로그" }));
    const composeLog = await screen.findByRole("region", { name: "demo-stack Compose 로그" });
    expect(composeLog).toHaveTextContent("web | ready");
    const composeLogCode = composeLog.querySelector(".overseer-log-viewer-code");
    expect(composeLogCode).toHaveAttribute("data-wrap", "false");
    expect(composeLogCode).toHaveAttribute("data-line-numbers", "false");
    expect(composeLogCode).toHaveAttribute("data-font-size", "medium");
    await user.click(within(composeLog).getByRole("button", { name: "로그 옵션" }));
    const composeLogOptions = await screen.findByRole("menu");
    await user.click(within(composeLogOptions).getByRole("menuitemcheckbox", { name: "줄 바꿈" }));
    expect(composeLogCode).toHaveAttribute("data-wrap", "true");
    await user.keyboard("{Escape}");

    await user.click(within(composeGroup).getByRole("link", { name: "서비스" }));
    const serviceTable = await screen.findByRole("table", {
      name: "demo-stack 서비스 컨테이너 목록",
    });
    expect(
      within(serviceTable)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["서비스", "상태", "포트"]);
    expect(serviceTable.querySelectorAll("thead .overseer-table-column-wide")).toHaveLength(1);
    expect(within(serviceTable).getByText("nginx:alpine")).toBeInTheDocument();
    const containerLink = await screen.findByRole("link", { name: "demo-stack-web-1" });
    expect(containerLink).toHaveAttribute("href", "/containers/container-id");

    await user.click(containerLink);

    expect(
      await screen.findByRole("heading", { name: "demo-stack-web-1", level: 1 }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/containers/container-id");
    expect(await screen.findByRole("heading", { name: "개요", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Compose에서 관리하는 컨테이너입니다.")).toBeInTheDocument();
    const breadcrumbs = screen.getByRole("navigation", { name: "현재 위치" });
    expect(within(breadcrumbs).getByRole("link", { name: "Compose" })).toHaveAttribute(
      "href",
      "/compose",
    );
    expect(within(breadcrumbs).getByRole("link", { name: "demo-stack" })).toHaveAttribute(
      "href",
      "/compose/demo-stack",
    );
    expect(within(breadcrumbs).getByText("demo-stack-web-1")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("button", { name: "컨테이너 목록" })).not.toBeInTheDocument();
  });

  it("shows URL Compose update details and actions only for remote projects", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [
        {
          configFiles: ["/host/remote-stack/compose.yaml"],
          name: "remote-stack",
          remote: {
            buildContext: false,
            checkedAt: "2026-08-24T00:00:00.000Z",
            updateAvailable: true,
            url: "https://example.com/compose.yaml",
          },
          status: "registered",
        },
      ],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/compose/projects/remote-stack/remote/check")) {
        return jsonResponse(
          {
            operation: operation("queued", {
              kind: "compose.remote.check",
              target: { name: "remote-stack", resource: "compose" },
              title: "Compose 업데이트 확인",
            }),
          },
          202,
        );
      }
      if (url.endsWith("/api/compose/projects/remote-stack")) {
        return jsonResponse({
          project: {
            ...dashboard.composeProjects[0],
            configuration: {
              checkedAt: "2026-08-24T00:00:00.000Z",
              contentHash: "a".repeat(64),
              kind: "remote",
              pendingHash: "b".repeat(64),
              pendingYaml: "services:\n  web:\n    image: nginx:1.29\n",
              url: "https://example.com/compose.yaml",
              yaml: "services:\n  web:\n    image: nginx:1.28\n",
            },
            services: [],
          },
        });
      }
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/compose/remote-stack");
    render(<App />);

    const navigation = await screen.findByRole("navigation", { name: "Compose 상세 메뉴" });
    const group = within(navigation).getByRole("group", { name: "Compose 프로젝트" });
    expect(within(group).getByRole("link", { name: "업데이트" })).toBeInTheDocument();
    expect(within(group).queryByRole("link", { name: "폼 설정" })).not.toBeInTheDocument();

    await user.click(within(group).getByRole("link", { name: "업데이트" }));

    expect(screen.getByText("적용 대기 YAML")).toBeInTheDocument();
    expect(screen.getByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
    expect(screen.getByText(/nginx:1\.29/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "업데이트 적용" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "업데이트 확인" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/compose/projects/remote-stack/remote/check") &&
            init?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("shows form settings and opens the editor only for builder projects", async () => {
    const user = userEvent.setup();
    const spec = {
      ...emptyComposeBuilderSpec(),
      name: "form-stack",
      services: [{ ...emptyComposeBuilderService(), image: "nginx", name: "web" }],
    };
    const dashboard: DashboardSnapshot = {
      composeProjects: [
        {
          builder: { configHash: "a".repeat(64), mode: "form" },
          configFiles: ["/host/form-stack/compose.yaml"],
          name: "form-stack",
          status: "registered",
        },
      ],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        if (url.endsWith("/api/compose/projects/form-stack/builder")) {
          return jsonResponse({
            project: {
              configHash: "a".repeat(64),
              input: { mode: "form", spec },
              yaml: 'services:\n  web:\n    image: "nginx:latest"\n',
            },
          });
        }
        if (url.endsWith("/api/compose/projects/form-stack")) {
          return jsonResponse({
            project: {
              ...dashboard.composeProjects[0],
              configuration: {
                configHash: "a".repeat(64),
                kind: "builder",
                yaml: 'services:\n  web:\n    image: "nginx:latest"\n',
              },
              services: [],
            },
          });
        }
        if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
        return jsonResponse(dashboard);
      }),
    );
    window.history.replaceState(null, "", "/compose/form-stack");
    render(<App />);

    const navigation = await screen.findByRole("navigation", { name: "Compose 상세 메뉴" });
    const group = within(navigation).getByRole("group", { name: "Compose 프로젝트" });
    expect(within(group).getByRole("link", { name: "작성 설정" })).toBeInTheDocument();
    expect(within(group).queryByRole("link", { name: "업데이트" })).not.toBeInTheDocument();

    await user.click(within(group).getByRole("link", { name: "작성 설정" }));
    await user.click(screen.getByRole("button", { name: "구성 편집" }));

    expect(await screen.findByRole("dialog", { name: "Compose 수정" })).toBeInTheDocument();
  });

  it("registers a raw HTTPS Compose URL through the async operation API", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    let submittedBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/api/startup")) return jsonResponse(startupSnapshot());

        if (String(input).endsWith("/api/operations")) return jsonResponse({ operations: [] });
        if (String(input).endsWith("/api/compose/remote") && init?.method === "POST") {
          submittedBody = JSON.parse(String(init.body));
          return jsonResponse({
            operation: operation("queued", {
              id: "remote-register-operation",
              kind: "compose.remote.register",
              successMessage: "remote-stack URL Compose 프로젝트를 등록했습니다.",
              target: { name: "remote-stack", resource: "compose" },
              title: "URL Compose 등록",
            }),
          });
        }
        return jsonResponse(dashboard);
      }),
    );
    window.history.replaceState(null, "", "/compose");
    render(<App />);
    await screen.findByRole("heading", { name: "Compose", level: 1 });

    await user.click(await screen.findByRole("button", { name: "URL로 등록" }));
    const urlInput = screen.getByRole("textbox", { name: "Compose URL" });
    await user.type(urlInput, "http://127.0.0.1/compose.yaml");
    await user.click(screen.getByRole("button", { name: "URL 등록" }));
    expect(screen.getByText("인증 정보가 없는 공개 HTTPS URL을 입력하십시오.")).toBeInTheDocument();
    await user.clear(urlInput);
    await user.type(urlInput, "https://raw.githubusercontent.com/opnay/example/main/compose.yaml");
    await user.type(screen.getByRole("textbox", { name: /프로젝트 이름/ }), "remote-stack");
    await user.click(screen.getByRole("button", { name: "URL 등록" }));

    expect(
      await screen.findByTestId("operation-remote-register-operation-started"),
    ).toHaveTextContent("URL Compose 등록");
    expect(submittedBody).toEqual({
      name: "remote-stack",
      url: "https://raw.githubusercontent.com/opnay/example/main/compose.yaml",
    });
  });

  it("generates editable YAML from the form and submits the YAML source", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    let submittedBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
        if (url.endsWith("/api/compose/builder") && init?.method === "POST") {
          submittedBody = JSON.parse(String(init.body));
          return jsonResponse(
            {
              operation: operation("queued", {
                id: "builder-register-operation",
                kind: "compose.builder.register",
                target: { name: "demo-stack", resource: "compose" },
                title: "폼 Compose 등록",
              }),
            },
            202,
          );
        }
        return jsonResponse(dashboard);
      }),
    );
    window.history.replaceState(null, "", "/compose");
    render(<App />);
    await screen.findByRole("heading", { name: "Compose", level: 1 });

    await user.click(await screen.findByRole("button", { name: "직접 작성" }));
    const dialog = await screen.findByRole("dialog", { name: "Compose 추가" });
    await user.type(within(dialog).getByRole("textbox", { name: "프로젝트 이름" }), "demo-stack");
    const serviceOne = within(dialog).getByRole("region", { name: "서비스 1" });
    await user.type(within(serviceOne).getByRole("textbox", { name: "이미지" }), "nginx");
    await user.click(within(dialog).getByRole("button", { name: "네트워크 추가" }));
    await user.type(
      within(dialog).getByRole("textbox", { name: "Compose 네트워크 이름 1" }),
      "frontend",
    );
    await user.click(within(dialog).getByRole("button", { name: "볼륨 추가" }));
    await user.type(
      within(dialog).getByRole("textbox", { name: "Compose 볼륨 이름 1" }),
      "app-data",
    );
    await user.click(within(dialog).getByRole("button", { name: "서비스 추가" }));
    const serviceTwo = within(dialog).getByRole("region", { name: "서비스 2" });
    await user.type(within(serviceTwo).getByRole("textbox", { name: "이미지" }), "node");
    await user.clear(within(serviceTwo).getByRole("textbox", { name: "태그" }));
    await user.type(within(serviceTwo).getByRole("textbox", { name: "태그" }), "22-alpine");

    await user.click(within(dialog).getByRole("tab", { name: "YAML로 작성" }));
    const yaml = within(dialog).getByRole("textbox", { name: "Compose YAML" });
    expect((yaml as HTMLTextAreaElement).value).toContain('image: "nginx:latest"');
    expect((yaml as HTMLTextAreaElement).value).toContain('image: "node:22-alpine"');
    expect((yaml as HTMLTextAreaElement).value).toContain("networks:\n  frontend:");
    await user.type(yaml, "\n# 직접 작성한 YAML\n");
    await user.click(within(dialog).getByRole("button", { name: "Compose 저장" }));

    await waitFor(() => expect(submittedBody).toMatchObject({ name: "demo-stack", mode: "yaml" }));
    expect(submittedBody).toMatchObject({
      mode: "yaml",
      name: "demo-stack",
    });
    expect((submittedBody as { yaml: string }).yaml).toContain("# 직접 작성한 YAML");
  });

  it("loads and updates a persisted form Compose project", async () => {
    const user = userEvent.setup();
    const spec = {
      ...emptyComposeBuilderSpec(),
      name: "form-stack",
      services: [{ ...emptyComposeBuilderService(), image: "nginx", name: "web" }],
    };
    const dashboard: DashboardSnapshot = {
      composeProjects: [
        {
          builder: { configHash: "a".repeat(64), mode: "form" },
          configFiles: ["/data/compose/form-stack/compose.yaml"],
          name: "form-stack",
          status: "registered",
        },
      ],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    let updateBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
        if (url.endsWith("/api/compose/projects/form-stack/builder") && init?.method === "PATCH") {
          updateBody = JSON.parse(String(init.body));
          return jsonResponse(
            {
              operation: operation("queued", {
                id: "builder-update-operation",
                kind: "compose.builder.update",
                target: { name: "form-stack", resource: "compose" },
                title: "폼 Compose 수정",
              }),
            },
            202,
          );
        }
        if (url.endsWith("/api/compose/projects/form-stack/builder")) {
          return jsonResponse({
            project: {
              configHash: "a".repeat(64),
              input: { mode: "form", spec },
              yaml: 'services:\n  web:\n    image: "nginx:latest"\n',
            },
          });
        }
        return jsonResponse(dashboard);
      }),
    );
    window.history.replaceState(null, "", "/compose");
    render(<App />);
    expect(await screen.findByText("폼 작성")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "form-stack Compose 관리 메뉴" }));
    await user.click(await screen.findByRole("menuitem", { name: "구성 편집" }));
    const dialog = await screen.findByRole("dialog", { name: "Compose 수정" });
    const tag = within(within(dialog).getByRole("region", { name: "서비스 1" })).getByRole(
      "textbox",
      { name: "태그" },
    );
    await user.clear(tag);
    await user.type(tag, "1.29-alpine");
    await user.click(within(dialog).getByRole("button", { name: "변경사항 저장" }));

    await waitFor(() => expect(updateBody).toBeTruthy());
    expect(updateBody).toMatchObject({
      expectedConfigHash: "a".repeat(64),
      input: { mode: "form", spec: { services: [{ tag: "1.29-alpine" }] } },
    });
  });

  it("keeps persisted YAML when switching between authoring tabs", async () => {
    const user = userEvent.setup();
    const yaml = "services:\n  web:\n    image: nginx:alpine\n# keep me\n";
    const dashboard: DashboardSnapshot = {
      composeProjects: [
        {
          builder: { configHash: "a".repeat(64), mode: "yaml" },
          configFiles: ["/data/compose/yaml-stack/compose.yaml"],
          name: "yaml-stack",
          status: "registered",
        },
      ],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
        if (url.endsWith("/api/compose/projects/yaml-stack/builder")) {
          return jsonResponse({
            project: {
              configHash: "a".repeat(64),
              input: { mode: "yaml", name: "yaml-stack", yaml },
              yaml,
            },
          });
        }
        return jsonResponse(dashboard);
      }),
    );
    window.history.replaceState(null, "", "/compose");
    render(<App />);

    expect(await screen.findByText("YAML 작성")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "yaml-stack Compose 관리 메뉴" }));
    await user.click(await screen.findByRole("menuitem", { name: "구성 편집" }));
    const dialog = await screen.findByRole("dialog", { name: "Compose 수정" });
    expect(within(dialog).getByRole("tab", { name: "YAML로 작성" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.click(within(dialog).getByRole("tab", { name: "폼" }));
    await user.click(within(dialog).getByRole("tab", { name: "YAML로 작성" }));

    expect(within(dialog).getByRole("textbox", { name: "Compose YAML" })).toHaveValue(yaml);
  });

  it("shows remote update and build context states with URL management actions", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [
        {
          configFiles: ["/data/compose/remote-build/compose.yaml"],
          name: "remote-build",
          remote: {
            buildContext: true,
            checkedAt: "2026-08-23T10:00:00.000Z",
            updateAvailable: true,
            url: "https://example.com/compose.yaml",
          },
          status: "blocked",
        },
      ],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/startup")) return jsonResponse(startupSnapshot());

      if (String(input).endsWith("/api/operations")) return jsonResponse({ operations: [] });
      if (init?.method === "POST") {
        return jsonResponse({
          operation: operation("queued", {
            id: "remote-update-operation",
            kind: "compose.remote.update",
            successMessage: "업데이트했습니다.",
            target: { name: "remote-build", resource: "compose" },
            title: "Compose 업데이트 적용",
          }),
        });
      }
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/compose");
    render(<App />);

    expect(await screen.findByText("실행 제한")).toBeInTheDocument();
    expect(screen.getByText("URL 등록").closest(".overseer-primary-meta")).toBeInTheDocument();
    expect(screen.getByText("build context")).toBeInTheDocument();
    expect(screen.getByText("업데이트 있음")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "remote-build Compose 관리 메뉴" }));
    await user.click(await screen.findByRole("menuitem", { name: "Compose Down" }));
    expect(
      await screen.findByRole("alertdialog", {
        name: "remote-build 프로젝트를 내리시겠습니까?",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "취소" }));

    await user.click(await screen.findByRole("button", { name: "remote-build Compose 관리 메뉴" }));
    await user.click(await screen.findByRole("menuitem", { name: "Compose 삭제" }));
    expect(
      await screen.findByRole("alertdialog", {
        name: "remote-build Compose를 삭제하시겠습니까?",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "취소" }));

    await user.click(await screen.findByRole("button", { name: "remote-build Compose 관리 메뉴" }));
    await user.click(await screen.findByRole("menuitem", { name: "업데이트 적용" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).includes("/remote-build/remote/update") && init?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("uses text hierarchy instead of badges for table metadata and image tags", async () => {
    const user = userEvent.setup();
    const containerId = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const dashboard: DashboardSnapshot = {
      composeProjects: [
        {
          configFiles: ["/data/compose/remote-stack/compose.yaml"],
          name: "remote-stack",
          remote: {
            buildContext: false,
            checkedAt: "2026-08-23T10:00:00.000Z",
            updateAvailable: false,
            url: "https://example.com/compose.yaml",
          },
          status: "created(1)",
        },
      ],
      containers: [
        {
          composeProject: "remote-stack",
          composeService: "web",
          id: containerId,
          image: "nginx:alpine",
          name: "remote-stack-web-1",
          ports: "",
          state: "created",
          status: "Created",
        },
      ],
      images: [
        {
          createdAt: "2026-08-24T10:00:00.000Z",
          createdSince: "today",
          id: "image-id",
          platform: "linux/arm64",
          repository: "nginx",
          size: "20MB",
          tag: "alpine",
          url: "docker.io/library/nginx:alpine",
        },
      ],
      networks: [
        {
          builtIn: true,
          createdAt: "today",
          driver: "bridge",
          id: "network-id",
          internal: false,
          ipv4: true,
          ipv6: false,
          labels: "",
          name: "bridge",
          scope: "local",
        },
      ],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        return String(input).endsWith("/api/operations")
          ? jsonResponse({ operations: [] })
          : jsonResponse(dashboard);
      }),
    );
    window.history.replaceState(null, "", "/containers");
    render(<App />);

    const composeContext = await screen.findByText("Compose · remote-stack / web");
    expect(composeContext.closest(".overseer-primary-meta")).toBeInTheDocument();
    expect(screen.queryByText("remote-stack · web")).not.toBeInTheDocument();
    const containerTable = screen.getByRole("table", { name: "컨테이너 목록" });
    expect(
      within(containerTable)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["이름", "상태", "포트", "작업"]);
    expect(containerTable.querySelectorAll("thead .overseer-table-column-wide")).toHaveLength(1);
    expect(
      containerTable.querySelectorAll("tbody tr:first-child .overseer-table-column-wide"),
    ).toHaveLength(1);
    expect(within(containerTable).getByText("nginx:alpine")).toBeInTheDocument();
    expect(within(containerTable).getByText("0123456789ab")).toHaveAttribute("title", containerId);
    expect(
      within(containerTable).getByRole("link", { name: "remote-stack-web-1" }),
    ).toHaveAttribute("href", `/containers/${containerId}`);

    await user.click(screen.getByRole("link", { name: "Compose" }));
    expect(await screen.findByText("1개 생성됨")).toBeInTheDocument();
    expect(screen.getByText("URL 등록").closest(".overseer-primary-meta")).toBeInTheDocument();
    expect(screen.queryByText("최신")).not.toBeInTheDocument();
    const composeTable = screen.getByRole("table", { name: "Compose 프로젝트 목록" });
    expect(
      within(composeTable)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["프로젝트", "상태", "작업"]);
    expect(composeTable.querySelectorAll("thead .overseer-table-column-wide")).toHaveLength(1);
    expect(within(composeTable).getByText("https://example.com/compose.yaml")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "이미지" }));
    expect(await screen.findByRole("link", { name: "nginx:alpine" })).toBeInTheDocument();
    expect(screen.getByText("docker.io/library/nginx:alpine").tagName).toBe("CODE");
    expect(screen.queryByRole("columnheader", { name: "태그" })).not.toBeInTheDocument();
    const imageTable = screen.getByRole("table", { name: "이미지 태그 목록" });
    expect(imageTable.querySelectorAll("thead .overseer-table-column-wide")).toHaveLength(1);
    expect(
      within(imageTable).getByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "네트워크" }));
    expect(await screen.findByText("Docker 기본 네트워크")).toHaveClass("overseer-primary-meta");
    expect(
      screen
        .getByRole("table", { name: "네트워크 목록" })
        .querySelectorAll("thead .overseer-table-column-wide"),
    ).toHaveLength(1);
  });

  it("switches between tag and image ID views and removes a single tag by reference", async () => {
    const user = userEvent.setup();
    const imageId = "3e24e96c89ef";
    const tags = ["2", "2.5.3", "next"];
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: tags.map((tag) => ({
        createdAt: "2026-08-27T10:00:00.000Z",
        createdSince: "today",
        id: imageId,
        platform: "linux/arm64",
        repository: "louislam/uptime-kuma",
        size: "601MB",
        tag,
        url: `docker.io/louislam/uptime-kuma:${tag}`,
      })),
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "정상",
        phase: "running",
      },
      volumes: [],
    };
    let removeTagBody: unknown;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/images/tags/remove") && init?.method === "POST") {
        removeTagBody = JSON.parse(String(init.body));
        return jsonResponse(
          {
            operation: operation("queued", {
              id: "remove-image-tag",
              kind: "image.tag.remove",
              target: { id: imageId, name: tags[1]!, resource: "image" },
              title: "이미지 태그 삭제",
            }),
          },
          202,
        );
      }
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/images");
    render(<App />);

    const viewToggle = await screen.findByRole("group", { name: "이미지 보기 기준" });
    const refresh = screen.getByRole("button", { name: "새로고침" });
    expect(viewToggle.parentElement).toBe(refresh.parentElement);
    expect(within(viewToggle).getByRole("button", { name: "태그" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("table", { name: "이미지 태그 목록" })).toBeInTheDocument();

    const deleteTag = screen.getByRole("button", {
      name: "louislam/uptime-kuma:2.5.3 태그 삭제",
    });
    await user.hover(deleteTag);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "louislam/uptime-kuma:2.5.3 태그 삭제",
    );
    await user.click(deleteTag);
    const tagDialog = await screen.findByRole("alertdialog", {
      name: "louislam/uptime-kuma:2.5.3 태그를 삭제하시겠습니까?",
    });
    expect(tagDialog).toHaveTextContent("다른 태그는 유지");
    await user.click(within(tagDialog).getByRole("button", { name: "태그 삭제" }));
    await waitFor(() =>
      expect(removeTagBody).toEqual({
        id: imageId,
        reference: "docker.io/louislam/uptime-kuma:2.5.3",
      }),
    );

    await user.click(within(viewToggle).getByRole("button", { name: "이미지 ID" }));
    expect(screen.getByRole("table", { name: "이미지 ID 목록" })).toBeInTheDocument();
    expect(screen.getByText("3개 태그")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: imageId })).toHaveLength(1);
    const deleteImage = screen.getByRole("button", { name: `${imageId} 이미지 삭제` });
    await waitFor(() => expect(deleteImage).toBeEnabled());
    await user.click(deleteImage);
    const imageDialog = await screen.findByRole("alertdialog", {
      name: `${imageId} 이미지와 모든 태그를 삭제하시겠습니까?`,
    });
    expect(imageDialog).toHaveTextContent("연결된 태그 3개와 이미지 데이터를 삭제");
    expect(imageDialog).toHaveTextContent("uptime-kuma:2.5.3");
    await user.click(within(imageDialog).getByRole("button", { name: "취소" }));
    await user.click(screen.getByRole("link", { name: "볼륨" }));
    await screen.findByRole("heading", { name: "볼륨", level: 1 });
    await user.click(screen.getByRole("link", { name: "이미지" }));
    expect(await screen.findByRole("table", { name: "이미지 ID 목록" })).toBeInTheDocument();
  });

  it.each([true, false])(
    "presents the volume detail header without generic copy (anonymous=%s)",
    async (anonymous) => {
      const name = anonymous ? "a".repeat(64) : "app-data";
      const labels = anonymous ? "com.docker.volume.anonymous=" : "team=platform";
      const dashboard: DashboardSnapshot = {
        composeProjects: [],
        containers: [],
        images: [],
        networks: [],
        volumes: [{ name, labels, driver: "local", scope: "local" }],
        runtime: {
          phase: "running",
          instance: "overseer",
          message: "정상",
          dockerVersion: "29.7.2",
        },
      };
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
        if (url.endsWith(`/api/volumes/${name}`))
          return jsonResponse({
            volume: {
              name,
              driver: "local",
              scope: "local",
              mountpoint: "/volume-data",
              inspectJson: "{}",
              options: [],
              labels: anonymous ? [{ key: "com.docker.volume.anonymous", value: "" }] : [],
            },
          });
        return jsonResponse(dashboard);
      });
      vi.stubGlobal("fetch", fetcher);
      window.history.replaceState(null, "", `/volumes/${name}`);
      render(<App />);
      const heading = await screen.findByRole("heading", {
        level: 1,
        name: anonymous ? "docker:anonymous" : name,
      });
      if (anonymous) expect(within(heading.parentElement!).getByText(name)).toBeInTheDocument();
      expect(
        screen.queryByText("Docker 볼륨의 저장 위치와 원본 구성을 탐색합니다."),
      ).not.toBeInTheDocument();
      expect(await screen.findByText("/volume-data")).toBeInTheDocument();
      expect(window.location.pathname).toBe(`/volumes/${name}`);
      expect(
        fetcher.mock.calls.some(([input]) => String(input).endsWith(`/api/volumes/${name}`)),
      ).toBe(true);
    },
  );

  it("opens volume and network detail pages with raw information", async () => {
    const user = userEvent.setup();
    const containerId = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [
        {
          builtIn: true,
          createdAt: "today",
          driver: "bridge",
          id: "network-id",
          internal: false,
          ipv4: true,
          ipv6: false,
          labels: "",
          name: "bridge",
          scope: "local",
        },
      ],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "Lima와 Docker가 정상적으로 실행 중입니다.",
        phase: "running",
      },
      volumes: [{ driver: "local", labels: "team=platform", name: "app-data", scope: "local" }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
        if (url.endsWith("/api/volumes/app-data")) {
          return jsonResponse({
            volume: {
              createdAt: "2026-08-24T10:00:00.000Z",
              driver: "local",
              inspectJson: '{\n  "Name": "app-data"\n}',
              labels: [{ key: "team", value: "platform" }],
              mountpoint: "/var/lib/docker/volumes/app-data/_data",
              name: "app-data",
              options: [{ key: "type", value: "none" }],
              scope: "local",
            },
          });
        }
        if (url.endsWith("/api/networks/bridge")) {
          return jsonResponse({
            network: {
              attachable: false,
              builtIn: true,
              configOnly: false,
              containers: [
                {
                  id: containerId,
                  ipv4Address: "172.17.0.2/16",
                  macAddress: "02:42:ac:11:00:02",
                  name: "web",
                },
              ],
              createdAt: "2026-08-24T10:00:00.000Z",
              driver: "bridge",
              enableIpv4: true,
              enableIpv6: false,
              id: "network-id",
              ingress: false,
              inspectJson: '{\n  "Name": "bridge"\n}',
              internal: false,
              ipamConfigurations: [
                {
                  auxiliaryAddresses: [],
                  gateway: "172.17.0.1",
                  subnet: "172.17.0.0/16",
                },
              ],
              ipamDriver: "default",
              ipamOptions: [],
              labels: [],
              name: "bridge",
              options: [{ key: "com.docker.network.bridge.name", value: "docker0" }],
              scope: "local",
            },
          });
        }
        return jsonResponse(dashboard);
      }),
    );

    window.history.replaceState(null, "", "/volumes");
    render(<App />);

    expect(await screen.findByRole("heading", { name: "볼륨", level: 1 })).toBeInTheDocument();
    await user.click(await screen.findByRole("link", { name: "app-data" }));

    expect(await screen.findByRole("heading", { name: "app-data", level: 1 })).toBeInTheDocument();
    expect(await screen.findByText("/var/lib/docker/volumes/app-data/_data")).toBeInTheDocument();
    const volumeNavigation = screen.getByRole("navigation", { name: "볼륨 상세 메뉴" });
    await user.click(within(volumeNavigation).getByRole("link", { name: "드라이버 설정" }));
    expect(screen.getByText("type")).toBeInTheDocument();
    await user.click(within(volumeNavigation).getByRole("link", { name: "라벨" }));
    expect(screen.getByText("team")).toBeInTheDocument();
    await user.click(within(volumeNavigation).getByRole("link", { name: "원본 정보" }));
    expect(screen.getByRole("region", { name: "볼륨 원본 JSON" })).toHaveTextContent(
      '"Name": "app-data"',
    );
    await user.click(
      within(screen.getByRole("navigation", { name: "현재 위치" })).getByRole("link", {
        name: "볼륨",
      }),
    );

    await user.click(screen.getByRole("link", { name: "네트워크" }));

    expect(screen.getByRole("heading", { name: "네트워크", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /bridge/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "bridge 네트워크 삭제" })).toHaveAttribute(
      "data-city-icon-only",
      "",
    );
    await user.click(screen.getByRole("link", { name: "bridge" }));

    expect(await screen.findByRole("heading", { name: "bridge", level: 1 })).toBeInTheDocument();
    expect((await screen.findByText("ID", { selector: "dt" })).parentElement).toHaveClass(
      "overseer-detail-definition--wide",
    );
    const networkNavigation = await screen.findByRole("navigation", {
      name: "네트워크 상세 메뉴",
    });
    await user.click(within(networkNavigation).getByRole("link", { name: "IP 주소 관리" }));
    expect(screen.getByText("172.17.0.0/16")).toBeInTheDocument();
    await user.click(within(networkNavigation).getByRole("link", { name: "연결 컨테이너" }));
    expect(screen.getByRole("link", { name: "web" })).toHaveAttribute(
      "href",
      `/containers/${containerId}`,
    );
    expect(screen.getByText("abcdef012345")).toHaveAttribute("title", containerId);
    await user.click(within(networkNavigation).getByRole("link", { name: "드라이버 설정" }));
    expect(screen.getByText("com.docker.network.bridge.name")).toBeInTheDocument();
    await user.click(within(networkNavigation).getByRole("link", { name: "원본 정보" }));
    expect(screen.getByRole("region", { name: "네트워크 원본 JSON" })).toHaveTextContent(
      '"Name": "bridge"',
    );
    await user.click(
      within(screen.getByRole("navigation", { name: "현재 위치" })).getByRole("link", {
        name: "네트워크",
      }),
    );
    expect(window.location.pathname).toBe("/networks");
  });

  it("shows invalid resource names beside the City DS field", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "Lima와 Docker가 정상적으로 실행 중입니다.",
        phase: "running",
      },
      volumes: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/api/startup")
        ? jsonResponse(startupSnapshot())
        : jsonResponse(dashboard),
    );
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/volumes");
    render(<App />);
    await screen.findByText("볼륨이 없습니다.");

    await user.click(screen.getByRole("button", { name: "볼륨 만들기" }));
    const nameInput = screen.getByRole("textbox", { name: "이름" });
    await user.type(nameInput, "bad/name");
    await user.click(screen.getByRole("button", { name: "볼륨 만들기" }));

    expect(
      screen.getByText("영문·숫자로 시작하고 점·밑줄·하이픈만 사용하십시오."),
    ).toBeInTheDocument();
    await user.clear(nameInput);
    await user.type(nameInput, "app-data");
    expect(
      screen.queryByText("영문·숫자로 시작하고 점·밑줄·하이픈만 사용하십시오."),
    ).not.toBeInTheDocument();
    const calls = fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit?]>;
    expect(calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("reports successful resource creation with a City DS toast", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "Lima와 Docker가 정상적으로 실행 중입니다.",
        phase: "running",
      },
      volumes: [],
    };
    let submitted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/api/startup")) return jsonResponse(startupSnapshot());

        if (String(input).endsWith("/api/operations")) {
          return jsonResponse({ operations: submitted ? [operation("succeeded")] : [] });
        }
        if (init?.method === "POST") {
          submitted = true;
          return jsonResponse({ operation: operation() }, 202);
        }
        return jsonResponse(dashboard);
      }),
    );
    window.history.replaceState(null, "", "/volumes");
    render(<App />);
    await screen.findByText("볼륨이 없습니다.");

    await user.click(screen.getByRole("button", { name: "볼륨 만들기" }));
    await user.type(screen.getByRole("textbox", { name: "이름" }), "app-data");
    await user.click(screen.getByRole("button", { name: "볼륨 만들기" }));

    expect(await screen.findByTestId("operation-operation-id-started")).toHaveTextContent(
      "볼륨 만들기",
    );
    await waitFor(
      () => {
        expect(screen.getByTestId("operation-operation-id-succeeded")).toHaveTextContent(
          "app-data 볼륨을 만들었습니다.",
        );
      },
      { timeout: 2_500 },
    );
  });

  it("renders a recoverable API failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          { error: { code: "runtime_unavailable", message: "Lima에 연결할 수 없습니다." } },
          503,
        ),
      ),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("Overseer에 연결하지 못했습니다.")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeEnabled();
    expect(screen.queryByText("Lima 런타임이 준비되지 않았습니다.")).not.toBeInTheDocument();
  });
  it("checks CLI tool updates once, retains failures, and refreshes the active version after retry", async () => {
    const user = userEvent.setup();
    let checked = false;
    let upgraded = false;
    let attempts = 0;
    let finishCheck: (() => void) | undefined;
    let latest: OperationSnapshot | undefined;
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      volumes: [],
      runtime: { phase: "running", instance: "overseer", message: "정상", dockerVersion: "29.7.2" },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/operations"))
        return jsonResponse({ operations: latest ? [latest] : [] });
      if (url.endsWith("/api/docker-cli/plugins/updates/check") && init?.method === "POST") {
        await new Promise<void>((resolve) => {
          finishCheck = resolve;
        });
        checked = true;
        latest = operation("succeeded", {
          id: "cli-check",
          kind: "docker.plugin.update.check",
          target: { resource: "dockerPlugin", name: "CLI 도구" },
          title: "CLI 도구 업데이트 확인",
        });
        return jsonResponse({ operation: latest }, 202);
      }
      if (url.endsWith("/api/docker-cli/plugins/buildx/update") && init?.method === "POST") {
        attempts += 1;
        upgraded = attempts > 1;
        latest = operation(upgraded ? "succeeded" : "failed", {
          id: `cli-update-${attempts}`,
          kind: "docker.plugin.update",
          target: { resource: "dockerPlugin", id: "buildx", name: "Docker Buildx" },
          title: "Docker Buildx 업데이트",
          ...(upgraded
            ? {}
            : { error: { code: "verification_failed", message: "활성 버전 확인 실패" } }),
        });
        return jsonResponse({ operation: latest }, 202);
      }
      if (url.endsWith("/api/docker-cli/plugins"))
        return jsonResponse({
          ...(checked ? { checkedAt: "2026-10-02T00:00:00Z" } : {}),
          plugins: [
            {
              id: "buildx",
              label: "Docker Buildx",
              description: "빌드 도구",
              installed: true,
              management: "extensions",
              installAvailable: false,
              source: "homebrew",
              executablePath: "/opt/homebrew/lib/docker/cli-plugins/docker-buildx",
              automaticUpdate: true,
              version: upgraded ? "0.30.0" : "0.29.1",
              ...(checked ? { latestVersion: "0.30.0", updateAvailable: !upgraded } : {}),
            },
            {
              id: "compose",
              label: "Docker Compose",
              description: "Compose 도구",
              installed: true,
              management: "startup",
              installAvailable: false,
              source: "external",
              executablePath: "/custom/docker-compose",
              version: "2.40.0",
              automaticUpdate: false,
              updateUnavailableReason: "외부 설치 도구는 수동 업데이트가 필요합니다.",
            },
          ],
        });
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/docker-plugins");
    render(<App />);
    const list = await screen.findByRole("list", { name: "Docker CLI 도구 목록" });
    expect(list).not.toHaveTextContent("/opt/homebrew/lib/docker/cli-plugins/docker-buildx");
    expect(list).not.toHaveTextContent("/custom/docker-compose");
    expect(list).toHaveTextContent("외부 설치 도구는 수동 업데이트가 필요합니다.");
    const buildxBeforeCheck = within(list).getByRole("region", { name: "Docker Buildx" });
    expect(
      within(buildxBeforeCheck).getByRole("group", { name: "현재 버전 0.29.1" }),
    ).toHaveTextContent("0.29.1");
    expect(
      within(buildxBeforeCheck).getByText("Homebrew", { selector: "[data-city-badge]" }),
    ).toBeInTheDocument();
    const compose = within(list).getByRole("region", { name: "Docker Compose" });
    expect(compose).toHaveTextContent("외부 설치");
    expect(compose).toHaveTextContent("수동 관리");
    expect(
      screen.queryByRole("button", { name: "Docker Compose 업데이트" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Docker Buildx 업데이트" }),
    ).not.toBeInTheDocument();
    const check = screen.getByRole("button", { name: "업데이트 확인" });
    await user.click(check);
    expect(check).toBeDisabled();
    await user.click(check);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).endsWith("/api/docker-cli/plugins/updates/check"),
      ),
    ).toHaveLength(1);
    finishCheck!();
    const update = await screen.findByRole("button", { name: "Docker Buildx 업데이트" });
    await waitFor(() => expect(update).toBeEnabled());
    await waitFor(() =>
      expect(
        within(buildxBeforeCheck).getByRole("group", {
          name: "현재 버전 0.29.1, 최신 버전 0.30.0",
        }),
      ).toHaveTextContent("0.29.1(0.30.0)"),
    );
    await user.click(update);
    expect(
      await screen.findByRole("heading", { name: "Docker Buildx 업데이트에 실패했습니다." }),
    ).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: "Docker Buildx 업데이트" });
    await waitFor(() => expect(retry).toBeEnabled());
    await user.click(retry);
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "Docker Buildx 업데이트에 실패했습니다." }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Docker Buildx 업데이트" }),
      ).not.toBeInTheDocument(),
    );
    const buildx = screen.getByRole("region", { name: "Docker Buildx" });
    expect(
      within(buildx).getByRole("group", {
        name: "현재 버전 0.30.0",
      }),
    ).toHaveTextContent(/^0\.30\.0$/);
    expect(buildx).toHaveTextContent("최신");
    expect(attempts).toBe(2);
  });

  it("updates eligible CLI tools sequentially and stops after an update fails", async () => {
    const user = userEvent.setup();
    let checked = false;
    let latestOperation: OperationSnapshot | undefined;
    const completedOperations = new Set<string>();
    const updatedTools = new Set<string>();
    const updateRequests: string[] = [];
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      volumes: [],
      runtime: { phase: "running", instance: "overseer", message: "정상", dockerVersion: "29.7.2" },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/operations")) {
        if (latestOperation?.status === "running" && completedOperations.has(latestOperation.id)) {
          const current = latestOperation;
          const failed = current.target.id === "compose";
          latestOperation = {
            ...current,
            status: failed ? "failed" : "succeeded",
            step: failed ? "실패" : "완료됨",
            ...(failed
              ? { error: { code: "update_failed", message: "활성 버전을 확인하지 못했습니다." } }
              : {}),
          };
          if (!failed && current.target.id) updatedTools.add(current.target.id);
        }
        return jsonResponse({ operations: latestOperation ? [latestOperation] : [] });
      }
      if (url.endsWith("/api/docker-cli/plugins/updates/check") && init?.method === "POST") {
        checked = true;
        latestOperation = operation("succeeded", {
          id: "bulk-check",
          kind: "docker.plugin.update.check",
          target: { resource: "dockerPlugin", name: "CLI 도구" },
          title: "CLI 도구 업데이트 확인",
        });
        return jsonResponse({ operation: latestOperation }, 202);
      }
      if (url.endsWith("/api/docker-cli/plugins")) {
        const plugin = (
          id: "buildx" | "compose" | "docker" | "lima",
          label: string,
          management: "extensions" | "startup",
        ) => ({
          automaticUpdate: true,
          description: `${label} 관리`,
          id,
          installAvailable: false,
          installed: true,
          label,
          management,
          source: "homebrew",
          version: "1.0.0",
          latestVersion: "2.0.0",
          ...(checked ? { updateAvailable: !updatedTools.has(id) } : {}),
        });
        return jsonResponse({
          ...(checked ? { checkedAt: "2026-10-22T00:00:00Z" } : {}),
          plugins: [
            plugin("docker", "Docker CLI", "startup"),
            plugin("compose", "Docker Compose", "startup"),
            plugin("buildx", "Docker Buildx", "extensions"),
            plugin("lima", "Lima", "startup"),
          ],
        });
      }
      const updateMatch = url.match(
        /\/api\/docker-cli\/plugins\/(docker|compose|buildx|lima)\/update$/,
      );
      if (updateMatch && init?.method === "POST") {
        const id = updateMatch[1]!;
        const label =
          id === "docker"
            ? "Docker CLI"
            : id === "compose"
              ? "Docker Compose"
              : id === "buildx"
                ? "Docker Buildx"
                : "Lima";
        updateRequests.push(id);
        latestOperation = operation("running", {
          id: `bulk-${id}`,
          kind: "docker.plugin.update",
          target: { id, name: label, resource: "dockerPlugin" },
          title: `${label} 업데이트`,
        });
        return jsonResponse({ operation: latestOperation }, 202);
      }
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/docker-plugins");
    render(<App />);

    const bulkButton = await screen.findByRole("button", { name: "전체 업데이트" });
    expect(bulkButton.parentElement).toContainElement(
      screen.getByRole("button", { name: "업데이트 확인" }),
    );
    expect(bulkButton).toBeDisabled();
    expect(await screen.findByText("업데이트 확인을 먼저 실행하십시오.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "업데이트 확인" }));
    await waitFor(() => expect(bulkButton).toBeEnabled());

    await user.click(bulkButton);
    await waitFor(() => expect(updateRequests).toEqual(["docker"]));
    expect(bulkButton).toBeDisabled();

    completedOperations.add("bulk-docker");
    await waitFor(() => expect(updateRequests).toEqual(["docker", "compose"]), { timeout: 4000 });
    completedOperations.add("bulk-compose");

    await waitFor(
      () =>
        expect(
          screen.getByRole("heading", { name: "전체 업데이트가 중단되었습니다." }),
        ).toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(
      screen.getByRole("heading", { name: "Docker Compose 업데이트에 실패했습니다." }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "1개 도구 업데이트를 마친 뒤 중단했습니다. 남은 업데이트는 시작하지 않았습니다.",
      ),
    ).toBeInTheDocument();
    expect(updateRequests).toEqual(["docker", "compose"]);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith("/api/docker-cli/plugins/buildx/update"),
      ),
    ).toBe(false);
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith("/api/docker-cli/plugins/lima/update"),
      ),
    ).toBe(false);
  });

  it("bulk-updates only installed, managed tools with a confirmed update", async () => {
    const user = userEvent.setup();
    let checked = false;
    let buildxUpdated = false;
    let limaUpdated = false;
    let latestOperation: OperationSnapshot | undefined;
    const updateRequests: string[] = [];
    const installRequests: string[] = [];
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [],
      networks: [],
      volumes: [],
      runtime: { phase: "running", instance: "overseer", message: "정상", dockerVersion: "29.7.2" },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/operations"))
        return jsonResponse({ operations: latestOperation ? [latestOperation] : [] });
      if (url.endsWith("/api/docker-cli/plugins/updates/check") && init?.method === "POST") {
        checked = true;
        latestOperation = operation("succeeded", {
          id: "filtered-check",
          kind: "docker.plugin.update.check",
          target: { resource: "dockerPlugin", name: "CLI 도구" },
          title: "CLI 도구 업데이트 확인",
        });
        return jsonResponse({ operation: latestOperation }, 202);
      }
      if (url.endsWith("/api/docker-cli/plugins")) {
        return jsonResponse({
          ...(checked ? { checkedAt: "2026-10-22T00:00:00Z" } : {}),
          plugins: [
            {
              id: "docker",
              label: "Docker CLI",
              description: "Docker CLI 관리",
              installed: true,
              installAvailable: false,
              management: "startup",
              source: "unknown",
              automaticUpdate: true,
              ...(checked ? { latestVersion: "2.0.0", updateAvailable: true } : {}),
            },
            {
              id: "compose",
              label: "Docker Compose",
              description: "Compose 관리",
              installed: false,
              installAvailable: true,
              management: "startup",
              source: "external",
              automaticUpdate: false,
              ...(checked ? { latestVersion: "2.0.0", updateAvailable: true } : {}),
            },
            {
              id: "buildx",
              label: "Docker Buildx",
              description: "Buildx 관리",
              installed: true,
              installAvailable: false,
              management: "extensions",
              source: "homebrew",
              automaticUpdate: true,
              ...(checked ? { latestVersion: "2.0.0", updateAvailable: !buildxUpdated } : {}),
            },
            {
              id: "lima",
              label: "Lima",
              description: "Lima VM 관리",
              installed: true,
              installAvailable: false,
              management: "startup",
              source: "homebrew",
              automaticUpdate: true,
              ...(checked ? { latestVersion: "2.2.0", updateAvailable: !limaUpdated } : {}),
            },
          ],
        });
      }
      const updateMatch = url.match(
        /\/api\/docker-cli\/plugins\/(docker|compose|buildx|lima)\/update$/,
      );
      if (updateMatch && init?.method === "POST") {
        const id = updateMatch[1]!;
        const label = id === "buildx" ? "Docker Buildx" : "Lima";
        updateRequests.push(id);
        if (id === "buildx") buildxUpdated = true;
        if (id === "lima") limaUpdated = true;
        latestOperation = operation("succeeded", {
          id: `filtered-${id}-update`,
          kind: "docker.plugin.update",
          target: { id, name: label, resource: "dockerPlugin" },
          title: `${label} 업데이트`,
        });
        return jsonResponse({ operation: latestOperation }, 202);
      }
      const installMatch = url.match(
        /\/api\/docker-cli\/plugins\/(docker|compose|buildx|lima)\/install$/,
      );
      if (installMatch && init?.method === "POST") installRequests.push(installMatch[1]!);
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/docker-plugins");
    render(<App />);

    const list = await screen.findByRole("list", { name: "Docker CLI 도구 목록" });
    const docker = within(list).getByRole("region", { name: "Docker CLI" });
    expect(docker).toHaveTextContent("출처 확인 불가");
    expect(docker).toHaveTextContent("수동 관리");
    expect(screen.queryByRole("button", { name: "Docker CLI 업데이트" })).not.toBeInTheDocument();
    const compose = within(list).getByRole("region", { name: "Docker Compose" });
    expect(compose).toHaveTextContent("설치 필요");
    const lima = within(list).getByRole("region", { name: "Lima" });
    expect(
      within(lima).getByText("Homebrew", { selector: "[data-city-badge]" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "업데이트 확인" }));
    const bulkButton = screen.getByRole("button", { name: "전체 업데이트" });
    await waitFor(() => expect(bulkButton).toBeEnabled());
    expect(docker).toHaveTextContent("수동 관리");
    expect(screen.queryByRole("button", { name: "Docker CLI 업데이트" })).not.toBeInTheDocument();
    await user.click(bulkButton);

    expect(
      await screen.findByRole("heading", { name: "전체 업데이트를 완료했습니다." }),
    ).toBeInTheDocument();
    expect(updateRequests).toEqual(["buildx", "lima"]);
    expect(installRequests).toEqual([]);
    await waitFor(() => expect(bulkButton).toBeDisabled());
    expect(screen.getByText("업데이트할 도구가 없습니다.")).toBeInTheDocument();
  });

  it("continues a CLI bulk update after navigating away from the page", async () => {
    const { completeOperation, updateRequests, user } = renderDockerPluginBulkUpdateApp();
    await screen.findByRole("list", { name: "Docker CLI 도구 목록" });
    const bulkButton = screen.getByRole("button", { name: "전체 업데이트" });
    await user.click(screen.getByRole("button", { name: "업데이트 확인" }));
    await waitFor(() => expect(bulkButton).toBeEnabled());
    await user.click(bulkButton);
    await waitFor(() => expect(updateRequests).toEqual(["docker"]));

    await user.click(screen.getByRole("button", { name: "도커" }));
    expect(await screen.findByRole("heading", { name: "Compose", level: 1 })).toBeInTheDocument();
    completeOperation("bulk-docker");
    await waitFor(() => expect(updateRequests).toEqual(["docker", "compose"]), { timeout: 3500 });

    await user.click(screen.getByRole("button", { name: "CLI" }));
    expect(await screen.findByRole("heading", { name: "도구", level: 1 })).toBeInTheDocument();
    expect(await screen.findByText(/Docker Compose 업데이트 중 \(2\/4\)/)).toBeInTheDocument();
    completeOperation("bulk-compose");
    await waitFor(() => expect(updateRequests).toEqual(["docker", "compose", "buildx"]), {
      timeout: 3500,
    });
    completeOperation("bulk-buildx");
    await waitFor(() => expect(updateRequests).toEqual(["docker", "compose", "buildx", "lima"]), {
      timeout: 3500,
    });
    expect(await screen.findByText(/Lima 업데이트 중 \(4\/4\)/)).toBeInTheDocument();
    completeOperation("bulk-lima");
    expect(
      await screen.findByRole(
        "heading",
        { name: "전체 업데이트를 완료했습니다." },
        { timeout: 10000 },
      ),
    ).toBeInTheDocument();
    expect(updateRequests).toEqual(["docker", "compose", "buildx", "lima"]);
  }, 15000);

  it("tracks each bulk update by operation ID when newer plugin operations appear", async () => {
    const { addUnrelatedNewestOperation, completeOperation, updateRequests, user } =
      renderDockerPluginBulkUpdateApp();
    await screen.findByRole("list", { name: "Docker CLI 도구 목록" });
    await user.click(screen.getByRole("button", { name: "업데이트 확인" }));
    const bulkButton = screen.getByRole("button", { name: "전체 업데이트" });
    await waitFor(() => expect(bulkButton).toBeEnabled());
    await user.click(bulkButton);
    await waitFor(() => expect(updateRequests).toEqual(["docker"]));

    addUnrelatedNewestOperation();
    completeOperation("bulk-docker");
    await waitFor(() => expect(updateRequests).toEqual(["docker", "compose"]), { timeout: 3500 });
    expect(await screen.findByText(/Docker Compose 업데이트 중 \(2\/4\)/)).toBeInTheDocument();

    completeOperation("bulk-compose");
    await waitFor(() => expect(updateRequests).toEqual(["docker", "compose", "buildx"]), {
      timeout: 3500,
    });
    completeOperation("bulk-buildx");
    await waitFor(() => expect(updateRequests).toEqual(["docker", "compose", "buildx", "lima"]), {
      timeout: 3500,
    });
    completeOperation("bulk-lima");
    expect(
      await screen.findByRole(
        "heading",
        { name: "전체 업데이트를 완료했습니다." },
        { timeout: 10000 },
      ),
    ).toBeInTheDocument();
    expect(updateRequests).toEqual(["docker", "compose", "buildx", "lima"]);
  }, 15000);

  it("continues and completes a bulk update after an operations read failure", async () => {
    const {
      completeOperation,
      failedOperationsReadCount,
      hideOperationOnceThenFailOperationsRead,
      updateRequests,
      user,
    } = renderDockerPluginBulkUpdateApp();
    await screen.findByRole("list", { name: "Docker CLI 도구 목록" });
    await user.click(screen.getByRole("button", { name: "업데이트 확인" }));
    const bulkButton = screen.getByRole("button", { name: "전체 업데이트" });
    await waitFor(() => expect(bulkButton).toBeEnabled());
    await user.click(bulkButton);
    await waitFor(() => expect(updateRequests).toEqual(["docker"]));

    hideOperationOnceThenFailOperationsRead("bulk-docker");
    await waitFor(() => expect(failedOperationsReadCount()).toBe(1), { timeout: 3500 });
    expect(await screen.findByText(/Docker CLI 업데이트 중 \(1\/4\)/)).toBeInTheDocument();

    completeOperation("bulk-docker");
    await waitFor(() => expect(updateRequests).toEqual(["docker", "compose"]), { timeout: 3500 });
    completeOperation("bulk-compose");
    await waitFor(() => expect(updateRequests).toEqual(["docker", "compose", "buildx"]), {
      timeout: 3500,
    });
    completeOperation("bulk-buildx");
    await waitFor(() => expect(updateRequests).toEqual(["docker", "compose", "buildx", "lima"]), {
      timeout: 3500,
    });
    completeOperation("bulk-lima");

    expect(
      await screen.findByRole(
        "heading",
        { name: "전체 업데이트를 완료했습니다." },
        { timeout: 10000 },
      ),
    ).toBeInTheDocument();
    expect(updateRequests).toEqual(["docker", "compose", "buildx", "lima"]);
  }, 15000);

  it("stops the bulk update when the tracked operation ID disappears", async () => {
    const { removeOperation, updateRequests, user } = renderDockerPluginBulkUpdateApp();
    await screen.findByRole("list", { name: "Docker CLI 도구 목록" });
    await user.click(screen.getByRole("button", { name: "업데이트 확인" }));
    const bulkButton = screen.getByRole("button", { name: "전체 업데이트" });
    await waitFor(() => expect(bulkButton).toBeEnabled());
    await user.click(bulkButton);
    await waitFor(() => expect(updateRequests).toEqual(["docker"]));

    removeOperation("bulk-docker");

    expect(
      await screen.findByRole(
        "heading",
        { name: "전체 업데이트가 중단되었습니다." },
        { timeout: 4000 },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/현재 업데이트 ID를 찾지 못해/)).toBeInTheDocument();
    expect(updateRequests).toEqual(["docker"]);
  });
});

describe("build history navigation", () => {
  it("opens the build collection through the app router and refreshes its records", async () => {
    const dashboard: DashboardSnapshot = {
      containers: [],
      images: [],
      networks: [],
      volumes: [],
      composeProjects: [],
      runtime: { instance: "overseer", phase: "running", message: "정상" },
    };

    let buildReads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
        if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
        if (url.includes("/api/builds?")) {
          buildReads += 1;
          return jsonResponse({
            instance: "overseer",
            builder: "default",
            records: [],
            count: 0,
            page: 1,
            pageSize: 20,
          });
        }
        return jsonResponse(dashboard);
      }),
    );
    window.history.replaceState(null, "", "/builds");
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: "빌드" })).toBeVisible();
    await waitFor(() => expect(buildReads).toBe(1));
    await user.click(screen.getByRole("button", { name: "새로고침" }));
    await waitFor(() => expect(buildReads).toBeGreaterThan(1));
    expect(window.location.pathname).toBe("/builds");
  });
});
