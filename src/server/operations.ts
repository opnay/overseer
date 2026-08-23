import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import type { OperationKind, OperationSnapshot, OperationTarget } from "../shared/contracts.ts";
import { ExpectedError } from "./errors.ts";

const MAX_OUTPUT_LINES = 100;
const MAX_OPERATIONS = 100;

export interface OperationProgress {
  output(value: string): void;
  step(value: string): void;
}

interface EnqueueOperation {
  exclusive?: boolean;
  kind: OperationKind;
  locks: string[];
  run(progress: OperationProgress): Promise<void>;
  successMessage: string;
  target: OperationTarget;
  title: string;
}

interface StoredOperation extends OperationSnapshot {
  exclusive: boolean;
  locks: string[];
  run(progress: OperationProgress): Promise<void>;
}

function clone(operation: StoredOperation): OperationSnapshot {
  const { exclusive: _exclusive, locks: _locks, run: _run, ...snapshot } = operation;
  return {
    ...snapshot,
    error: snapshot.error ? { ...snapshot.error } : undefined,
    output: [...snapshot.output],
    target: { ...snapshot.target },
  };
}

function operationError(error: unknown): { code: string; message: string } {
  if (error instanceof ExpectedError) return { code: error.code, message: error.message };
  return { code: "operation_failed", message: "작업을 완료하지 못했습니다." };
}

export class OperationQueue {
  private readonly maxConcurrent: number;
  private readonly operations = new Map<string, StoredOperation>();
  private readonly pending: string[] = [];
  private readonly runningLocks = new Set<string>();
  private running = 0;
  private exclusiveRunning = false;

  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
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
      run: input.run,
      status: "queued",
      step: "대기 중",
      successMessage: input.successMessage,
      target: input.target,
      title: input.title,
    };
    this.operations.set(id, operation);
    this.pending.push(id);
    this.trim();
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
    this.running += 1;
    this.exclusiveRunning = operation.exclusive;
    operation.locks.forEach((lock) => this.runningLocks.add(lock));

    const progress: OperationProgress = {
      output: (value) => {
        const lines = stripVTControlCharacters(value)
          .split(/\r?\n/)
          .map((line) => line.trimEnd().slice(0, 2_000))
          .filter(Boolean);
        operation.output.push(...lines);
        if (operation.output.length > MAX_OUTPUT_LINES) {
          operation.output.splice(0, operation.output.length - MAX_OUTPUT_LINES);
        }
      },
      step: (value) => {
        operation.step = value;
      },
    };

    void operation
      .run(progress)
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
        operation.finishedAt = new Date().toISOString();
        this.running -= 1;
        this.exclusiveRunning = false;
        operation.locks.forEach((lock) => this.runningLocks.delete(lock));
        this.trim();
        this.drain();
      });
  }

  private trim(): void {
    if (this.operations.size <= MAX_OPERATIONS) return;
    const terminal = [...this.operations.values()]
      .filter(({ status }) => status !== "queued" && status !== "running")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    while (this.operations.size > MAX_OPERATIONS) {
      const operation = terminal.shift();
      if (!operation) return;
      this.operations.delete(operation.id);
    }
  }
}
