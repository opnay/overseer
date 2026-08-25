import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { forwardDesktopApiRequest } from "../src/server/desktop-api.ts";
import { requireLocalRequest } from "../src/server/security.ts";

function testApi() {
  const api = new Hono();
  api.use("*", requireLocalRequest);
  api.get("/status", (context) => context.json({ ok: true }));
  api.post("/echo", async (context) => context.json(await context.req.json()));
  return api;
}

describe("desktop API bridge", () => {
  it("forwards a local GET request", async () => {
    const response = await forwardDesktopApiRequest(testApi(), {
      id: 1,
      method: "GET",
      path: "/status",
    });

    expect(response).toEqual({ body: JSON.stringify({ ok: true }), id: 1, status: 200 });
  });

  it("forwards a JSON mutation with a local origin", async () => {
    const response = await forwardDesktopApiRequest(testApi(), {
      body: JSON.stringify({ name: "overseer" }),
      id: 2,
      method: "POST",
      path: "/echo",
    });

    expect(response).toEqual({
      body: JSON.stringify({ name: "overseer" }),
      id: 2,
      status: 200,
    });
  });

  it("rejects an authority-style path", async () => {
    await expect(
      forwardDesktopApiRequest(testApi(), {
        id: 3,
        method: "GET",
        path: "//example.com/status",
      }),
    ).rejects.toThrow("API 경로를 확인하십시오.");
  });
});
