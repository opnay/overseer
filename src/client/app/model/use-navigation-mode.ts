import { useEffect, useState } from "react";

export type NavigationMode = "desktop" | "mobile" | "rail";

function navigationMode(): NavigationMode {
  if (window.matchMedia("(max-width: 42rem)").matches) return "mobile";
  if (window.matchMedia("(max-width: 52rem)").matches) return "rail";
  return "desktop";
}

export function useNavigationMode(): NavigationMode {
  const [mode, setMode] = useState(navigationMode);

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 42rem)");
    const rail = window.matchMedia("(max-width: 52rem)");
    const sync = () => setMode(mobile.matches ? "mobile" : rail.matches ? "rail" : "desktop");
    sync();
    mobile.addEventListener("change", sync);
    rail.addEventListener("change", sync);
    return () => {
      mobile.removeEventListener("change", sync);
      rail.removeEventListener("change", sync);
    };
  }, []);

  return mode;
}
