export interface DesktopApiRequest {
  body?: string;
  id: number;
  method: string;
  path: string;
}

export interface DesktopApiResponse {
  body: string;
  id: number;
  status: number;
}

interface ApiRequestTarget {
  request(input: Request): Response | Promise<Response>;
}

const supportedMethods = new Set(["DELETE", "GET", "PATCH", "POST"]);

function requestUrl(path: string): URL {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("API 경로를 확인하십시오.");
  }
  const url = new URL(path, "http://localhost");
  if (url.origin !== "http://localhost") throw new Error("API 경로를 확인하십시오.");
  return url;
}

export async function forwardDesktopApiRequest(
  api: ApiRequestTarget,
  input: DesktopApiRequest,
): Promise<DesktopApiResponse> {
  const method = input.method.toUpperCase();
  if (!supportedMethods.has(method)) throw new Error("API 요청 방식을 확인하십시오.");

  const headers = new Headers({ host: "localhost" });
  if (input.body !== undefined) headers.set("content-type", "application/json");
  if (method !== "GET") headers.set("origin", "http://localhost");

  const request = new Request(requestUrl(input.path), {
    ...(input.body === undefined ? {} : { body: input.body }),
    headers,
    method,
  });
  const response = await api.request(request);
  return { body: await response.text(), id: input.id, status: response.status };
}
