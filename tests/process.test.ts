import { describe, expect, it } from "vitest";
import { runCommand } from "../src/server/process.ts";

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
});
