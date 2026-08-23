import { describe, expect, it, vi } from "vitest";
import { OperationQueue, type OperationProgress } from "../src/server/operations.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

function operation(run: (progress: OperationProgress) => Promise<void>, locks: string[] = []) {
  return {
    kind: "container.start" as const,
    locks,
    run,
    successMessage: "완료",
    target: { name: "web", resource: "container" as const },
    title: "시작",
  };
}

describe("OperationQueue", () => {
  it("runs unrelated jobs concurrently and serializes the same resource", async () => {
    const queue = new OperationQueue(3);
    const first = deferred();
    const second = deferred();
    const third = deferred();
    const firstRun = vi.fn(() => first.promise);
    const secondRun = vi.fn(() => second.promise);
    const thirdRun = vi.fn(() => third.promise);

    queue.enqueue(operation(firstRun, ["container:web"]));
    queue.enqueue(operation(secondRun, ["container:web"]));
    queue.enqueue(operation(thirdRun, ["container:api"]));

    await vi.waitFor(() => {
      expect(firstRun).toHaveBeenCalledTimes(1);
      expect(thirdRun).toHaveBeenCalledTimes(1);
    });
    expect(secondRun).not.toHaveBeenCalled();
    first.resolve();
    await vi.waitFor(() => expect(secondRun).toHaveBeenCalledTimes(1));
    second.resolve();
    third.resolve();
  });

  it("cancels only queued jobs", async () => {
    const queue = new OperationQueue(1);
    const running = deferred();
    const first = queue.enqueue(operation(() => running.promise, ["container:web"]));
    const second = queue.enqueue(operation(async () => undefined, ["container:api"]));

    await vi.waitFor(() => expect(queue.get(first.id)?.status).toBe("running"));
    expect(queue.cancel(second.id).status).toBe("cancelled");
    expect(() => queue.cancel(first.id)).toThrow("대기 중인 작업만");
    running.resolve();
  });

  it("waits for running work before an exclusive job and does not bypass it", async () => {
    const queue = new OperationQueue(3);
    const running = deferred();
    const exclusive = deferred();
    const later = deferred();
    const exclusiveRun = vi.fn(() => exclusive.promise);
    const laterRun = vi.fn(() => later.promise);
    queue.enqueue(operation(() => running.promise, ["container:web"]));
    queue.enqueue({ ...operation(exclusiveRun), exclusive: true });
    queue.enqueue(operation(laterRun, ["container:api"]));

    await vi.waitFor(() =>
      expect(queue.list().some(({ status }) => status === "running")).toBe(true),
    );
    expect(exclusiveRun).not.toHaveBeenCalled();
    expect(laterRun).not.toHaveBeenCalled();
    running.resolve();
    await vi.waitFor(() => expect(exclusiveRun).toHaveBeenCalledTimes(1));
    expect(laterRun).not.toHaveBeenCalled();
    exclusive.resolve();
    await vi.waitFor(() => expect(laterRun).toHaveBeenCalledTimes(1));
    later.resolve();
  });

  it("retains bounded sanitized output and an expected failure", async () => {
    const queue = new OperationQueue();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const snapshot = queue.enqueue(
      operation(async (progress) => {
        for (let index = 0; index < 120; index += 1)
          progress.output(`\u001b[31mline ${index}\u001b[0m\n`);
        throw new Error("boom");
      }),
    );

    await vi.waitFor(() => expect(queue.get(snapshot.id)?.status).toBe("failed"));
    const failed = queue.get(snapshot.id);
    expect(failed?.output).toHaveLength(100);
    expect(failed?.output[0]).toBe("line 20");
    expect(failed?.error?.code).toBe("operation_failed");
  });
});
