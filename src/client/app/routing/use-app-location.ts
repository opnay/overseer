import { getAppLocation, type AppLocationPath } from "@/shared/routes";
import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";

export function useAppLocation() {
  const location = useLocation();
  const navigate = useNavigate();
  const startupRoute = location.pathname === "/startup";
  const startupReturnPath = useRef<AppLocationPath>(getAppLocation(location.pathname));
  const resourcePath = startupRoute ? startupReturnPath.current : getAppLocation(location.pathname);
  const navigationSearch = location.search;
  const selectResourcePath = useCallback(
    (nextPath: AppLocationPath, search = "") => {
      const href = `${nextPath}${search}`;
      if (`${location.pathname}${location.search}` !== href) void navigate(href);
    },
    [location.pathname, location.search, navigate],
  );
  const selectNavigationHref = useCallback(
    (href: string) => {
      const url = new URL(href, window.location.href);
      selectResourcePath(getAppLocation(url.pathname), url.search);
    },
    [selectResourcePath],
  );
  useEffect(() => {
    if (startupRoute) return;
    startupReturnPath.current = resourcePath;
    if (location.pathname !== resourcePath) void navigate(resourcePath, { replace: true });
  }, [location.pathname, navigate, resourcePath, startupRoute]);
  useEffect(() => {
    const onNavigate = (event: Event) => {
      const detail: unknown = (event as CustomEvent).detail;
      if (
        !detail ||
        typeof detail !== "object" ||
        !("path" in detail) ||
        typeof detail.path !== "string"
      )
        return;
      selectNavigationHref(detail.path);
    };
    window.addEventListener("overseer:navigate", onNavigate);
    return () => window.removeEventListener("overseer:navigate", onNavigate);
  }, [selectNavigationHref]);
  return {
    location,
    navigate,
    startupRoute,
    resourcePath,
    navigationSearch,
    selectResourcePath,
    selectNavigationHref,
  };
}
