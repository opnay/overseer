import { render, screen, waitFor } from "@testing-library/react";
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
  it("explains the first-run Lima state", async () => {
    const dashboard: DashboardSnapshot = {
      containers: [],
      images: [],
      runtime: {
        instance: "overseer",
        message: "전용 Lima 인스턴스가 아직 없습니다.",
        phase: "missing",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(dashboard)),
    );

    render(<App />);

    expect(await screen.findByRole("heading", { name: "로컬 컨테이너" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lima 환경 만들기" })).toBeEnabled();
    expect(screen.getByText("Lima 환경을 먼저 만드십시오.")).toBeInTheDocument();
  });

  it("shows the running empty state and primary actions", async () => {
    const dashboard: DashboardSnapshot = {
      containers: [],
      images: [],
      runtime: {
        dockerVersion: "29.7.2",
        instance: "overseer",
        message: "Lima와 Docker가 정상적으로 실행 중입니다.",
        phase: "running",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(dashboard)),
    );

    render(<App />);

    expect(await screen.findByText("컨테이너가 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "컨테이너 실행" })).toBeEnabled();
    expect(screen.getByText(/Docker 29\.7\.2/)).toBeInTheDocument();
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
  });
});
