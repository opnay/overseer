import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import type {
  OperationKind,
  OperationSnapshot,
  OperationTarget,
} from "../../../shared/contracts.ts";
import { ExpectedError } from "../../core/errors.ts";
import type {
  OperationHistoryStore,
  OperationRetryRequest,
  PersistedOperation,
} from "./operation-history.ts";

const ESCAPED_ANSI_ESCAPE = /\\(?:x1b|u001b)/gi;

function sanitizeOperationOutputLine(value: string): string {
  return stripVTControlCharacters(value.replace(ESCAPED_ANSI_ESCAPE, "\u001b")).trimEnd();
}

export interface OperationProgress {
  output(value: string): void;
  step(value: string): void;
}

export interface EnqueueOperation {
  exclusive?: boolean;
  kind: OperationKind;
  locks: string[];
  retryRequest?: OperationRetryRequest;
  run(progress: OperationProgress): Promise<void>;
  successMessage: string;
  target: OperationTarget;
  title: string;
}

interface StoredOperation extends OperationSnapshot {
  exclusive: boolean;
  locks: string[];
  retryRequest?: OperationRetryRequest;
  run?: (progress: OperationProgress) => Promise<void>;
}

function clone(operation: StoredOperation): OperationSnapshot {
  const {
    exclusive: _exclusive,
    locks: _locks,
    retryRequest: _retryRequest,
    run: _run,
    ...snapshot
  } = operation;
  return {
    ...snapshot,
    error: snapshot.error ? { ...snapshot.error } : undefined,
    output: [...snapshot.output],
    retryable: snapshot.status === "failed" && Boolean(operation.retryRequest),
    target: { ...snapshot.target },
  };
}

function operationError(error: unknown): { code: string; message: string } {
  if (error instanceof ExpectedError) return { code: error.code, message: error.message };
  return { code: "operation_failed", message: "작업을 완료하지 못했습니다." };
}

export class OperationQueue {
  private readonly history?: OperationHistoryStore;
  private readonly maxConcurrent: number;
  private readonly operations = new Map<string, StoredOperation>();
  private readonly pending: string[] = [];
  private readonly runningLocks = new Set<string>();
  private running = 0;
  private exclusiveRunning = false;

  constructor(maxConcurrent = 3, history?: OperationHistoryStore) {
    this.maxConcurrent = maxConcurrent;
    this.history = history;
    if (history) {
      history.recoverInterrupted();
      for (const record of history.list()) {
        this.operations.set(record.snapshot.id, {
          ...record.snapshot,
          error: record.snapshot.error ? { ...record.snapshot.error } : undefined,
          exclusive: false,
          locks: [],
          output: record.snapshot.output.map(sanitizeOperationOutputLine),
          ...(record.retryRequest ? { retryRequest: record.retryRequest } : {}),
          target: { ...record.snapshot.target },
        });
      }
    }
  }

  enqueue(input: EnqueueOperation): OperationSnapshot {
    const id = randomUUID();
    const operation: StoredOperation = {
      createdAt: new Date().toISOString(),
      exclusive: input.exclusive === true,
      id,
      kind: input.kind,
      locks: [...new Set(input.locks)],
      output: [],
      ...(input.retryRequest ? { retryRequest: structuredClone(input.retryRequest) } : {}),
      retryable: false,
      run: input.run,
      status: "queued",
      step: "대기 중",
      successMessage: input.successMessage,
      target: input.target,
      title: input.title,
    };
    this.persist(operation, true);
    this.operations.set(id, operation);
    this.pending.push(id);
    queueMicrotask(() => this.drain());
    return clone(operation);
  }

