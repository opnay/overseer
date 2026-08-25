import { spawn } from "node:child_process";

interface RunCommandOptions {
  input?: string;
  onOutput?: (value: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface CommandResult {
  stderr: string;
  stdout: string;
}

export class CommandError extends Error {
  readonly command: string;
  readonly exitCode?: number;
  readonly stderr: string;

  constructor(command: string, cause: unknown, stderr: string) {
    const source = cause as NodeJS.ErrnoException & { code?: number };
    const detail = stderr.trim() || source.message;
    super(`${command}: ${detail}`, { cause });
    this.name = "CommandError";
    this.command = command;
    this.exitCode = typeof source.code === "number" ? source.code : undefined;
    this.stderr = stderr;
  }
}

export function runCommand(
  executable: string,
  args: readonly string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const command = [executable, ...args].join(" ");
    const child = spawn(executable, [...args], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const maxBuffer = 10 * 1024 * 1024;
    let stdout = "";
    let stderr = "";
    let terminalError: Error | undefined;
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      callback();
    };
    const collect = (target: "stderr" | "stdout", chunk: Buffer) => {
      const text = chunk.toString("utf8");
      if (target === "stdout") stdout += text;
      else stderr += text;
      options.onOutput?.(text);
      if (stdout.length + stderr.length > maxBuffer && !terminalError) {
        terminalError = new Error("command output exceeded 10 MiB");
        child.kill("SIGTERM");
      }
    };
    const abort = () => {
      terminalError = new Error("command aborted");
      child.kill("SIGTERM");
    };
    const timeout = setTimeout(() => {
      terminalError = new Error(`command timed out after ${options.timeoutMs ?? 30_000}ms`);
      child.kill("SIGTERM");
    }, options.timeoutMs ?? 30_000);

    child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE" && !terminalError) terminalError = error;
    });
    child.on("error", (error) => finish(() => reject(new CommandError(command, error, stderr))));
    child.on("close", (code) => {
      if (terminalError) {
        finish(() => reject(new CommandError(command, terminalError, stderr)));
        return;
      }
      if (code !== 0) {
        const error = Object.assign(new Error(`command exited with code ${code}`), { code });
        finish(() => reject(new CommandError(command, error, stderr)));
        return;
      }
      finish(() => resolve({ stderr, stdout }));
    });

    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    child.stdin.end(options.input);
  });
}

export function parseJsonLines<T>(text: string): T[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  if (trimmed.startsWith("[")) {
    return JSON.parse(trimmed) as T[];
  }

  return trimmed.split("\n").map((line) => JSON.parse(line) as T);
}
