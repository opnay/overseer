import { describe, expect, it, vi } from "vitest";
import { scheduleMacOSHostGatewayMigrations } from "../src/server/app/runtime-migrations.ts";
import { LimaDockerRuntime } from "../src/server/infrastructure/lima/lima-docker-runtime.ts";
import { OperationQueue } from "../src/server/modules/operations/index.ts";

describe("startup host-gateway migration scheduling", () => {
  it("records one migration per pending VM and records a failure without blocking startup", async () => {
    const runtime = new LimaDockerRuntime();
    vi.spyOn(runtime, "pendingMacOSHostGatewayMigrations").mockResolvedValue(["overseer", "dev"]);
    vi.spyOn(runtime, "migrateMacOSHostGateway").mockImplementation(async (name) => {
      if (name === "dev") throw Error("migration unavailable");
    });
    const operations = new OperationQueue();
    await scheduleMacOSHostGatewayMigrations(runtime, operations);
    await vi.waitFor(() =>
      expect(operations.list().every(({ finishedAt }) => Boolean(finishedAt))).toBe(true),
    );
    expect(operations.list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime.daemon.configure",
          status: "succeeded",
          target: { name: "overseer", resource: "runtime" },
        }),
        expect.objectContaining({
          kind: "runtime.daemon.configure",
          status: "failed",
          target: { name: "dev", resource: "runtime" },
        }),
      ]),
    );
  });
  it("does not add a migration record when no VM needs migration", async () => {
    const runtime = new LimaDockerRuntime();
    vi.spyOn(runtime, "pendingMacOSHostGatewayMigrations").mockResolvedValue([]);
    const operations = new OperationQueue();
    await scheduleMacOSHostGatewayMigrations(runtime, operations);
    expect(operations.list()).toEqual([]);
  });
});
