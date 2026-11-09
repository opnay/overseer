import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router";

export function useAppHistory(blocked: boolean) {
  const location = useLocation();
  const action = useNavigationType();
  const navigate = useNavigate();
  const [history, setHistory] = useState(() => ({ keys: [location.key], index: 0 }));
  const pending = useRef(false);

  useLayoutEffect(() => {
    pending.current = false;
    setHistory((current) => {
      if (current.keys[current.index] === location.key) return current;
      if (action === "PUSH") {
        return {
          keys: [...current.keys.slice(0, current.index + 1), location.key],
          index: current.index + 1,
        };
      }
      if (action === "REPLACE") {
        const keys = [...current.keys];
        keys[current.index] = location.key;
        return { keys, index: current.index };
      }
      const index = current.keys.indexOf(location.key);
      return index < 0 ? { keys: [location.key], index: 0 } : { ...current, index };
    });
  }, [action, location.key]);

  const canGoBack = !blocked && history.index > 0;
  const canGoForward = !blocked && history.index < history.keys.length - 1;
  const goBack = useCallback(() => {
    if (!canGoBack || pending.current) return;
    pending.current = true;
    void navigate(-1);
  }, [canGoBack, navigate]);
  const goForward = useCallback(() => {
    if (!canGoForward || pending.current) return;
    pending.current = true;
    void navigate(1);
  }, [canGoForward, navigate]);

  useEffect(() => {
    const onNativeHistory = (event: Event) => {
      const detail: unknown = (event as CustomEvent).detail;
      if (!detail || typeof detail !== "object" || !("direction" in detail)) return;
      if (detail.direction === "back") goBack();
      else if (detail.direction === "forward") goForward();
    };
    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 3 || event.button === 4) event.preventDefault();
    };
    const onMouseUp = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      // Wry checks this flag before its own history.back/forward fallback.
      event.preventDefault();
      event.stopPropagation();
      if (event.button === 3) goBack();
      else goForward();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const bracketShortcut = event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
      const back = event.key === "BrowserBack" || (bracketShortcut && event.key === "[");
      const forward = event.key === "BrowserForward" || (bracketShortcut && event.key === "]");
      if (!back && !forward) return;
      event.preventDefault();
      if (back) goBack();
      else goForward();
    };
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("overseer:history", onNativeHistory);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("overseer:history", onNativeHistory);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [goBack, goForward]);

  return { canGoBack, canGoForward, goBack, goForward };
}
