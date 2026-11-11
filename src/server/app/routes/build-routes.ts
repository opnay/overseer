import type { Hono } from "hono";
import { isBuildIdentifier, type BuildStatus } from "../../../shared/builds.ts";
import { isRuntimeInstanceName } from "../../../shared/validation.ts";
import type { BuildController } from "../../application/overseer-controller.ts";
import { ExpectedError } from "../../core/errors.ts";
import { requirePageNumber } from "../http.ts";

function requireBuildId(id: string): string {
  if (!isBuildIdentifier(id)) {
    throw new ExpectedError("invalid_build_id", "빌드 식별자를 확인하십시오.", 400);
  }
  return id;
}

function requireInstance(value: string | undefined): string {
  if (!value || !isRuntimeInstanceName(value)) {
    throw new ExpectedError("invalid_build_instance", "빌드의 엔진을 확인하십시오.", 400);
  }
  return value;
}

export function registerBuildRoutes(app: Hono, controller: BuildController): void {
  app.get("/builds", async (context) => {
    const query = context.req.query();
    const allowed = new Set(["instance", "page", "pageSize", "filter[name]", "filter[status]"]);
    if (Object.keys(query).some((key) => !allowed.has(key))) {
      throw new ExpectedError("invalid_build_query", "지원하지 않는 빌드 조회 조건입니다.", 400);
    }
    const name = query["filter[name]"]?.trim();
    const status = query["filter[status]"];
    const statuses: BuildStatus[] = ["running", "succeeded", "failed", "unknown"];
    const pageSize = query.pageSize === undefined ? 20 : requirePageNumber(query.pageSize);
    if (
      (name && name.length > 200) ||
      (status && !statuses.includes(status as BuildStatus)) ||
      pageSize > 100
    ) {
      throw new ExpectedError("invalid_build_query", "빌드 조회 조건을 확인하십시오.", 400);
    }
    return context.json(
      await controller.getBuildHistory(
        {
          page: requirePageNumber(query.page),
          pageSize,
          ...(name ? { name } : {}),
          ...(status ? { status: status as BuildStatus } : {}),
        },
        query.instance === undefined ? undefined : requireInstance(query.instance),
      ),
    );
  });
  app.get("/builds/:id", async (context) =>
    context.json(
      await controller.getBuild(
        requireBuildId(context.req.param("id")),
        requireInstance(context.req.query("instance")),
      ),
    ),
  );
  app.get("/builds/:id/logs", async (context) =>
    context.json(
      await controller.getBuildLogs(
        requireBuildId(context.req.param("id")),
        requireInstance(context.req.query("instance")),
      ),
    ),
  );
  app.get("/builds/:id/steps", async (context) =>
    context.json(
      await controller.getBuildSteps(
        requireBuildId(context.req.param("id")),
        requireInstance(context.req.query("instance")),
      ),
    ),
  );
  app.get("/builds/:id/related", async (context) =>
    context.json(
      await controller.getRelatedBuilds(
        requireBuildId(context.req.param("id")),
        requireInstance(context.req.query("instance")),
      ),
    ),
  );
}