  list(): OperationSnapshot[] {
    return [...this.operations.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(clone);
  }

  get(id: string): OperationSnapshot | undefined {
    const operation = this.operations.get(id);
    return operation ? clone(operation) : undefined;
  }

  getRetryRequest(id: string): OperationRetryRequest {
    const operation = this.operations.get(id);
    if (!operation) throw new ExpectedError("operation_not_found", "작업을 찾을 수 없습니다.", 404);
    if (operation.status !== "failed") {
      throw new ExpectedError(
        "operation_not_failed",
        "실패한 작업만 다시 시도할 수 있습니다.",
        409,
      );
    }
    if (!operation.retryRequest) {
      throw new ExpectedError("operation_not_retryable", "이 작업은 다시 시도할 수 없습니다.", 409);
    }
    return structuredClone(operation.retryRequest);
  }

  markRetried(id: string, sourceId: string): OperationSnapshot {
    const operation = this.operations.get(id);
    if (!operation) throw new ExpectedError("operation_not_found", "작업을 찾을 수 없습니다.", 404);
    operation.retriedFromId = sourceId;
    this.persist(operation);
    return clone(operation);
  }

  cancel(id: string): OperationSnapshot {
    const operation = this.operations.get(id);
    if (!operation) throw new ExpectedError("operation_not_found", "작업을 찾을 수 없습니다.", 404);
    if (operation.status !== "queued") {
      throw new ExpectedError("operation_not_queued", "대기 중인 작업만 취소할 수 있습니다.", 409);
    }
    const index = this.pending.indexOf(id);
    if (index >= 0) this.pending.splice(index, 1);
    operation.status = "cancelled";
    operation.step = "취소됨";
    operation.finishedAt = new Date().toISOString();
    this.persist(operation);
    queueMicrotask(() => this.drain());
    return clone(operation);
  }

  private drain(): void {
    if (this.exclusiveRunning || this.running >= this.maxConcurrent) return;

    for (let index = 0; index < this.pending.length; index += 1) {
      const id = this.pending[index];
      const operation = id ? this.operations.get(id) : undefined;
      if (!operation || operation.status !== "queued") {
        this.pending.splice(index, 1);
        index -= 1;
        continue;
      }

      if (operation.exclusive) {
        if (this.running > 0) return;
        this.pending.splice(index, 1);
        this.start(operation);
        return;
      }

      if (operation.locks.some((lock) => this.runningLocks.has(lock))) continue;
      this.pending.splice(index, 1);
      this.start(operation);
      if (this.running >= this.maxConcurrent) return;
      index -= 1;
    }
  }

  private start(operation: StoredOperation): void {
    operation.status = "running";
    operation.step = "시작 중";
    operation.startedAt = new Date().toISOString();
    this.persist(operation);
    this.running += 1;
    this.exclusiveRunning = operation.exclusive;
    operation.locks.forEach((lock) => this.runningLocks.add(lock));

    let pendingOutput = "";
    const appendOutput = (lines: string[]) => {
      operation.output.push(...lines.map(sanitizeOperationOutputLine));
    };
    const flushOutput = () => {
      if (!pendingOutput) return;
      appendOutput([pendingOutput]);
      pendingOutput = "";
    };
    const progress: OperationProgress = {
      output: (value) => {
        pendingOutput += value;
        const lines = pendingOutput.split(/\r?\n/);
        pendingOutput = lines.pop() ?? "";
        appendOutput(lines);
      },
      step: (value) => {
        flushOutput();
        operation.step = value;
        this.persist(operation);
      },
    };

    const run = operation.run;
    if (!run) {
      operation.status = "failed";
      operation.step = "실행 정보를 찾을 수 없음";
      operation.error = {
        code: "operation_runner_missing",
        message: "작업 실행 정보를 찾을 수 없습니다. 다시 시도하십시오.",
      };
      operation.finishedAt = new Date().toISOString();
      this.running -= 1;
      this.exclusiveRunning = false;
      operation.locks.forEach((lock) => this.runningLocks.delete(lock));
      this.persist(operation);
      this.drain();
      return;
    }

    void run(progress)
      .then(() => {
        operation.status = "succeeded";
        operation.step = "완료됨";
      })
      .catch((error: unknown) => {
        console.error(error);
        operation.status = "failed";
        operation.step = "실패함";
        operation.error = operationError(error);
      })
      .finally(() => {
        flushOutput();
        operation.finishedAt = new Date().toISOString();
        this.running -= 1;
        this.exclusiveRunning = false;
        operation.locks.forEach((lock) => this.runningLocks.delete(lock));
        this.persist(operation);
        this.drain();
      });
  }

  private persist(operation: StoredOperation, required = false): void {
    if (!this.history) return;
    const record: PersistedOperation = {
      ...(operation.retryRequest ? { retryRequest: structuredClone(operation.retryRequest) } : {}),
      snapshot: clone(operation),
    };
    try {
      this.history.save(record);
    } catch (error) {
      if (required) throw error;
      console.error("작업 히스토리를 저장하지 못했습니다.", error);
    }
  }
}
