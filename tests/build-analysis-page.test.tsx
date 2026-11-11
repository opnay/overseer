import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BuildDetailResponse,
  BuildStep,
  BuildStepsResponse,
  RelatedBuildsResponse,
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

function buildDetail(id: string, status: "failed" | "succeeded" = "failed"): BuildDetailResponse {
  return {
    build: {
      context: "/repo",
      dockerfile: "Dockerfile",
      durationMs: 4_000,
      error: status === "failed" ? "build failed" : undefined,
      id,
      materials: [],
      name: id,
      outputs: [],
      platforms: ["linux/arm64"],
      repository: "https://example.test/repo",
      startedAt: "2026-11-11T00:00:00.000Z",
      status,
      target: "release",
    },
    instance: INSTANCE,
  };
}

function step(id: string, fields: Partial<BuildStep> = {}): BuildStep {
  return {
    cached: false,
    id,
    log: "",
    logTruncated: false,
    name: id,
    status: "succeeded",
    ...fields,
  };
}

function stepsResponse(buildId: string, steps: BuildStep[]): BuildStepsResponse {
  return { buildId, instance: INSTANCE, steps };
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

function TestRoutes() {
  const navigate = useNavigate();
  return (
    <>
      <LocationOutput />
      <button onClick={() => navigate(`/builds/second?instance=${INSTANCE}`)} type="button">
        test-route-second
      </button>
      <button
        onClick={() => navigate(`/builds/other?instance=${INSTANCE}&section=related`)}
        type="button"
      >
        test-route-related
      </button>
      <Routes>
        <Route
          element={<BuildsWorkspace instance={INSTANCE} refreshToken="0" />}
          path="/builds/:id"
        />
      </Routes>
    </>
  );
}

function testApp(initialEntry: string) {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <TestRoutes />
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

describe("build analysis detail sections", () => {
  it("loads steps lazily, jumps from the overview failure, and shows output, cache, and unknown duration", async () => {
    const user = userEvent.setup();
    const failed = step("failed-step", {
      error: "compiler returned exit 1",
      log: "line one\nline two",
      logTruncated: true,
      status: "failed",
    });
    const cached = step("cached-step", { cached: true, durationMs: 350, log: "cache output" });
    const fetchMock = installFetch((url) => {
      if (url.pathname === "/api/builds/build-a") return jsonResponse(buildDetail("build-a"));
      if (url.pathname === "/api/builds/build-a/steps") {
        return jsonResponse(stepsResponse("build-a", [cached, failed]));
      }
      throw new Error(`unexpected request: ${url.pathname}`);
    });

    render(testApp("/builds/build-a?instance=engine-a"));
    expect(await screen.findByText("build failed")).toBeInTheDocument();
    expect(requestUrls(fetchMock).some((url) => url.pathname.endsWith("/steps"))).toBe(false);

    await user.click(screen.getByRole("button", { name: "실패 단계 확인" }));
    expect(await screen.findByRole("heading", { name: "실패한 단계 1개" })).toBeInTheDocument();
    const stepRequest = await waitFor(() => {
      const request = requestUrls(fetchMock).find((url) => url.pathname.endsWith("/steps"));
      expect(request).toBeDefined();
      return request as URL;
    });
    expect(stepRequest.searchParams.get("instance")).toBe(INSTANCE);

    await user.click(screen.getByRole("button", { name: "failed-step 보기" }));
    expect(await screen.findByText("compiler returned exit 1")).toBeInTheDocument();
    expect(
      screen.getByLabelText("failed-step 단계 출력").querySelector("pre code")?.textContent,
    ).toBe("line one\nline two");
    expect(screen.getByText("표시 길이 제한으로 출력의 일부만 보여줍니다.")).toBeInTheDocument();
    expect(
      screen.getByRole("meter", { name: "cached-step 단계 상대 소요 시간" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /cached-step/ })).toHaveTextContent("350ms");

    const failedRow = screen.getAllByRole("row", { name: /failed-step/ })[0];
    expect(failedRow).toHaveTextContent("—");
    expect(
      screen.getByText(/캐시 단계 수는 절약된 시간으로 환산하지 않습니다/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "단계 필터" }));
    await user.click(await screen.findByRole("option", { name: "캐시 단계" }));
    expect(screen.getByRole("row", { name: /cached-step/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /failed-step/ })).not.toBeInTheDocument();
  });

  it("shows prior builds and preserves instance plus list filters in their links", async () => {
    const user = userEvent.setup();
    const related: RelatedBuildsResponse = {
      buildId: "build-a",
      candidateCount: 5,
      failedCount: 1,
      instance: INSTANCE,
      limited: true,
      matchAvailable: true,
      records: [
        {
          cachedSteps: 4,
          completedAt: "2026-11-10T00:00:05.000Z",
          durationMs: 5_000,
          id: "build-old",
          name: "previous release",
          startedAt: "2026-11-10T00:00:00.000Z",
          status: "succeeded",
        },
      ],
      scannedCount: 3,
    };
    const fetchMock = installFetch((url) => {
      if (url.pathname === "/api/builds/build-a") return jsonResponse(buildDetail("build-a"));
      if (url.pathname === "/api/builds/build-a/related") return jsonResponse(related);
      if (url.pathname === "/api/builds/build-old") {
        return jsonResponse(buildDetail("build-old", "succeeded"));
      }
      throw new Error(`unexpected request: ${url.pathname}`);
    });

    render(
      testApp(
        "/builds/build-a?instance=engine-a&filter%5Bname%5D=release&filter%5Bstatus%5D=failed&page=3&section=related",
      ),
    );

    expect(await screen.findByRole("link", { name: "previous release" })).toBeInTheDocument();
    expect(screen.getByText(/후보 5개 중 3개를 확인했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/조회 한도로 일부 후보를 건너뛰었습니다/)).toBeInTheDocument();
    expect(screen.getByText("4개")).toBeInTheDocument();
    const relatedRequest = requestUrls(fetchMock).find((url) => url.pathname.endsWith("/related"));
    expect(relatedRequest?.searchParams.get("instance")).toBe(INSTANCE);

    await user.click(screen.getByRole("link", { name: "previous release" }));
    await waitFor(() => {
      const location = new URL(
        screen.getByTestId("location").textContent ?? "",
        "http://overseer.local",
      );
      expect(location.pathname).toBe("/builds/build-old");
      expect(location.searchParams.get("instance")).toBe(INSTANCE);
      expect(location.searchParams.get("filter[name]")).toBe("release");
      expect(location.searchParams.get("filter[status]")).toBe("failed");
      expect(location.searchParams.get("page")).toBe("3");
    });
  });

  it("distinguishes unavailable comparison inputs from an empty matching history", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch((url) => {
      if (url.pathname === "/api/builds/build-a") return jsonResponse(buildDetail("build-a"));
      if (url.pathname === "/api/builds/other")
        return jsonResponse(buildDetail("other", "succeeded"));
      if (url.pathname === "/api/builds/build-a/related") {
        return jsonResponse({
          buildId: "build-a",
          candidateCount: 0,
          failedCount: 0,
          instance: INSTANCE,
          limited: false,
          matchAvailable: false,
          records: [],
          scannedCount: 0,
        } satisfies RelatedBuildsResponse);
      }
      if (url.pathname === "/api/builds/other/related") {
        return jsonResponse({
          buildId: "other",
          candidateCount: 0,
          failedCount: 0,
          instance: INSTANCE,
          limited: false,
          matchAvailable: true,
          records: [],
          scannedCount: 0,
        } satisfies RelatedBuildsResponse);
      }
      throw new Error(`unexpected request: ${url.pathname}`);
    });

    render(testApp("/builds/build-a?instance=engine-a&section=related"));
    expect(await screen.findByText(/비교에 필요한 .*기록이 부족합니다/)).toBeInTheDocument();
    expect(screen.queryByText("일치하는 이전 빌드가 없습니다.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "test-route-related" }));
    expect(await screen.findByText("일치하는 이전 빌드가 없습니다.")).toBeInTheDocument();
    expect(screen.queryByText(/비교에 필요한 .*기록이 부족합니다/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("ignores a late step response after the selected build changes", async () => {
    const user = userEvent.setup();
    const staleResponse = deferred<Response>();
    let firstStepRequest = true;
    const fetchMock = installFetch((url) => {
      if (url.pathname === "/api/builds/first") return jsonResponse(buildDetail("first"));
      if (url.pathname === "/api/builds/second") return jsonResponse(buildDetail("second"));
      if (url.pathname === "/api/builds/first/steps" && firstStepRequest) {
        firstStepRequest = false;
        return staleResponse.promise;
      }
      if (url.pathname === "/api/builds/second/steps") {
        return jsonResponse(
          stepsResponse("second", [step("current-step", { log: "current output" })]),
        );
      }
      throw new Error(`unexpected request: ${url.pathname}`);
    });

    render(testApp("/builds/first?instance=engine-a"));
    await screen.findByText("first");
    await user.click(screen.getByRole("link", { name: "단계·분석" }));
    await waitFor(() =>
      expect(requestUrls(fetchMock).some((url) => url.pathname === "/api/builds/first/steps")).toBe(
        true,
      ),
    );

    await user.click(screen.getByRole("button", { name: "test-route-second" }));
    await screen.findByText("second");
    await user.click(screen.getByRole("link", { name: "단계·분석" }));
    expect(await screen.findByRole("row", { name: /current-step/ })).toBeInTheDocument();

    staleResponse.resolve(
      jsonResponse(stepsResponse("first", [step("stale-step", { log: "stale output" })])),
    );
    await waitFor(() => expect(screen.queryByText("stale-step")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "current-step 출력 펼치기" }));
    expect(
      screen.getByLabelText("current-step 단계 출력").querySelector("pre code"),
    ).toHaveTextContent("current output");
  });
});
