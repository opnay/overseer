import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BuildDetailResponse,
  BuildHistory,
  BuildRecord,
  BuildStatus,
} from "../src/shared/builds.ts";
import { BuildsWorkspace } from "../src/client/pages/builds/index.ts";

const INSTANCE = "engine-a";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function installFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(new URL(String(input), "http://overseer.local"), init)),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestUrls(fetchMock: ReturnType<typeof installFetch>): URL[] {
  return fetchMock.mock.calls.map(([input]) => new URL(String(input), "http://overseer.local"));
}

function historyRecord(id: string, name: string, status: BuildStatus): BuildRecord {
  return {
    cachedSteps: 3,
    completedAt: "2026-11-11T00:00:10.000Z",
    completedSteps: 6,
    id,
    name,
    startedAt: "2026-11-11T00:00:00.000Z",
    status,
    totalSteps: 6,
  };
}

function buildHistory(
  page: number,
  records: BuildRecord[] = [historyRecord("build-1", "sample build", "succeeded")],
  count = records.length,
): BuildHistory {
  return {
    builder: "default",
    count,
    instance: INSTANCE,
    page,
    pageSize: 20,
    records,
  };
}

function buildDetail(
  id: string,
  name: string,
  status: BuildStatus = "succeeded",
  error?: string,
): BuildDetailResponse {
  return {
    build: {
      cachedSteps: 3,
      completedAt: status === "running" ? undefined : "2026-11-11T00:00:10.000Z",
      completedSteps: status === "running" ? 4 : 6,
      context: "/workspace/app",
      dockerfile: "Dockerfile.release",
      durationMs: 10_000,
      error,
      id,
      materials: [{ digest: "sha256:material", uri: "git+https://example.test/repository" }],
      name,
      outputs: [
        {
          digest: "sha256:attachment",
          platform: "linux/arm64",
          type: "image",
        },
      ],
      platforms: ["linux/arm64"],
      repository: "https://example.test/repository",
      revision: "abc123",
      startedAt: "2026-11-11T00:00:00.000Z",
      status,
      target: "release",
      totalSteps: 6,
    },
    instance: INSTANCE,
  };
}

function LocationOutput() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}

function TestRoutes({
  activeInstance = INSTANCE,
  refreshToken = "0",
}: {
  activeInstance?: string;
  refreshToken?: string;
}) {
  const navigate = useNavigate();
  return (
    <>
      <LocationOutput />
      <button onClick={() => navigate(`/builds/second?instance=${INSTANCE}`)} type="button">
        test-route-second
      </button>
      <Routes>
        <Route
          element={<BuildsWorkspace instance={activeInstance} refreshToken={refreshToken} />}
          path="/builds"
        />
        <Route
          element={<BuildsWorkspace instance={activeInstance} refreshToken={refreshToken} />}
          path="/builds/:id"
        />
      </Routes>
    </>
  );
}

