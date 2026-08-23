import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/client/app.tsx";
import { emptyContainerSpec } from "../src/shared/container-spec.ts";
import type { DashboardSnapshot, OperationSnapshot } from "../src/shared/contracts.ts";

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
    status,
    step: status === "succeeded" ? "완료됨" : "대기 중",
    successMessage: "app-data 볼륨을 만들었습니다.",
    target: { name: "app-data", resource: "volume" },
    title: "볼륨 만들기",
    ...overrides,
  };
}

describe("App", () => {
  it("matches the loading skeleton to the page shell and table", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    const { container } = render(<App />);

    expect(container.querySelectorAll(".overseer-loading-nav-item")).toHaveLength(5);
    expect(container.querySelector(".overseer-loading-table")).toBeInTheDocument();
    expect(container.querySelector(".overseer-stat-grid")).not.toBeInTheDocument();
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
      vi.fn(async () => jsonResponse(dashboard)),
    );

    render(<App />);

    expect(await screen.findByRole("heading", { name: "컨테이너", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lima 환경 만들기" })).toBeEnabled();
    expect(screen.getByText("Lima 환경을 먼저 만드십시오.")).toBeInTheDocument();
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
    expect(screen.getByText("작업 기록이 없습니다.")).toBeInTheDocument();
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
    expect(await screen.findByText("취소됨")).toBeInTheDocument();
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
        String(input).includes("/api/compose/projects/demo-stack")
          ? jsonResponse({
              project: {
                configFiles: ["/workspace/compose.yaml"],
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
            })
          : jsonResponse(dashboard),
      ),
    );
    window.history.replaceState(null, "", "/compose");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Compose", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /demo-stack/ })).toBeInTheDocument();
    expect(screen.getByText("1개 실행 중")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "demo-stack 서비스 보기" }));

    expect(await screen.findByRole("heading", { name: "demo-stack 서비스" })).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /demo-stack-web-1/ })).toBeInTheDocument();
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
