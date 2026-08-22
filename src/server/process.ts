import { execFile } from "node:child_process";

interface RunCommandOptions {
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
    const child = execFile(
      executable,
      [...args],
      {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
        signal: options.signal,
        timeout: options.timeoutMs ?? 30_000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new CommandError([executable, ...args].join(" "), error, stderr));
          return;
        }

        resolve({ stderr, stdout });
      },
    );

    child.stdin?.end();
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
