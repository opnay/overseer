import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { BrowserRouter, useLocation, useNavigate } from "react-router";
import { describe, expect, it } from "vitest";
import { useAppHistory } from "../src/client/app/routing/use-app-history.ts";

function NavigationProbe({ blocked = false }: { blocked?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { canGoBack, canGoForward, goBack, goForward } = useAppHistory(blocked);
  return (
    <>
      <output aria-label="현재 경로">
        {location.pathname}
        {location.search}
      </output>
      <button disabled={!canGoBack} onClick={goBack}>
        뒤로
      </button>
      <button disabled={!canGoForward} onClick={goForward}>
        앞으로
      </button>
      <button onClick={() => void navigate("/images")}>이미지</button>
      <button onClick={() => void navigate("/volumes")}>볼륨</button>
      <button onClick={() => void navigate("/settings?section=engine", { replace: true })}>
        교체
      </button>
      <input aria-label="편집" />
    </>
  );
}

function open(blocked = false) {
  window.history.replaceState(null, "", "/containers");
  return render(
    <BrowserRouter>
      <NavigationProbe blocked={blocked} />
    </BrowserRouter>,
  );
}

async function expectPath(path: string) {
  await waitFor(() =>
    expect(screen.getByRole("status", { name: "현재 경로" })).toHaveTextContent(path),
  );
}

describe("app history navigation", () => {
  it("respects the app boundary, replacement and the forward branch", async () => {
    const user = userEvent.setup();
    open();
    expect(screen.getByRole("button", { name: "뒤로" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "앞으로" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "이미지" }));
    await user.click(screen.getByRole("button", { name: "교체" }));
    await user.click(screen.getByRole("button", { name: "뒤로" }));
    await expectPath("/containers");
    expect(screen.getByRole("button", { name: "뒤로" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "앞으로" }));
    await expectPath("/settings?section=engine");
    await user.click(screen.getByRole("button", { name: "뒤로" }));
    await expectPath("/containers");
    await user.click(screen.getByRole("button", { name: "볼륨" }));
    await expectPath("/volumes");
    expect(screen.getByRole("button", { name: "앞으로" })).toBeDisabled();
  });

  it("routes mouse and keyboard input once and cancels the WebView fallback", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: "이미지" }));
    await user.click(screen.getByRole("button", { name: "볼륨" }));
    const back = new MouseEvent("mouseup", { button: 3, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(back);
    });
    expect(back.defaultPrevented).toBe(true);
    await expectPath("/images");
    fireEvent.keyDown(window, { key: "]", metaKey: true });
    await expectPath("/volumes");
    fireEvent.keyDown(window, { key: "[", metaKey: true });
    await expectPath("/images");
    const forward = new MouseEvent("mouseup", { button: 4, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(forward);
    });
    expect(forward.defaultPrevented).toBe(true);
    await expectPath("/volumes");
    act(() => {
      window.dispatchEvent(new CustomEvent("overseer:history", { detail: { direction: "back" } }));
    });
    await expectPath("/images");
    act(() => {
      window.dispatchEvent(
        new CustomEvent("overseer:history", { detail: { direction: "forward" } }),
      );
      window.dispatchEvent(
        new CustomEvent("overseer:history", { detail: { direction: "invalid" } }),
      );
    });
    await expectPath("/volumes");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "편집" }), {
      key: "ArrowLeft",
      altKey: true,
    });
    await expectPath("/volumes");
  });

  it("blocks history commands during required setup", async () => {
    const user = userEvent.setup();
    open(true);
    await user.click(screen.getByRole("button", { name: "이미지" }));
    const event = new MouseEvent("mouseup", { button: 3, cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole("button", { name: "뒤로" })).toBeDisabled();
    await expectPath("/images");
  });
});
