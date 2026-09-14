import type { Hono } from "hono";
import type { DockerCliPluginId } from "../../../shared/contracts.ts";
import { ExpectedError } from "../../core/errors.ts";
import type { DockerCliPluginController } from "../../modules/docker-plugins/index.ts";
import type { EnqueueApiOperation } from "../http.ts";

export function registerDockerPluginRoutes(
  app: Hono,
  plugins: DockerCliPluginController,
  enqueue: EnqueueApiOperation,
): void {
  app.get("/docker-cli/plugins", async (context) => context.json(await plugins.getSnapshot()));
  app.post("/docker-cli/plugins/:id/install", (context) => {
    const source = context.req.param("id");
    if (source !== "buildx") {
      throw new ExpectedError(
        "invalid_docker_plugin",
        "설치를 지원하지 않는 Docker CLI 플러그인입니다.",
        400,
      );
    }
    const id: DockerCliPluginId = source;
    const operation = enqueue(
      context,
      {
        exclusive: true,
        kind: "docker.plugin.install",
        locks: ["homebrew"],
        run: (progress) => plugins.install(id, progress),
        successMessage: "Docker Buildx를 설치했습니다.",
        target: { id, name: "Docker Buildx", resource: "dockerPlugin" },
        title: "Docker Buildx 설치",
      },
      undefined,
      false,
    );
    return context.json({ operation }, 202);
  });
}
