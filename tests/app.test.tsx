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

describe("App", () => {
  it("matches the loading skeleton to the page shell and table", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    const { container } = render(<App />);

    expect(container.querySelectorAll(".overseer-loading-nav-item")).toHaveLength(7);
    expect(container.querySelector(".overseer-loading-table")).toBeInTheDocument();
    expect(container.querySelector(".overseer-stat-grid")).not.toBeInTheDocument();
  });

  it("uses the mobile header skeleton without flashing desktop navigation", () => {
    mockViewport(390);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    const { container } = render(<App />);

    expect(container.querySelector(".overseer-mobile-header")).toBeInTheDocument();
    expect(container.querySelector(".overseer-sidebar")).not.toBeInTheDocument();
    expect(container.querySelector(".overseer-loading-mobile-brand")).toBeInTheDocument();
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
    let startupRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/startup")) {
          startupRequests += 1;
          return jsonResponse(
            startupRequests === 1
              ? startupSnapshot({ compose: false, docker: false, homebrew: false, lima: false })
              : startupSnapshot({ compose: false, docker: false, homebrew: true, lima: false }),
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
    expect(window.location.pathname).toBe("/startup");
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

    await user.click(screen.getByRole("button", { name: "설치 확인" }));
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
    expect(window.location.pathname).toBe("/startup");
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
      expect(window.location.pathname).toBe("/startup");
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
    expect(window.location.pathname).toBe("/startup");
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
    let startupRequests = 0;
    let releaseRefresh: ((response: Response) => void) | undefined;
    const intervalSpy = vi.spyOn(window, "setInterval");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/startup")) {
          startupRequests += 1;
          if (startupRequests === 1) return jsonResponse(snapshot);
          return new Promise<Response>((resolve) => {
            releaseRefresh = resolve;
          });
        }
        if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
        return jsonResponse(dashboard);
      }),
    );

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Docker Compose를 설치할까요?", level: 2 }),
    ).toBeInTheDocument();
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 10_000);

    await user.click(screen.getByRole("button", { name: "상태 새로고침" }));
    expect(screen.getByRole("button", { name: "새로고침 중…" })).toBeDisabled();
    await waitFor(() => expect(releaseRefresh).toBeTypeOf("function"));
    releaseRefresh?.(jsonResponse(snapshot));
    expect(await screen.findByRole("button", { name: "상태 새로고침" })).toBeEnabled();

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
    let startupRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/startup")) {
          startupRequests += 1;
          return jsonResponse(
            startupRequests === 1 ? startupSnapshot({ lima: false }) : startupSnapshot(),
          );
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
    expect(window.location.pathname).toBe("/startup");

    await user.click(screen.getByRole("button", { name: "상태 새로고침" }));

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
    expect(window.location.pathname).toBe("/startup");
  });

  it("keeps non-Compose resources available when optional Compose is missing", async () => {
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
    expect(screen.queryByRole("button", { name: "폼으로 추가" })).not.toBeInTheDocument();

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
    expect(window.location.pathname).toBe("/startup");
    expect(screen.getByText("설정 필요")).toBeInTheDocument();
    expect(screen.getByText("overseer")).toBeInTheDocument();
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

    render(<App />);

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

    expect(await screen.findByRole("heading", { name: "인스턴스", level: 1 })).toBeInTheDocument();
    expect(await screen.findByRole("columnheader", { name: "가상화" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "컨테이너" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "활성" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "VM 인스턴스" })).not.toBeInTheDocument();
    const createButton = screen.getByRole("button", { name: "인스턴스 만들기" });
    expect(
      screen.getByRole("heading", { name: "인스턴스", level: 1 }).closest(".overseer-page-header"),
    ).toContainElement(createButton);
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
    await user.click(within(dialog).getByRole("button", { name: "만들기" }));

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

    await user.click(instanceMenu);
    expect(
      await screen.findByRole("menuitem", { name: "현재 Docker Engine으로 사용 중" }),
    ).toHaveAttribute("aria-disabled", "true");
    await user.keyboard("{Escape}");

    const navigation = screen.getByRole("navigation", { name: "VM 인스턴스 상세 메뉴" });
    await user.click(within(navigation).getByRole("button", { name: "VM 설정" }));
    expect(window.location.search).toBe("?section=settings");
    expect(screen.getByText("Lima VM")).toBeInTheDocument();
    expect(screen.getByText("Apple Virtualization (VZ)")).toBeInTheDocument();
    expect(screen.getByText("100GiB")).toBeInTheDocument();

    await user.click(within(navigation).getByRole("button", { name: "터미널" }));
    expect(window.location.search).toBe("?section=terminal");
    expect(screen.getByLabelText("VM 인스턴스 터미널 명령")).toHaveTextContent(
      "limactl shell overseer",
    );
    expect(screen.getByRole("button", { name: "터미널 명령 복사" })).toBeEnabled();

    await user.click(within(navigation).getByRole("button", { name: "Docker 연결" }));
    expect(window.location.search).toBe("?section=connection");
    expect(screen.getByText("현재 사용 중")).toBeInTheDocument();
    expect(screen.getByText("29.7.2")).toBeInTheDocument();
    expect(screen.getByText("읽기/쓰기")).toBeInTheDocument();
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
    window.history.replaceState(null, "", "/settings");
    render(<App />);

    const navigation = await screen.findByRole("navigation", { name: "설정 상세 메뉴" });
    expect(
      within(navigation).queryByRole("button", { name: "인스턴스 설정" }),
    ).not.toBeInTheDocument();
    await user.click(within(navigation).getByRole("button", { name: "엔진 설정" }));
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
    window.history.replaceState(null, "", "/settings");
    render(<App />);

    const navigation = await screen.findByRole("navigation", { name: "설정 상세 메뉴" });
    await user.click(within(navigation).getByRole("button", { name: "네트워크 설정" }));
    expect(window.location.search).toBe("?section=network");
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
    window.history.replaceState(null, "", "/settings");
    render(<App />);

    const navigation = await screen.findByRole("navigation", { name: "설정 상세 메뉴" });
    await user.click(within(navigation).getByRole("button", { name: "네트워크 설정" }));
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

  it("checks and updates Homebrew-managed tools from general settings", async () => {
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
      if (url.endsWith("/api/startup/updates")) return jsonResponse(toolUpdateSnapshot());
      if (url.endsWith("/api/startup")) return jsonResponse(startupSnapshot());
      if (url.endsWith("/api/runtime/configuration")) return jsonResponse(dockerEngineSnapshot());
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      if (url.endsWith("/api/startup/updates/check") && init?.method === "POST") {
        return jsonResponse(
          {
            operation: operation("succeeded", {
              id: "tool-check",
              kind: "startup.update.check",
              successMessage: "도구 업데이트를 확인했습니다.",
              target: { name: "Docker CLI·Compose·Lima", resource: "startup" },
              title: "도구 업데이트 확인",
            }),
          },
          202,
        );
      }
      if (url.endsWith("/api/startup/prerequisites/docker/update") && init?.method === "POST") {
        return jsonResponse(
          {
            operation: operation("succeeded", {
              id: "docker-update",
              kind: "startup.update",
              successMessage: "Docker CLI를 업데이트했습니다.",
              target: { id: "docker", name: "Docker CLI", resource: "startup" },
              title: "Docker CLI 업데이트",
            }),
          },
          202,
        );
      }
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/settings");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "도구 업데이트", level: 3 }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/^마지막 확인 \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
    ).toBeInTheDocument();
    const docker = await screen.findByRole("listitem", { name: "Docker CLI" });
    expect(docker).toHaveTextContent("현재29.7.2");
    expect(docker).toHaveTextContent("최신30.0.0");
    expect(docker).toHaveTextContent("업데이트 있음");
    const compose = screen.getByRole("listitem", { name: "Docker Compose" });
    expect(compose).toHaveTextContent("최신");
    expect(
      within(compose).getByText("최신", { selector: "[data-city-badge]" }).querySelector("svg"),
    ).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Lima" })).toHaveTextContent(
      "Homebrew로 설치된 도구만 자동 업데이트할 수 있습니다.",
    );

    await user.click(screen.getByRole("button", { name: "업데이트 확인" }));
    await user.click(screen.getByRole("button", { name: "Docker CLI 업데이트" }));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/startup/updates/check") && init?.method === "POST",
        ),
      ).toBe(true),
    );
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith("/api/startup/prerequisites/docker/update") &&
          init?.method === "POST",
      ),
    ).toBe(true);
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
      vi.fn(async () => jsonResponse(dashboard)),
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
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/api/operations")
          ? jsonResponse({ operations: [] })
          : jsonResponse(dashboard),
      ),
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
    render(<App />);
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
    expect(screen.getByRole("searchbox", { name: "작업 검색" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "상태" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "리소스" })).toBeInTheDocument();
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

  it("groups desktop navigation and keeps settings as a utility", async () => {
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
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/api/operations")
          ? jsonResponse({ operations: [] })
          : jsonResponse(dashboard),
      ),
    );
    render(<App />);
    await screen.findByText("컨테이너가 없습니다.");

    const navigation = screen.getByRole("navigation", { name: "주요 메뉴" });
    const workloads = within(navigation).getByRole("group", { name: "워크로드" });
    const resources = within(navigation).getByRole("group", { name: "리소스" });
    const operations = within(navigation).getByRole("group", { name: "운영" });
    const virtualization = within(navigation).getByRole("group", { name: "가상화" });
    expect(
      within(workloads)
        .getAllByRole("link")
        .map(({ textContent }) => textContent),
    ).toEqual(["Compose", "컨테이너"]);
    expect(
      within(resources)
        .getAllByRole("link")
        .map(({ textContent }) => textContent),
    ).toEqual(["이미지", "볼륨", "네트워크"]);
    expect(within(operations).getByRole("link", { name: "작업 기록" })).toHaveAttribute(
      "href",
      "/operations",
    );
    expect(within(virtualization).getByRole("link", { name: "인스턴스" })).toHaveAttribute(
      "href",
      "/instances",
    );
    expect(
      virtualization.compareDocumentPosition(operations) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(within(navigation).queryByRole("link", { name: "설정" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "유틸리티 메뉴" })).toHaveTextContent("설정");
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
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/api/operations")
          ? jsonResponse({ operations: [] })
          : jsonResponse(dashboard),
      ),
    );
    window.history.replaceState(null, "", "/compose");

    render(<App />);
    await screen.findByRole("heading", { name: "Compose", level: 1 });

    const sidebar = screen.getByRole("complementary");
    expect(sidebar).toHaveAttribute("data-navigation-mode", "rail");
    const composeLink = within(sidebar).getByRole("link", { name: "Compose" });
    expect(composeLink).toHaveAttribute("aria-current", "page");
    await user.hover(composeLink);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Compose");
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
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/api/operations")
          ? jsonResponse({ operations: [] })
          : jsonResponse(dashboard),
      ),
    );
    window.history.replaceState(null, "", "/containers");

    render(<App />);
    await screen.findByRole("heading", { name: "컨테이너", level: 1 });

    expect(screen.queryByRole("navigation", { name: "주요 메뉴" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "주요 메뉴 열기" }));

    const drawer = await screen.findByRole("dialog", { name: "주요 메뉴" });
    const navigation = within(drawer).getByRole("navigation", { name: "주요 메뉴" });
    expect(within(navigation).getByRole("group", { name: "워크로드" })).toBeInTheDocument();
    expect(within(navigation).getByRole("group", { name: "리소스" })).toBeInTheDocument();
    expect(within(navigation).getByRole("group", { name: "운영" })).toBeInTheDocument();
    expect(within(navigation).getByRole("group", { name: "가상화" })).toBeInTheDocument();
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
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("/api/containers/container-id/logs")
          ? jsonResponse({ logs: "first line\nsecond line" })
          : jsonResponse(dashboard),
      ),
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
      vi.fn(async () => jsonResponse(dashboard)),
    );

    render(<App />);
    await screen.findByText("컨테이너가 없습니다.");

    await user.click(screen.getByRole("link", { name: "이미지" }));

    expect(screen.getByRole("heading", { name: "이미지", level: 1 })).toBeInTheDocument();
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
        if (url.includes("/api/images/3e24e96c89ef/tags")) {
          const page = url.includes("page=2") ? 2 : 1;
          return jsonResponse({
            tags: {
              count: 26,
              page,
              pageSize: 25,
              repository: "louislam/uptime-kuma",
              tags: [
                {
                  lastUpdated: "2026-08-24T02:32:04.000Z",
                  name: page === 1 ? "latest" : "nightly",
                  platforms: ["linux/amd64", "linux/arm64"],
                  sizeBytes: 601_000_000,
                },
              ],
            },
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
    expect(within(imageGroup).getByRole("button", { name: "개요" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("linux/arm64")).toBeInTheDocument();
    expect(screen.getByText("sha256:3e24e96c89ef")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Docker Hub" })).toHaveAttribute(
      "href",
      "https://hub.docker.com/r/louislam/uptime-kuma",
    );
    expect(screen.getByRole("button", { name: "GitHub 저장소" })).toHaveAttribute(
      "href",
      "https://github.com/louislam/uptime-kuma",
    );

    await user.click(within(imageGroup).getByRole("button", { name: "저장소 태그" }));
    expect(await screen.findByText("latest")).toBeInTheDocument();
    expect(screen.getByText("linux/amd64 · linux/arm64")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "2페이지" }));
    expect(await screen.findByText("nightly")).toBeInTheDocument();

    await user.click(within(imageGroup).getByRole("button", { name: "실행 설정" }));
    expect(screen.getByText("/app")).toBeInTheDocument();
    expect(screen.getByText("3001/tcp")).toBeInTheDocument();
    expect(screen.getByText("2개")).toBeInTheDocument();

    await user.click(within(imageGroup).getByRole("button", { name: "환경 변수" }));
    expect(screen.getByText("NODE_ENV")).toBeInTheDocument();

    await user.click(within(imageGroup).getByRole("button", { name: "라벨" }));
    expect(screen.getByText("org.opencontainers.image.source")).toBeInTheDocument();

    await user.click(within(imageGroup).getByRole("button", { name: "레이어" }));
    const layerCode = await screen.findByRole("region", { name: "Dockerfile 레이어 코드" });
    expect(layerCode.querySelector("pre")).toHaveTextContent(
      "# Layer 1 · 12MB RUN apt update \\ && apt install curl \\ | tee /tmp/result",
    );
    expect(layerCode.querySelector("pre")).toHaveTextContent(
      '# Layer 2 · 0B CMD ["node" "server/server.js"]',
    );
    expect(within(layerCode).getByRole("button", { name: "코드 보기 옵션" })).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "이미지 레이어 기록" })).not.toBeInTheDocument();

    await user.click(within(imageGroup).getByRole("button", { name: "원본 정보" }));
    const imageInspect = screen.getByRole("region", { name: "이미지 원본 JSON" });
    expect(imageInspect.querySelector("pre")).toHaveTextContent('"Id": "sha256:3e24e96c89ef"');
    expect(
      within(imageInspect).getByRole("button", { name: "원본 JSON 보기 옵션" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "이미지 목록" }));
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
    const containerNavigation = await screen.findByRole("navigation", {
      name: "컨테이너 상세 메뉴",
    });
    const containerGroup = within(containerNavigation).getByRole("group", { name: "컨테이너" });
    expect(within(containerGroup).getByRole("button", { name: "개요" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await user.click(within(containerGroup).getByRole("button", { name: "실행 설정" }));
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
    expect(within(containerGroup).queryByRole("button", { name: "연결" })).not.toBeInTheDocument();

    await user.click(within(containerGroup).getByRole("button", { name: "터미널" }));
    expect(await screen.findByText("sh", { selector: "code" })).toBeInTheDocument();
    expect(screen.getByLabelText("컨테이너 터미널 명령")).toHaveTextContent(
      "docker --context overseer exec -it container-id sh",
    );
    expect(screen.getByRole("button", { name: "터미널 명령 복사" })).toBeEnabled();

    terminalStatus = "shell-not-found";
    await user.click(within(containerGroup).getByRole("button", { name: "실행 설정" }));
    await user.click(within(containerGroup).getByRole("button", { name: "터미널" }));
    expect(
      await screen.findByRole("heading", {
        name: "실행할 셸을 찾을 수 없습니다.",
        level: 3,
      }),
    ).toBeInTheDocument();

    terminalStatus = "not-running";
    await user.click(within(containerGroup).getByRole("button", { name: "실행 설정" }));
    await user.click(within(containerGroup).getByRole("button", { name: "터미널" }));
    expect(
      await screen.findByRole("heading", {
        name: "컨테이너가 실행 중이 아닙니다.",
        level: 3,
      }),
    ).toBeInTheDocument();

    terminalStatus = "paused";
    await user.click(within(containerGroup).getByRole("button", { name: "실행 설정" }));
    await user.click(within(containerGroup).getByRole("button", { name: "터미널" }));
    expect(
      await screen.findByRole("heading", {
        name: "컨테이너가 일시 중지되어 있습니다.",
        level: 3,
      }),
    ).toBeInTheDocument();

    await user.click(within(containerGroup).getByRole("button", { name: "상태 검사" }));
    expect(await screen.findByText("비정상")).toBeInTheDocument();
    expect(screen.getByText("1회")).toBeInTheDocument();
    expect(screen.getAllByText(healthStartedAtLabel)).toHaveLength(2);
    expect(
      await screen.findByRole("region", {
        name: `${healthStartedAtLabel} 상태 검사 출력`,
      }),
    ).toHaveTextContent("service unavailable");
    expect(screen.getByRole("button", { name: "상태 검사 출력 옵션" })).toBeInTheDocument();

    await user.click(within(containerGroup).getByRole("button", { name: "원본 정보" }));
    expect(screen.getByText("민감한 설정이 포함될 수 있습니다.")).toBeInTheDocument();
    const inspectViewer = await screen.findByRole("region", { name: "Docker 원본 JSON" });
    expect(inspectViewer).toHaveTextContent('"Id": "container-id"');
    expect(screen.getByRole("button", { name: "원본 정보 보기 옵션" })).toBeInTheDocument();

    includeHealth = false;
    await user.click(within(containerGroup).getByRole("button", { name: "실행 설정" }));
    await user.click(within(containerGroup).getByRole("button", { name: "상태 검사" }));
    expect(
      await screen.findByRole("heading", {
        name: "상태 검사가 설정되지 않았습니다.",
        level: 3,
      }),
    ).toBeInTheDocument();

    await user.click(within(containerGroup).getByRole("button", { name: "환경 변수" }));
    expect(screen.getByText("MODE")).toBeInTheDocument();

    await user.click(within(containerGroup).getByRole("button", { name: "라벨" }));
    expect(screen.getByText("team")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "컨테이너 목록" }));

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
    expect(within(composeGroup).getByRole("button", { name: "개요" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    expect(within(composeGroup).getByRole("button", { name: "구성" })).toBeEnabled();
    expect(within(composeGroup).getByRole("button", { name: "로그" })).toBeEnabled();
    expect(
      within(composeGroup).queryByRole("button", { name: "업데이트" }),
    ).not.toBeInTheDocument();
    expect(within(composeGroup).queryByRole("button", { name: "폼 설정" })).not.toBeInTheDocument();

    await user.click(within(composeGroup).getByRole("button", { name: "구성" }));
    expect(screen.getAllByText("/workspace/compose.yaml").length).toBeGreaterThan(0);

    await user.click(within(composeGroup).getByRole("button", { name: "로그" }));
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

    await user.click(within(composeGroup).getByRole("button", { name: "서비스" }));
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
    expect(within(group).getByRole("button", { name: "업데이트" })).toBeEnabled();
    expect(within(group).queryByRole("button", { name: "폼 설정" })).not.toBeInTheDocument();

    await user.click(within(group).getByRole("button", { name: "업데이트" }));

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
          builder: { configHash: "a".repeat(64) },
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
        if (url.endsWith("/api/compose/projects/form-stack/builder")) {
          return jsonResponse({
            project: {
              configHash: "a".repeat(64),
              spec,
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
    expect(within(group).getByRole("button", { name: "폼 설정" })).toBeEnabled();
    expect(within(group).queryByRole("button", { name: "업데이트" })).not.toBeInTheDocument();

    await user.click(within(group).getByRole("button", { name: "폼 설정" }));
    await user.click(screen.getByRole("button", { name: "폼 설정 편집" }));

    expect(await screen.findByRole("dialog", { name: "폼 Compose 수정" })).toBeInTheDocument();
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

    expect(await screen.findByRole("dialog", { name: "작업을 시작했습니다." })).toHaveTextContent(
      "URL Compose 등록",
    );
    expect(submittedBody).toEqual({
      name: "remote-stack",
      url: "https://raw.githubusercontent.com/opnay/example/main/compose.yaml",
    });
  });

  it("builds multiple services in a form and previews the generated YAML", async () => {
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

    await user.click(await screen.findByRole("button", { name: "폼으로 추가" }));
    const dialog = await screen.findByRole("dialog", { name: "폼 Compose 추가" });
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

    await user.click(within(dialog).getByRole("tab", { name: "YAML 미리보기" }));
    const yaml = dialog.querySelector(".overseer-compose-yaml-preview code");
    expect(yaml).toHaveTextContent('image: "nginx:latest"');
    expect(yaml).toHaveTextContent('image: "node:22-alpine"');
    expect(yaml?.textContent).toContain("networks:\n  frontend:");
    await user.click(within(dialog).getByRole("button", { name: "Compose 저장" }));

    await waitFor(() => expect(submittedBody).toMatchObject({ name: "demo-stack" }));
    expect(submittedBody).toMatchObject({
      networks: ["frontend"],
      services: [
        { image: "nginx", name: "service-1", tag: "latest" },
        { image: "node", name: "service-2", tag: "22-alpine" },
      ],
      volumes: ["app-data"],
    });
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
          builder: { configHash: "a".repeat(64) },
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
              spec,
              yaml: 'services:\n  web:\n    image: "nginx:latest"\n',
            },
          });
        }
        return jsonResponse(dashboard);
      }),
    );
    window.history.replaceState(null, "", "/compose");
    render(<App />);
    expect(await screen.findByText("폼 등록")).toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", { name: "form-stack 폼 Compose 관리 메뉴" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "구성 편집" }));
    const dialog = await screen.findByRole("dialog", { name: "폼 Compose 수정" });
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
      spec: { services: [{ tag: "1.29-alpine" }] },
    });
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
    await user.click(
      await screen.findByRole("button", { name: "remote-build URL Compose 관리 메뉴" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "등록 해제" }));
    expect(
      await screen.findByRole("alertdialog", { name: "URL Compose 등록을 해제하시겠습니까?" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "취소" }));

    await user.click(
      await screen.findByRole("button", { name: "remote-build URL Compose 관리 메뉴" }),
    );
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
          id: "container-id",
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
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/api/operations")
          ? jsonResponse({ operations: [] })
          : jsonResponse(dashboard),
      ),
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

    await user.click(screen.getByRole("link", { name: "Compose" }));
    expect(screen.getByText("1개 생성됨")).toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: "nginx:alpine" })).toBeInTheDocument();
    expect(screen.getByText("docker.io/library/nginx:alpine").tagName).toBe("CODE");
    expect(screen.queryByRole("columnheader", { name: "태그" })).not.toBeInTheDocument();
    const imageTable = screen.getByRole("table", { name: "이미지 목록" });
    expect(imageTable.querySelectorAll("thead .overseer-table-column-wide")).toHaveLength(1);
    expect(
      within(imageTable).getByText(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "네트워크" }));
    expect(screen.getByText("Docker 기본 네트워크")).toHaveClass("overseer-primary-meta");
    expect(
      screen
        .getByRole("table", { name: "네트워크 목록" })
        .querySelectorAll("thead .overseer-table-column-wide"),
    ).toHaveLength(1);
  });

  it("opens volume and network detail pages with raw information", async () => {
    const user = userEvent.setup();
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
                  id: "container-id",
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
    await user.click(within(volumeNavigation).getByRole("button", { name: "드라이버 설정" }));
    expect(screen.getByText("type")).toBeInTheDocument();
    await user.click(within(volumeNavigation).getByRole("button", { name: "라벨" }));
    expect(screen.getByText("team")).toBeInTheDocument();
    await user.click(within(volumeNavigation).getByRole("button", { name: "원본 정보" }));
    expect(screen.getByRole("region", { name: "볼륨 원본 JSON" })).toHaveTextContent(
      '"Name": "app-data"',
    );
    await user.click(screen.getByRole("button", { name: "볼륨 목록" }));

    await user.click(screen.getByRole("link", { name: "네트워크" }));

    expect(screen.getByRole("heading", { name: "네트워크", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /bridge/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "bridge 네트워크 삭제" })).toHaveAttribute(
      "data-city-icon-only",
      "",
    );
    await user.click(screen.getByRole("link", { name: "bridge" }));

    expect(await screen.findByRole("heading", { name: "bridge", level: 1 })).toBeInTheDocument();
    const networkNavigation = await screen.findByRole("navigation", {
      name: "네트워크 상세 메뉴",
    });
    await user.click(within(networkNavigation).getByRole("button", { name: "IP 주소 관리" }));
    expect(screen.getByText("172.17.0.0/16")).toBeInTheDocument();
    await user.click(within(networkNavigation).getByRole("button", { name: "연결 컨테이너" }));
    expect(screen.getByRole("link", { name: "web" })).toHaveAttribute(
      "href",
      "/containers/container-id",
    );
    await user.click(within(networkNavigation).getByRole("button", { name: "드라이버 설정" }));
    expect(screen.getByText("com.docker.network.bridge.name")).toBeInTheDocument();
    await user.click(within(networkNavigation).getByRole("button", { name: "원본 정보" }));
    expect(screen.getByRole("region", { name: "네트워크 원본 JSON" })).toHaveTextContent(
      '"Name": "bridge"',
    );
    await user.click(screen.getByRole("button", { name: "네트워크 목록" }));
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
    const fetchMock = vi.fn(async () => jsonResponse(dashboard));
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

    expect(await screen.findByRole("dialog", { name: "작업을 시작했습니다." })).toHaveTextContent(
      "볼륨 만들기",
    );
    await waitFor(
      () =>
        expect(screen.getByRole("dialog", { name: "작업을 완료했습니다." })).toHaveTextContent(
          "app-data 볼륨을 만들었습니다.",
        ),
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
});
