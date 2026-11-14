import { spawn } from "node:child_process";
import { commandDisplay } from "./command-display.ts";

export interface RunCommandOptions {
  input?: string;
  onOutput?: (value: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface CommandResult {
  stderr: string;
  stdout: string;
}

export type CommandRunner = typeof runCommand;

export class CommandError extends Error {
  readonly code?: string;
  readonly command: string;
  readonly exitCode?: number;
  readonly stderr: string;
  readonly stdout: string;

  constructor(command: string, cause: unknown, stderr: string, stdout = "") {
    const source = cause as NodeJS.ErrnoException & { code?: number };
    const detail = stderr.trim() || source.message;
    super(`${command}: ${detail}`, { cause });
    this.name = "CommandError";
    this.code = typeof source.code === "string" ? source.code : undefined;
    this.command = command;
    this.exitCode = typeof source.code === "number" ? source.code : undefined;
    this.stderr = stderr;
    this.stdout = stdout;
  }
}

export function runCommand(
  executable: string,
  args: readonly string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const command = commandDisplay(executable, args);
    options.onOutput?.(`\n$ ${command}\n`);
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
    child.on("error", (error) =>
      finish(() => reject(new CommandError(command, error, stderr, stdout))),
    );
    child.on("close", (code) => {
      if (terminalError) {
        finish(() => reject(new CommandError(command, terminalError, stderr, stdout)));
        return;
      }
      if (code !== 0) {
        const error = Object.assign(new Error(`command exited with code ${code}`), { code });
        finish(() => reject(new CommandError(command, error, stderr, stdout)));
        return;
      }
      finish(() => resolve({ stderr, stdout }));
    });

    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    child.stdin.end(options.input);
  });
}
