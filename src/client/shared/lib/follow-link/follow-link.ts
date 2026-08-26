import type { MouseEvent } from "react";

export function followLink(event: MouseEvent<HTMLAnchorElement>, onFollow: () => void) {
  if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  onFollow();
}
