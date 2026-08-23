import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/client/app.tsx";
import type { DashboardSnapshot } from "../src/shared/contracts.ts";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
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
    const primaryAction = screen.getByRole("button", { name: "컨테이너 실행" });
    const pageHeader = screen
      .getByRole("heading", { name: "컨테이너", level: 1 })
      .closest(".overseer-page-header");
    expect(primaryAction).toBeEnabled();
    expect(pageHeader).toContainElement(primaryAction);
    expect(screen.getByText(/Docker 29\.7\.2/)).toBeInTheDocument();
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
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "POST" ? jsonResponse({ ok: true }, 201) : jsonResponse(dashboard),
      ),
    );
    window.history.replaceState(null, "", "/volumes");
    render(<App />);
    await screen.findByText("볼륨이 없습니다.");

    await user.click(screen.getByRole("button", { name: "볼륨 만들기" }));
    await user.type(screen.getByRole("textbox", { name: "이름" }), "app-data");
    await user.click(screen.getByRole("button", { name: "볼륨 만들기" }));

    expect(await screen.findByRole("dialog", { name: "작업을 완료했습니다." })).toHaveTextContent(
      "app-data 볼륨을 만들었습니다.",
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
