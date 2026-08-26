import type { Context } from "hono";
import { ExpectedError } from "../core/errors.ts";
import type { EnqueueOperation, OperationQueue } from "../modules/operations/index.ts";

export type EnqueueApiOperation = (
  context: Context,
  input: Omit<EnqueueOperation, "retryRequest">,
  body?: unknown,
  retryable?: boolean,
) => ReturnType<OperationQueue["enqueue"]>;

export async function readObject(context: {
  req: { json: () => Promise<unknown> };
}): Promise<Record<string, unknown>> {
  try {
    const value = await context.req.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new ExpectedError("invalid_body", "요청 본문은 객체여야 합니다.", 400);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ExpectedError) throw error;
    throw new ExpectedError("invalid_json", "JSON 요청 본문을 확인하십시오.", 400);
  }
}

export async function readOptionalObject(
  context: Context,
): Promise<Record<string, unknown> | undefined> {
  const source = await context.req.text();
  if (!source.trim()) return undefined;
  try {
    const value = JSON.parse(source) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new ExpectedError("invalid_body", "요청 본문은 객체여야 합니다.", 400);
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ExpectedError) throw error;
    throw new ExpectedError("invalid_json", "JSON 요청 본문을 확인하십시오.", 400);
  }
}

export function requirePageNumber(value: string | undefined): number {
  if (value === undefined) return 1;
  if (!/^\d+$/.test(value)) {
    throw new ExpectedError("invalid_page", "페이지 번호를 확인하십시오.", 400);
  }
  const page = Number(value);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) {
    throw new ExpectedError("invalid_page", "페이지 번호를 확인하십시오.", 400);
  }
  return page;
}
