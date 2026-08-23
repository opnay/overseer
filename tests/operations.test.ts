import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteOperationHistoryStore } from "../src/server/operation-history.ts";
import { OperationQueue, type OperationProgress } from "../src/server/operations.ts";

const temporaryDirectories: string[] = [];

async function historyStore() {
  const directory = await mkdtemp(join(tmpdir(), "overseer-operation-history-test-"));
  temporaryDirectories.push(directory);
  return new SqliteOperationHistoryStore({
    dataDirectory: directory,
    databasePath: join(directory, "overseer.sqlite"),
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

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

  it("keeps all completed history instead of trimming old records", async () => {
    const queue = new OperationQueue(8);
    for (let index = 0; index < 120; index += 1) {
      queue.enqueue(operation(async () => undefined, [`container:${index}`]));
    }
    await vi.waitFor(() =>
      expect(queue.list().filter(({ status }) => status === "succeeded")).toHaveLength(120),
    );
    expect(queue.list()).toHaveLength(120);
  });

  it("persists failed history and retry metadata across queue instances", async () => {
    const store = await historyStore();
    const queue = new OperationQueue(3, store);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const accepted = queue.enqueue({
      ...operation(async () => {
        throw new Error("failed");
      }),
      retryRequest: { method: "POST", path: "/containers/web/actions/start" },
    });
    await vi.waitFor(() => expect(queue.get(accepted.id)?.status).toBe("failed"));
    store.close();

    const reopenedStore = new SqliteOperationHistoryStore({
      dataDirectory: store.dataDirectory,
      databasePath: join(store.dataDirectory, "overseer.sqlite"),
    });
    const reopenedQueue = new OperationQueue(3, reopenedStore);
    expect(reopenedQueue.get(accepted.id)).toMatchObject({
      id: accepted.id,
      retryable: true,
      status: "failed",
    });
    expect(reopenedQueue.getRetryRequest(accepted.id)).toEqual({
      method: "POST",
      path: "/containers/web/actions/start",
    });
    reopenedStore.close();
  });

  it("recovers queued and running records as retryable failures after restart", async () => {
    const store = await historyStore();
    const queue = new OperationQueue(1, store);
    const running = deferred();
    const accepted = queue.enqueue({
      ...operation(() => running.promise),
      retryRequest: { method: "POST", path: "/containers/web/actions/start" },
    });
    await vi.waitFor(() => expect(queue.get(accepted.id)?.status).toBe("running"));
    store.close();

    const reopenedStore = new SqliteOperationHistoryStore({
      dataDirectory: store.dataDirectory,
      databasePath: join(store.dataDirectory, "overseer.sqlite"),
    });
    const recovered = new OperationQueue(1, reopenedStore).get(accepted.id);
    expect(recovered).toMatchObject({
      error: { code: "operation_interrupted" },
      retryable: true,
      status: "failed",
      step: "서버 재시작으로 중단됨",
    });
    reopenedStore.close();
  });
});
