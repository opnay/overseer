import { describe, expect, it } from "vitest";
import { runCommand } from "../src/server/infrastructure/process.ts";

describe("runCommand", () => {
  it("identifies the actual command before streamed output without changing stdout", async () => {
    const chunks: string[] = [];
    const result = await runCommand(process.execPath, ["--version"], {
      onOutput: (chunk) => chunks.push(chunk),
    });
    expect(chunks[0]).toContain("$ ");
    expect(chunks[0]).toContain("--version");
    expect(chunks.slice(1).join("")).toBe(result.stdout);
    expect(result.stdout).toMatch(/^v/);
  });

  it("redacts command arguments and stdin while preserving execution", async () => {
    const chunks: string[] = [];
    const result = await runCommand(
      process.execPath,
      [
        "-e",
        "process.stdout.write(process.argv.slice(1).join('|'))",
        "--",
        "--token=private-token",
        "PASSWORD=private-password",
        "--env",
        "NAME=private-env",
        "https://user:private-url@example.com/?token=private-query",
        "--endpoint=https://user:private-nested@example.com",
      ],
      { input: "private-stdin", onOutput: (chunk) => chunks.push(chunk) },
    );
    expect(chunks[0]).toContain("$ ");
    for (const value of [
      "private-token",
      "private-password",
      "private-env",
      "private-url",
      "private-query",
      "private-stdin",
      "private-nested",
    ])
      expect(chunks[0]).not.toContain(value);
    expect(result.stdout).toContain("private-token");
  });

  it("keeps sensitive arguments out of failed command diagnostics", async () => {
    await expect(
      runCommand(process.execPath, ["-e", "process.exitCode = 1", "--", "--token=private-token"]),
    ).rejects.not.toThrow("private-token");
  });

  it("preserves the error code when an executable is missing", async () => {
    await expect(runCommand("overseer-test-missing-executable", [])).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("forwards input through stdin without adding it to the command", async () => {
    const result = await runCommand(
      process.execPath,
      ["-e", "process.stdin.pipe(process.stdout)"],
      {
        input: "daemon configuration\n",
      },
    );

    expect(result.stdout).toBe("daemon configuration\n");
  });

  it("preserves client metadata printed before a command exits unsuccessfully", async () => {
    await expect(
      runCommand(process.execPath, [
        "-e",
        "process.stdout.write('client metadata'); process.stderr.write('daemon unavailable'); process.exitCode = 1;",
      ]),
    ).rejects.toMatchObject({
      stdout: "client metadata",
      stderr: "daemon unavailable",
      exitCode: 1,
    });
  });
});
