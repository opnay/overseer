import { describe, expect, it } from "vitest";
import { runCommand } from "../src/server/infrastructure/process.ts";

describe("runCommand", () => {
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
