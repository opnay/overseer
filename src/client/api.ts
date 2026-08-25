import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ApiFailure } from "../shared/contracts.ts";

export class ApiRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("content-type", "application/json");

  const response = isTauri()
    ? await invoke<[number, string]>("api_request", {
        body: typeof init?.body === "string" ? init.body : undefined,
        method: init?.method ?? "GET",
        path,
      }).then(([status, body]) => ({ body, ok: status >= 200 && status < 300 }))
    : await fetch(`/api${path}`, { ...init, headers }).then(async (value) => ({
        body: await value.text(),
        ok: value.ok,
      }));
  const value = JSON.parse(response.body) as T | ApiFailure;
  if (!response.ok) {
    const failure = value as ApiFailure;
    throw new ApiRequestError(
      failure.error?.code ?? "request_failed",
      failure.error?.message ?? "요청을 완료하지 못했습니다.",
    );
  }
  return value as T;
}
