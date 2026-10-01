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
  app.post("/docker-cli/plugins/updates/check", (context) => {
    const operation = enqueue(context, {
      kind: "docker.plugin.update.check",
      locks: ["homebrew"],
      run: (progress) => plugins.checkUpdates(progress),
      successMessage: "Docker CLI·Compose·Buildx 업데이트를 확인했습니다.",
      target: { name: "Docker CLI·Compose·Buildx", resource: "dockerPlugin" },
      title: "CLI 도구 업데이트 확인",
    });
    return context.json({ operation }, 202);
  });
  app.post("/docker-cli/plugins/:id/update", (context) => {
    const source = context.req.param("id");
    if (source !== "docker" && source !== "compose" && source !== "buildx") {
      throw new ExpectedError("invalid_docker_plugin", "지원하지 않는 CLI 도구입니다.", 400);
    }
    const label =
      source === "docker"
        ? "Docker CLI"
        : source === "compose"
          ? "Docker Compose"
          : "Docker Buildx";
    const operation = enqueue(
      context,
      {
        exclusive: true,
        kind: "docker.plugin.update",
        locks: ["homebrew"],
        run: (progress) => plugins.update(source, progress),
        successMessage: `${label}를 업데이트했습니다.`,
        target: { id: source, name: label, resource: "dockerPlugin" },
        title: `${label} 업데이트`,
      },
      undefined,
      false,
    );
    return context.json({ operation }, 202);
  });
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
