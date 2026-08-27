import { beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => tauri);

import { apiRequest } from "../src/client/shared/api/api-request.ts";

describe("apiRequest", () => {
  beforeEach(() => {
    tauri.invoke.mockReset();
    tauri.isTauri.mockReset();
    tauri.isTauri.mockReturnValue(true);
  });

  it("stops waiting for a Tauri request when its signal is aborted", async () => {
    tauri.invoke.mockReturnValue(new Promise(() => undefined));
    const controller = new AbortController();
    const request = apiRequest("/runtime/engine/configuration", {
      signal: controller.signal,
    });

    controller.abort(new DOMException("요청 시간이 초과되었습니다.", "TimeoutError"));

    await expect(request).rejects.toMatchObject({ name: "TimeoutError" });
    expect(tauri.invoke).toHaveBeenCalledWith("api_request", {
      body: undefined,
      method: "GET",
      path: "/runtime/engine/configuration",
    });
  });

  it("returns a completed Tauri response when the signal is active", async () => {
    tauri.invoke.mockResolvedValue([200, '{"available":true}']);

    await expect(
      apiRequest<{ available: boolean }>("/runtime/engine/configuration", {
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ available: true });
  });
});
