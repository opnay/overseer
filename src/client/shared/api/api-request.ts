import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ApiFailure } from "@contracts/contracts.ts";

export class ApiRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
  }
}

function abortReason(signal: AbortSignal) {
  return signal.reason ?? new DOMException("요청이 취소되었습니다.", "AbortError");
}

function waitForTauriResponse<T>(request: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return request;
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(abortReason(signal));
    };
    const settle = (callback: () => void) => {
      signal.removeEventListener("abort", abort);
      callback();
    };

    signal.addEventListener("abort", abort, { once: true });
    request.then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error)),
    );
  });
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body) headers.set("content-type", "application/json");

  const response = isTauri()
    ? await waitForTauriResponse(
        invoke<[number, string]>("api_request", {
          body: typeof init?.body === "string" ? init.body : undefined,
          method: init?.method ?? "GET",
          path,
        }).then(([status, body]) => ({ body, ok: status >= 200 && status < 300 })),
        init?.signal,
      )
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
