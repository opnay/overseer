import { Button } from "@opnay/city-ds-react/button";
import { Dialog } from "@opnay/city-ds-react/dialog";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LogViewer } from "../src/client/shared/ui/log-viewer/index.ts";

describe("LogViewer", () => {
  it("keeps the complete compact value and follows appended output", async () => {
    const { rerender } = render(
      <LogViewer ariaLabel="진행 출력" followOutput height="compact" value="line 0" />,
    );
    const code = screen.getByRole("region", { name: "진행 출력" }).querySelector("pre");
    if (!code) throw new Error("compact log code not found");
    Object.defineProperty(code, "scrollHeight", { configurable: true, value: 240 });

    const value = Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n");
    rerender(<LogViewer ariaLabel="진행 출력" followOutput height="compact" value={value} />);

    await waitFor(() => expect(code?.scrollTop).toBe(240));
    expect(code?.querySelector("code")?.textContent).toBe(value);
    expect(screen.getByRole("region", { name: "진행 출력" })).toHaveAttribute(
      "data-height",
      "compact",
    );
  });

  it("starts at the first command while preserving spacing between commands", async () => {
    const user = userEvent.setup();
    const output = "$ brew update\nupdated\n\n$ brew outdated\n";
    render(<LogViewer ariaLabel="명령 출력" value={`\n${output}`} />);
    const viewer = screen.getByRole("region", { name: "명령 출력" });
    expect(viewer.querySelector("code")?.textContent).toBe(output);

    await user.click(within(viewer).getByRole("button", { name: "로그 옵션" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "줄 번호" }));
    expect(viewer.querySelector(".overseer-log-code-line-content")).toHaveTextContent(
      "$ brew update",
    );
  });

  it("links only HTTPS addresses and preserves the log text and display modes", async () => {
    const user = userEvent.setup();
    const value =
      '$ curl "https://example.com/a?q=1&b=2"\nSee (https://example.com/docs_(cli)).\nhttp://example.com /tmp/file file:///tmp/file https://';
    render(<LogViewer ariaLabel="링크 로그" value={value} />);
    const viewer = screen.getByRole("region", { name: "링크 로그" });
    const expected = ["https://example.com/a?q=1&b=2", "https://example.com/docs_(cli)"];
    const verifyLinks = (region: HTMLElement) => {
      const links = within(region).getAllByRole("link");
      expect(links.map((link) => link.textContent)).toEqual(expected);
      for (const [index, link] of links.entries()) {
        expect(link).toHaveAttribute("href", expected[index]);
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noreferrer");
      }
      expect(region.querySelector("code")?.textContent).toBe(value);
    };
    verifyLinks(viewer);
    expect(viewer.querySelector(".overseer-log-command a")).toBeInTheDocument();

    await user.click(within(viewer).getByRole("button", { name: "로그 옵션" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "줄 번호" }));
    await user.keyboard("{Escape}");
    verifyLinks(viewer);
    await user.click(within(viewer).getByRole("button", { name: "크게 보기" }));
    verifyLinks(await screen.findByRole("region", { name: "링크 로그 전체 화면" }));
  });

  it("opens a full-window dialog above an existing dialog and preserves display options", async () => {
    const user = userEvent.setup();

    render(
      <Dialog.Root open>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Viewport>
            <Dialog.Popup>
              <Dialog.Title>상위 모달</Dialog.Title>
              <Dialog.Description>중첩 모달 테스트</Dialog.Description>
              <LogViewer ariaLabel="테스트 로그" value={"first line\nsecond line"} />
              <Dialog.Footer>
                <Dialog.Close render={<Button variant="outline" />}>닫기</Dialog.Close>
              </Dialog.Footer>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>,
    );

    const parentDialog = screen.getByRole("dialog", { name: "상위 모달" });
    const originalViewer = within(parentDialog).getByRole("region", { name: "테스트 로그" });
    const optionsButton = within(originalViewer).getByRole("button", { name: "로그 옵션" });
    const maximizeButton = within(originalViewer).getByRole("button", { name: "크게 보기" });
    expect(maximizeButton).toHaveAttribute("data-city-icon-only");

    await user.hover(maximizeButton);
    expect(await screen.findByRole("tooltip", { name: "크게 보기" })).toBeInTheDocument();
    await user.unhover(maximizeButton);

    await user.click(optionsButton);
    const options = await screen.findByRole("menu");
    await user.click(within(options).getByRole("menuitemcheckbox", { name: "줄 바꿈" }));
    await user.keyboard("{Escape}");

    await user.click(maximizeButton);
    const fullscreenDialog = await screen.findByRole("dialog", { name: "테스트 로그" });
    expect(document.querySelectorAll("[data-city-dialog-popup]")).toHaveLength(2);
    expect(fullscreenDialog).toHaveAttribute("data-size", "full");
    expect(within(fullscreenDialog).getByRole("heading", { name: "테스트 로그" })).toHaveClass(
      "sr-only",
    );
    const closeButton = within(fullscreenDialog).getByRole("button", { name: "최대화 닫기" });
    expect(closeButton).toHaveAttribute("data-city-icon-only");
    expect(fullscreenDialog.querySelector(".overseer-log-viewer-toolbar")).toContainElement(
      closeButton,
    );
    expect(
      within(fullscreenDialog).queryByRole("button", { name: /^닫기$/ }),
    ).not.toBeInTheDocument();
    expect(fullscreenDialog.querySelector(".overseer-log-viewer-toolbar")).toHaveTextContent(
      "테스트 로그",
    );
    expect(fullscreenDialog).toHaveClass("overseer-log-viewer-fullscreen-dialog");
    expect(fullscreenDialog.parentElement).toHaveClass("overseer-log-viewer-fullscreen-viewport");

    const fullscreenViewer = within(fullscreenDialog).getByRole("region", {
      name: "테스트 로그 전체 화면",
    });
    const fullscreenCode = fullscreenViewer.querySelector(".overseer-log-viewer-code");
    expect(fullscreenCode?.querySelector("code")?.textContent).toBe("first line\nsecond line");
    expect(fullscreenCode).toHaveAttribute("data-wrap", "true");

    await user.click(within(fullscreenViewer).getByRole("button", { name: "로그 옵션" }));
    const fullscreenOptions = await screen.findByRole("menu");
    await user.click(within(fullscreenOptions).getByRole("menuitemradio", { name: "크게" }));
    await user.keyboard("{Escape}");
    expect(fullscreenCode).toHaveAttribute("data-font-size", "large");

    await user.hover(closeButton);
    expect(await screen.findByRole("tooltip", { name: "최대화 닫기" })).toBeInTheDocument();
    await user.click(closeButton);
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "테스트 로그 전체 화면" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("dialog", { name: "상위 모달" })).toBeInTheDocument();
    expect(originalViewer.querySelector(".overseer-log-viewer-code")).toHaveAttribute(
      "data-font-size",
      "large",
    );
    expect(maximizeButton).toHaveFocus();
    await user.click(maximizeButton);
    await screen.findByRole("dialog", { name: "테스트 로그" });
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "테스트 로그" })).not.toBeInTheDocument(),
    );
  });
});
