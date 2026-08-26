import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommandBlock } from "../src/client/shared/ui/command-block/index.ts";

describe("CommandBlock", () => {
  it("copies the exact command and reports completion", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <CommandBlock
        ariaLabel="컨테이너 터미널 명령"
        command="docker --context overseer exec -it container-id sh"
        copyLabel="터미널 명령 복사"
        label="로컬 터미널에서 실행"
      />,
    );

    await user.click(screen.getByRole("button", { name: "터미널 명령 복사" }));
    expect(writeText).toHaveBeenCalledWith("docker --context overseer exec -it container-id sh");
    expect(screen.getByRole("button", { name: "터미널 명령 복사" })).toHaveTextContent("복사됨");
  });
});
