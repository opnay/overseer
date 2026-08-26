import type { Hono } from "hono";
import type { StartupInstallTarget, ToolUpdateId } from "../../../shared/contracts.ts";
import { ExpectedError } from "../../core/errors.ts";
import type { StartupPrerequisiteController } from "../../modules/startup/index.ts";
import type { EnqueueApiOperation } from "../http.ts";

export function registerStartupRoutes(
  app: Hono,
  startup: StartupPrerequisiteController,
  enqueue: EnqueueApiOperation,
): void {
  app.get("/startup", async (context) => context.json(await startup.getSnapshot()));
  app.get("/startup/updates", async (context) => context.json(await startup.getUpdates()));
  app.post("/startup/updates/check", (context) => {
    const operation = enqueue(context, {
      kind: "startup.update.check",
      locks: ["homebrew"],
      run: (progress) => startup.checkUpdates(progress),
      successMessage: "Docker CLI·Compose·Lima 업데이트를 확인했습니다.",
      target: { name: "Docker CLI·Compose·Lima", resource: "startup" },
      title: "도구 업데이트 확인",
    });
    return context.json({ operation }, 202);
  });
  app.post("/startup/prerequisites/:id/update", (context) => {
    const source = context.req.param("id");
    if (source !== "docker" && source !== "compose" && source !== "lima") {
      throw new ExpectedError("invalid_tool_update", "지원하지 않는 업데이트 항목입니다.", 400);
    }
    const target: ToolUpdateId = source;
    const label =
      target === "docker" ? "Docker CLI" : target === "compose" ? "Docker Compose" : "Lima";
    const operation = enqueue(
      context,
      {
        exclusive: true,
        kind: "startup.update",
        locks: ["homebrew"],
        run: (progress) => startup.update(target, progress),
        successMessage: `${label}를 업데이트했습니다.`,
        target: { id: target, name: label, resource: "startup" },
        title: `${label} 업데이트`,
      },
      undefined,
      false,
    );
    return context.json({ operation }, 202);
  });
  app.post("/startup/prerequisites/:id/install", async (context) => {
    const source = context.req.param("id");
    if (
      source !== "homebrew" &&
      source !== "docker" &&
      source !== "docker-with-compose" &&
      source !== "compose" &&
      source !== "lima"
    ) {
      throw new ExpectedError(
        "invalid_startup_prerequisite",
        "지원하지 않는 설치 항목입니다.",
        400,
      );
    }
    const target: StartupInstallTarget = source;
    const id = target === "docker-with-compose" ? "docker" : target;
    const prerequisite = (await startup.getSnapshot()).prerequisites.find(
      (candidate) => candidate.id === id,
    );
    if (!prerequisite) {
      throw new ExpectedError(
        "startup_prerequisite_not_found",
        "설치 항목 상태를 확인할 수 없습니다.",
        503,
      );
    }
    if (prerequisite.installed) {
      throw new ExpectedError(
        "startup_prerequisite_installed",
        `${prerequisite.label}는 이미 설치되어 있습니다.`,
        409,
      );
    }
    if (!prerequisite.automaticInstall) {
      throw new ExpectedError(
        "startup_manual_install_required",
        prerequisite.automaticInstallUnavailableReason ??
          "터미널에서 설치한 뒤 상태를 다시 확인하십시오.",
        409,
      );
    }
    const operation = enqueue(context, {
      exclusive: true,
      kind: "startup.install",
      locks: ["homebrew"],
      run: (progress) => startup.install(target, progress),
      successMessage: `${target === "docker-with-compose" ? "Docker CLI와 Compose" : prerequisite.label}를 설치했습니다.`,
      target: { name: id, resource: "startup" },
      title: `${target === "docker-with-compose" ? "Docker CLI와 Compose" : prerequisite.label} 설치`,
    });
    return context.json({ operation }, 202);
  });
}
