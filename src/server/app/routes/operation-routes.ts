import type { Hono } from "hono";
import type {
  OperationAccepted,
  OperationResource,
  OperationStatus,
} from "../../../shared/contracts.ts";
import { ExpectedError } from "../../core/errors.ts";
import type { OperationQueue } from "../../modules/operations/index.ts";

const DEFAULT_OPERATION_PAGE_SIZE = 50;
const MAX_OPERATION_PAGE_SIZE = 100;
const operationResources = new Set<OperationResource>([
  "compose",
  "container",
  "dockerPlugin",
  "image",
  "network",
  "runtime",
  "startup",
  "volume",
]);
const operationStatuses = new Set<OperationStatus>([
  "cancelled",
  "failed",
  "queued",
  "running",
  "succeeded",
]);

function positiveInteger(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  throw new ExpectedError("invalid_operation_query", `${label} 값이 올바르지 않습니다.`, 400);
}

export function registerOperationRoutes(app: Hono, operations: OperationQueue): void {
  app.get("/operations", (context) => {
    const page = positiveInteger(context.req.query("page"), 1, "페이지");
    const pageSize = positiveInteger(
      context.req.query("pageSize"),
      DEFAULT_OPERATION_PAGE_SIZE,
      "페이지 크기",
    );
    if (pageSize > MAX_OPERATION_PAGE_SIZE) {
      throw new ExpectedError(
        "invalid_operation_query",
        `페이지 크기는 ${MAX_OPERATION_PAGE_SIZE} 이하여야 합니다.`,
        400,
      );
    }
    const query = context.req.query("query")?.trim();
    if (query && query.length > 100) {
      throw new ExpectedError("invalid_operation_query", "검색어는 100자 이하여야 합니다.", 400);
    }
    const statusValue = context.req.query("status");
    const resourceValue = context.req.query("resource");
    if (statusValue && !operationStatuses.has(statusValue as OperationStatus)) {
      throw new ExpectedError("invalid_operation_query", "작업 상태가 올바르지 않습니다.", 400);
    }
    if (resourceValue && !operationResources.has(resourceValue as OperationResource)) {
      throw new ExpectedError("invalid_operation_query", "리소스 종류가 올바르지 않습니다.", 400);
    }
    const result = operations.query({
      page,
      pageSize,
      ...(query ? { query } : {}),
      ...(resourceValue ? { resource: resourceValue as OperationResource } : {}),
      ...(statusValue ? { status: statusValue as OperationStatus } : {}),
    });
    return context.json({
      operations: result.operations,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
      },
    });
  });
  app.get("/operations/:id", (context) => {
    const operation = operations.get(context.req.param("id"));
    if (!operation) {
      throw new ExpectedError("operation_not_found", "작업을 찾을 수 없습니다.", 404);
    }
    return context.json({ operation });
  });
  app.delete("/operations/:id", (context) =>
    context.json({ operation: operations.cancel(context.req.param("id")) }),
  );
  app.post("/operations/:id/retry", async (context) => {
    const sourceId = context.req.param("id");
    const request = operations.getRetryRequest(sourceId);
    const headers = new Headers({ host: "localhost", origin: "http://localhost" });
    const body = request.body === undefined ? undefined : JSON.stringify(request.body);
    if (body !== undefined) headers.set("content-type", "application/json");
    const response = await app.request(request.path, {
      ...(body === undefined ? {} : { body }),
      headers,
      method: request.method,
    });
    if (response.status !== 202) return response;
    const value = (await response.json()) as OperationAccepted;
    return context.json({ operation: operations.markRetried(value.operation.id, sourceId) }, 202);
  });
}
