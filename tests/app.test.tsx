import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/client/app.tsx";
import { emptyContainerSpec } from "../src/shared/container-spec.ts";
import {
  emptyComposeBuilderService,
  emptyComposeBuilderSpec,
} from "../src/shared/compose-builder.ts";
import type {
  DashboardSnapshot,
  DockerEngineConfigurationSnapshot,
  OperationSnapshot,
  StartupSnapshot,
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
): DockerEngineConfigurationSnapshot {
  return {
    configuration: {
      cpus: 4,
      diskGiB: 100,
      memoryGiB: 4,
      provider: "lima",
      vmType: "vz",
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

function startupSnapshot(
  installed: { compose?: boolean; docker?: boolean; homebrew?: boolean; lima?: boolean } = {},
): StartupSnapshot {
  const values = { compose: true, docker: true, homebrew: true, lima: true, ...installed };
  return {
    prerequisites: [
      {
        automaticInstall: false,
        automaticInstallUnavailableReason:
          "Homebrew는 관리자 인증이 필요하므로 Terminal에서 설치해야 합니다.",
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
          return jsonResponse(startupSnapshot({ docker: false, homebrew: false, lima: false }));
        }
        if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
        return jsonResponse(dashboard);
      }),
    );

    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "Homebrew를 설치해야 합니다.", level: 2 }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Homebrew 설치 명령")).toHaveTextContent(
      "raw.githubusercontent.com/Homebrew/install",
    );
    expect(screen.queryByRole("button", { name: /Homebrew 자동 설치/ })).not.toBeInTheDocument();
    expect(screen.getByText("Terminal에서 설치하십시오.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "설치 확인" }));
    await waitFor(() => expect(startupRequests).toBeGreaterThan(1));
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
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/startup")) {
        return jsonResponse(startupSnapshot({ compose: false, docker: false, lima: false }));
      }
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      if (
        url.endsWith("/api/startup/prerequisites/docker-with-compose/install") &&
        init?.method === "POST"
      ) {
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
    releaseRefresh?.(jsonResponse(snapshot));
    expect(await screen.findByRole("button", { name: "상태 새로고침" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "건너뛰기" }));
    expect(
      await screen.findByRole("heading", { name: "Lima를 설치해야 합니다.", level: 2 }),
    ).toBeInTheDocument();
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

  it("explains the first-run Lima state", async () => {
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).endsWith("/api/startup")
          ? jsonResponse(startupSnapshot())
          : jsonResponse(dashboard),
      ),
    );

    render(<App />);

    expect(await screen.findByRole("heading", { name: "컨테이너", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Docker Engine 설정" })).toBeEnabled();
    expect(screen.getByText("Lima 환경을 먼저 만드십시오.")).toBeInTheDocument();
  });

  it("configures the first Docker Engine from the settings subnavigation", async () => {
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
      if (url.endsWith("/api/runtime/configuration")) return jsonResponse(dockerEngineSnapshot());
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      if (url.endsWith("/api/runtime/start") && init?.method === "POST") {
        return jsonResponse({ operation: accepted }, 202);
      }
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    await screen.findByRole("heading", { name: "컨테이너", level: 1 });

    await user.click(screen.getByRole("link", { name: "설정" }));

    expect(await screen.findByRole("heading", { name: "설정", level: 1 })).toBeInTheDocument();
    const settingsNavigation = await screen.findByRole("navigation", { name: "설정 상세 메뉴" });
    const dockerEngine = within(settingsNavigation).getByRole("group", {
      name: "Docker Engine",
    });
    expect(within(dockerEngine).getByRole("button", { name: "엔진 설정" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await screen.findByLabelText("CPU")).toHaveValue("4");
    expect(screen.getByLabelText("메모리")).toHaveValue("4");
    expect(screen.getByLabelText("디스크")).toHaveValue("100");

    await user.click(within(dockerEngine).getByRole("button", { name: "실행 환경" }));
    expect(screen.getByRole("heading", { name: "실행 환경", level: 2 })).toBeInTheDocument();
    expect(within(dockerEngine).getByRole("button", { name: "실행 환경" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("QEMU가 설치되지 않았습니다. brew install qemu")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "VM 드라이버" }));
    expect(await screen.findByRole("option", { name: /QEMU/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "엔진 설정에서 적용" }));
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
  });

  it("requires typing overseer before recreating the single VM", async () => {
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
        { createdSince: "today", id: "image-id", repository: "nginx", size: "20MB", tag: "alpine" },
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
      kind: "runtime.recreate",
      successMessage: "Docker Engine을 재생성했습니다.",
      target: { name: "overseer", resource: "runtime" },
      title: "Docker Engine 재생성",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/runtime/configuration")) {
        return jsonResponse(dockerEngineSnapshot("instance", true));
      }
      if (url.endsWith("/api/operations")) return jsonResponse({ operations: [] });
      if (url.endsWith("/api/runtime/recreate") && init?.method === "POST") {
        return jsonResponse({ operation: accepted }, 202);
      }
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/settings");
    render(<App />);
    await screen.findByRole("button", { name: "Docker Engine 재생성" });

    await user.click(screen.getByRole("button", { name: "Docker Engine 재생성" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Docker Engine을 재생성하시겠습니까?",
    });
    expect(dialog).toHaveTextContent("컨테이너 1개");
    expect(dialog).toHaveTextContent("이미지 1개");
    expect(dialog).toHaveTextContent("볼륨 1개");
    expect(dialog).toHaveTextContent("사용자 네트워크 1개");
    expect(dialog).toHaveTextContent("호스트 SQLite의 Compose 등록 정보와 작업 기록은 유지됩니다.");
    const destructive = within(dialog).getByRole("button", { name: "Docker Engine 재생성" });
    expect(destructive).toBeDisabled();

    await user.type(within(dialog).getByLabelText("확인을 위해 overseer 입력"), "overseer");
    expect(destructive).toBeEnabled();
    await user.click(destructive);

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/runtime/recreate") && init?.method === "POST",
        ),
      ).toBe(true),
    );
    const recreateCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith("/api/runtime/recreate"),
    );
    expect(JSON.parse(String(recreateCall?.[1]?.body))).toEqual({
      configuration: dockerEngineSnapshot("instance", true).configuration,
      confirmation: "overseer",
    });
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
    expect(screen.getByText(/Docker 29\.7\.2/)).toBeInTheDocument();
  });

  it("shows the expanded City DS container configuration sections", async () => {
    const user = userEvent.setup();
    const dashboard: DashboardSnapshot = {
      composeProjects: [],
      containers: [],
      images: [
        { createdSince: "today", id: "image-id", repository: "nginx", size: "20MB", tag: "alpine" },
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

    await user.click(screen.getByRole("button", { name: "설정" }));
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

    await user.click(screen.getByRole("button", { name: /^작업/ }));
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
    const history = [
      operation("queued", { id: "queued-id", title: "대기 작업" }),
      operation("running", { id: "running-id", step: "실행 중", title: "진행 작업" }),
      operation("failed", {
        error: { code: "docker_command_failed", message: "포트 충돌" },
        finishedAt: "2026-08-23T10:00:03.000Z",
        id: "failed-id",
        output: ["docker output"],
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
      return jsonResponse(dashboard);
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/containers");
    render(<App />);
    await screen.findByText("컨테이너가 없습니다.");

    await user.click(screen.getByRole("button", { name: /^작업/ }));
    const drawer = await screen.findByRole("dialog", { name: "작업" });
    expect(within(drawer).getByText("대기 작업")).toBeInTheDocument();
    expect(within(drawer).getByText("진행 작업")).toBeInTheDocument();
    expect(within(drawer).getByText("실패 작업")).toBeInTheDocument();
    expect(within(drawer).queryByText("완료 작업")).not.toBeInTheDocument();
    expect(within(drawer).queryByText("취소 작업")).not.toBeInTheDocument();

    await user.click(within(drawer).getByRole("button", { name: "전체 작업 보기" }));
    expect(await screen.findByRole("heading", { name: "작업 기록", level: 1 })).toBeInTheDocument();
    expect(await screen.findByRole("table", { name: "전체 작업 히스토리" })).toBeInTheDocument();
    expect(screen.getByText("완료 작업")).toBeInTheDocument();
    expect(screen.getByText("취소 작업")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/operations");

    const failedRow = screen.getByRole("row", { name: /실패 작업/ });
    await user.click(within(failedRow).getByRole("button", { name: "상세" }));
    const detail = await screen.findByRole("dialog", { name: "실패 작업" });
    expect(detail).toHaveTextContent("포트 충돌");
    expect(detail).toHaveTextContent("docker output");
    await user.click(within(detail).getByRole("button", { name: "닫기" }));

    await user.click(within(failedRow).getByRole("button", { name: "재시도" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            String(input).endsWith("/api/operations/failed-id/retry") && init?.method === "POST",
        ),
      ).toBe(true),
    );
  });

  it("groups desktop navigation by workload, resource, operations, and system", async () => {
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
    const system = within(navigation).getByRole("group", { name: "시스템" });
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
    expect(within(system).getByRole("link", { name: "설정" })).toHaveAttribute("href", "/settings");
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
    expect(await screen.findByText("first line")).toBeInTheDocument();
    expect(document.querySelectorAll(".overseer-terminal-lines li")).toHaveLength(2);
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

  it("navigates from the container list to the container detail page", async () => {
    const user = userEvent.setup();
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
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("/api/containers/container-id")
          ? jsonResponse({
              container: {
                configHash: "a".repeat(64),
                id: "container-id",
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
            })
          : jsonResponse(dashboard),
      ),
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
    expect(screen.getByText("sleep 600")).toBeInTheDocument();

    await user.click(within(containerGroup).getByRole("button", { name: "연결" }));
    expect(screen.getByText("bridge")).toBeInTheDocument();

    await user.click(within(containerGroup).getByRole("button", { name: "환경 변수" }));
    expect(screen.getByText("MODE")).toBeInTheDocument();

    await user.click(within(containerGroup).getByRole("button", { name: "Label" }));
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
    expect(screen.getByRole("row", { name: /demo-stack/ })).toBeInTheDocument();
    expect(screen.getByText("1개 실행 중")).toBeInTheDocument();

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
    expect(await screen.findByText("web | ready")).toBeInTheDocument();

    await user.click(within(composeGroup).getByRole("button", { name: "서비스" }));
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
    await user.click(within(dialog).getByRole("button", { name: "network 추가" }));
    await user.type(
      within(dialog).getByRole("textbox", { name: "Compose network 이름 1" }),
      "frontend",
    );
    await user.click(within(dialog).getByRole("button", { name: "volume 추가" }));
    await user.type(
      within(dialog).getByRole("textbox", { name: "Compose volume 이름 1" }),
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
    await user.click(await screen.findByRole("button", { name: "폼 관리" }));
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
    expect(
      screen.getByText("URL 등록", { selector: ".overseer-primary-meta" }),
    ).toBeInTheDocument();
    expect(screen.getByText("build context")).toBeInTheDocument();
    expect(screen.getByText("업데이트 있음")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "URL 관리" }));
    await user.click(await screen.findByRole("menuitem", { name: "등록 해제" }));
    expect(
      await screen.findByRole("alertdialog", { name: "URL Compose 등록을 해제하시겠습니까?" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "취소" }));

    await user.click(await screen.findByRole("button", { name: "URL 관리" }));
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
          createdSince: "today",
          id: "image-id",
          repository: "nginx",
          size: "20MB",
          tag: "alpine",
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

    await user.click(screen.getByRole("link", { name: "Compose" }));
    expect(screen.getByText("1개 생성됨")).toBeInTheDocument();
    expect(
      screen.getByText("URL 등록", { selector: ".overseer-primary-meta" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("최신")).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "이미지" }));
    expect(screen.getByText("alpine").tagName).toBe("CODE");

    await user.click(screen.getByRole("link", { name: "네트워크" }));
    expect(screen.getByText("Docker 기본 네트워크")).toHaveClass("overseer-primary-meta");
  });

  it("renders volumes and networks as direct pages", async () => {
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
      volumes: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(dashboard)),
    );

    window.history.replaceState(null, "", "/volumes");
    render(<App />);

    expect(await screen.findByText("볼륨이 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "볼륨", level: 1 })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "네트워크" }));

    expect(screen.getByRole("heading", { name: "네트워크", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /bridge/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "bridge 네트워크 삭제" })).toHaveAttribute(
      "data-city-icon-only",
      "",
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
