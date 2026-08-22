import type { MiddlewareHandler } from "hono";

function hostnameFromAuthority(authority: string): string {
  if (authority.startsWith("[")) return authority.slice(1, authority.indexOf("]"));
  return authority.split(":")[0] ?? "";
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}

export const requireLocalRequest: MiddlewareHandler = async (context, next) => {
  const host = context.req.header("host");
  if (!host || !isLoopbackHostname(hostnameFromAuthority(host))) {
    return context.json(
      { error: { code: "local_only", message: "로컬 주소에서만 사용할 수 있습니다." } },
      403,
    );
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(context.req.method)) {
    const origin = context.req.header("origin");
    if (origin) {
      let originHostname = "";
      try {
        originHostname = new URL(origin).hostname;
      } catch {
        return context.json(
          { error: { code: "invalid_origin", message: "요청 출처를 확인할 수 없습니다." } },
          403,
        );
      }

      if (!isLoopbackHostname(originHostname)) {
        return context.json(
          { error: { code: "local_only", message: "로컬 출처의 요청만 허용됩니다." } },
          403,
        );
      }
    }
  }

  await next();
};
