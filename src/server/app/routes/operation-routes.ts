import type { Hono } from "hono";
import type { OperationAccepted } from "../../../shared/contracts.ts";
import { ExpectedError } from "../../core/errors.ts";
import type { OperationQueue } from "../../modules/operations/index.ts";

export function registerOperationRoutes(app: Hono, operations: OperationQueue): void {
  app.get("/operations", (context) => context.json({ operations: operations.list() }));
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