function testApp(initialEntry: string, activeInstance = INSTANCE, refreshToken = "0") {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <TestRoutes activeInstance={activeInstance} refreshToken={refreshToken} />
    </MemoryRouter>
  );
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BuildsWorkspace", () => {
  it("keeps list filters in the URL, sends the active instance, and returns without section state", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch((url) => {
      if (url.pathname === "/api/builds") {
        const page = Number(url.searchParams.get("page"));
        const name = url.searchParams.get("filter[name]") ?? "old";
        const status = (url.searchParams.get("filter[status]") ?? "failed") as BuildStatus;
        return jsonResponse(buildHistory(page, [historyRecord("build-1", name, status)], 41));
      }
      if (url.pathname === "/api/builds/build-1/logs") {
        return jsonResponse({ instance: INSTANCE, logs: { text: "" } });
      }
      if (url.pathname === "/api/builds/build-1") {
        return jsonResponse(buildDetail("build-1", "target build"));
      }
      throw new Error(`unexpected request: ${url.pathname}`);
    });

    render(testApp("/builds?page=3&filter%5Bname%5D=old&filter%5Bstatus%5D=failed&section=logs"));

    const initialListRequest = await waitFor(() => {
      const request = requestUrls(fetchMock).find((url) => url.pathname === "/api/builds");
      expect(request).toBeDefined();
      return request as URL;
    });
    expect(initialListRequest.searchParams.get("instance")).toBe(INSTANCE);
    expect(initialListRequest.searchParams.get("page")).toBe("3");
    expect(initialListRequest.searchParams.get("pageSize")).toBe("20");
    expect(initialListRequest.searchParams.get("filter[name]")).toBe("old");
    expect(initialListRequest.searchParams.get("filter[status]")).toBe("failed");
    expect(initialListRequest.searchParams.has("section")).toBe(false);
    expect(screen.getByRole("searchbox", { name: "빌드 이름 검색" })).toHaveValue("old");
    expect(await screen.findByText("10초")).toBeInTheDocument();
    expect(screen.getByText("3 / 6")).toBeInTheDocument();

    const search = screen.getByRole("searchbox", { name: "빌드 이름 검색" });
    await user.clear(search);
    await user.type(search, "target build");
    await user.click(screen.getByRole("button", { name: "검색" }));

    await waitFor(() => {
      expect(
        requestUrls(fetchMock).some(
          (url) =>
            url.pathname === "/api/builds" &&
            url.searchParams.get("page") === "1" &&
            url.searchParams.get("filter[name]") === "target build" &&
            url.searchParams.get("filter[status]") === "failed",
        ),
      ).toBe(true);
    });

    await user.click(screen.getByRole("combobox", { name: "빌드 상태" }));
    await user.click(await screen.findByRole("option", { name: "성공" }));
    await waitFor(() => {
      expect(
        requestUrls(fetchMock).some(
          (url) =>
            url.pathname === "/api/builds" &&
            url.searchParams.get("page") === "1" &&
            url.searchParams.get("filter[name]") === "target build" &&
            url.searchParams.get("filter[status]") === "succeeded",
        ),
      ).toBe(true);
    });

    await user.click(screen.getByRole("link", { name: "target build" }));
    const detailRequest = await waitFor(() => {
      const request = requestUrls(fetchMock).find((url) => url.pathname === "/api/builds/build-1");
      expect(request).toBeDefined();
      return request as URL;
    });
    expect(detailRequest.searchParams.get("instance")).toBe(INSTANCE);
    expect(detailRequest.searchParams.get("filter[name]")).toBeNull();
    expect(
      new URL(
        screen.getByTestId("location").textContent ?? "",
        "http://overseer.local",
      ).searchParams.get("filter[name]"),
    ).toBe("target build");

    await user.click(screen.getByRole("link", { name: "로그" }));
    await screen.findByText("로그가 없습니다.");
    expect(requestUrls(fetchMock).some((url) => url.pathname === "/api/builds/build-1/logs")).toBe(
      true,
    );

    await user.click(screen.getByRole("button", { name: "빌드 목록" }));
    const location = screen.getByTestId("location").textContent ?? "";
    const returnedSearch = new URL(location, "http://overseer.local").searchParams;
    expect(returnedSearch.get("filter[name]")).toBe("target build");
    expect(returnedSearch.get("filter[status]")).toBe("succeeded");
    expect(returnedSearch.get("page")).toBe("1");
    expect(returnedSearch.has("section")).toBe(false);
    expect(returnedSearch.has("instance")).toBe(false);
  });

  it("renders the allowlisted detail fields and exact error output without fetching logs early", async () => {
    const user = userEvent.setup();
    const errorOutput = "failed stderr from BuildKit\nsecond stderr line";
    const fetchMock = installFetch((url) => {
      if (url.pathname === "/api/builds/build-error") {
        return jsonResponse(buildDetail("build-error", "error build", "failed", errorOutput));
      }
      throw new Error(`unexpected request: ${url.pathname}`);
    });

    render(
      testApp("/builds/build-error?instance=engine-a&filter%5Bname%5D=error&page=2&section=inputs"),
    );

    expect(await screen.findByText("/workspace/app")).toBeInTheDocument();
    expect(screen.getByText("Dockerfile.release")).toBeInTheDocument();
    expect(screen.getByText("release")).toBeInTheDocument();
    expect(screen.getAllByText("linux/arm64")).toHaveLength(2);
    expect(screen.getByText("git+https://example.test/repository")).toBeInTheDocument();
    expect(screen.getByText("sha256:material")).toBeInTheDocument();
    expect(screen.getByText("첨부물 1")).toBeInTheDocument();
    expect(screen.getByText("sha256:attachment")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "개요" }));
    expect(screen.getByLabelText("빌드 오류 출력").querySelector("pre code")?.textContent).toBe(
      errorOutput,
    );
    expect(screen.queryByText("결과 이미지")).not.toBeInTheDocument();
    expect(requestUrls(fetchMock).some((url) => url.pathname.endsWith("/logs"))).toBe(false);
  });

  it("distinguishes an empty completed log from unsupported running logs", async () => {
    const fetchMock = installFetch((url) => {
      if (url.pathname === "/api/builds/build-empty") {
        return jsonResponse(buildDetail("build-empty", "empty log build"));
      }
      if (url.pathname === "/api/builds/build-empty/logs") {
        return jsonResponse({ instance: INSTANCE, logs: { text: "" } });
      }
      if (url.pathname === "/api/builds/build-running") {
        return jsonResponse(buildDetail("build-running", "running build", "running"));
      }
      throw new Error(`unexpected request: ${url.pathname}`);
    });

    const completedView = render(testApp("/builds/build-empty?instance=engine-a&section=logs"));
    expect(await screen.findByText("로그가 없습니다.")).toBeInTheDocument();
    expect(
      requestUrls(fetchMock).some((url) => url.pathname === "/api/builds/build-empty/logs"),
    ).toBe(true);

    completedView.unmount();
    render(testApp("/builds/build-running?instance=engine-a&section=logs"));
    expect(
      await screen.findByRole("heading", { name: "진행 중인 빌드의 로그는 지원하지 않습니다." }),
    ).toBeInTheDocument();
    expect(
      requestUrls(fetchMock).some((url) => url.pathname === "/api/builds/build-running/logs"),
    ).toBe(false);
  });

  it("links to CLI tools for Buildx errors and discards stale detail responses", async () => {
    const user = userEvent.setup();
    const firstResponse = deferred<Response>();
    const refreshResponse = deferred<Response>();
    let secondRequestCount = 0;
    const fetchMock = installFetch((url) => {
      if (url.pathname === "/api/builds") {
        return jsonResponse(
          {
            error: { code: "buildx_unavailable", message: "Buildx is not available." },
          },
          503,
        );
      }
      if (url.pathname === "/api/builds/first") return firstResponse.promise;
      if (url.pathname === "/api/builds/second") {
        secondRequestCount += 1;
        if (secondRequestCount === 1) {
          return jsonResponse(buildDetail("second", "second initial"));
        }
        if (secondRequestCount === 2) return refreshResponse.promise;
        return jsonResponse(
          { error: { code: "build_instance_changed", message: "활성 엔진이 변경되었습니다." } },
          409,
        );
      }
      throw new Error(`unexpected request: ${url.pathname}`);
    });

    const listView = render(testApp("/builds"));
    const cliToolsLink = await screen.findByRole("button", { name: "CLI 도구 열기" });
    expect(cliToolsLink).toHaveAttribute("href", "/docker-plugins");
    listView.unmount();

    const view = render(testApp("/builds/first?instance=engine-a"));
    await waitFor(() =>
      expect(requestUrls(fetchMock).some((url) => url.pathname === "/api/builds/first")).toBe(true),
    );
    await user.click(screen.getByRole("button", { name: "test-route-second" }));
    expect(await screen.findByText("second initial")).toBeInTheDocument();

    view.rerender(testApp("/builds/first?instance=engine-a", INSTANCE, "1"));
    await waitFor(() => expect(secondRequestCount).toBe(2));
    expect(screen.getByText("second initial")).toBeInTheDocument();

    firstResponse.resolve(jsonResponse(buildDetail("first", "first stale")));
    await waitFor(() => expect(screen.queryByText("first stale")).not.toBeInTheDocument());
    refreshResponse.resolve(jsonResponse(buildDetail("second", "second refreshed")));
    expect(await screen.findByText("second refreshed")).toBeInTheDocument();

    view.rerender(testApp("/builds/first?instance=engine-a", "engine-b", "2"));
    expect(screen.queryByText("second refreshed")).not.toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "활성 엔진이 변경되었습니다." }),
    ).toBeInTheDocument();
    const explicitScopeRequest = requestUrls(fetchMock).filter(
      (url) => url.pathname === "/api/builds/second",
    );
    expect(explicitScopeRequest.at(-1)?.searchParams.get("instance")).toBe(INSTANCE);
  });
});
