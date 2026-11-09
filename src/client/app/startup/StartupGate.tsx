import { apiRequest } from "@/shared/api";
import { APP_OPERATION_ROUTES } from "@/shared/routes";
import type {
  DockerEngineConfiguration,
  OperationAccepted,
  StartupInstallTarget,
  StartupPrerequisiteId,
  StartupSnapshot,
  StartupStepId,
} from "@contracts/contracts.ts";
import type { ReactNode } from "react";
import { Suspense, lazy, useEffect, useState } from "react";
import { useAppSession } from "../runtime/AppSession.tsx";
import { LoadingScreen } from "../ui/loading/LoadingScreen.tsx";
const StartupPage = lazy(() =>
  import("@/pages/startup").then((module) => ({ default: module.StartupPage })),
);
type StartupPreview = Exclude<StartupPrerequisiteId, "compose">;

function startupPreviewFromLocation(): StartupPreview | undefined {
  const value = new URLSearchParams(window.location.search).get("startup-preview");
  return value === "homebrew" || value === "docker" || value === "lima" ? value : undefined;
}

const startupPreviewStates: Record<StartupPreview, Record<StartupPrerequisiteId, boolean>> = {
  docker: { compose: false, docker: false, homebrew: true, lima: false },
  homebrew: { compose: false, docker: false, homebrew: false, lima: false },
  lima: { compose: true, docker: true, homebrew: true, lima: false },
};

const startupMissingReasons: Record<StartupPrerequisiteId, string> = {
  compose: "Docker Compose 플러그인을 찾을 수 없습니다.",
  docker: "Docker CLI를 찾을 수 없습니다.",
  homebrew: "Homebrew 실행 파일을 찾을 수 없습니다.",
  lima: "Lima 실행 파일을 찾을 수 없습니다.",
};

function withStartupPreview(snapshot: StartupSnapshot, preview: StartupPreview): StartupSnapshot {
  return {
    prerequisites: snapshot.prerequisites.map((prerequisite) => {
      const installed = startupPreviewStates[preview][prerequisite.id];
      const { missingReason: _missingReason, version, ...rest } = prerequisite;
      return {
        ...rest,
        automaticInstall: prerequisite.id === "homebrew" ? false : preview !== "homebrew",
        ...(preview === "homebrew" && prerequisite.id !== "homebrew"
          ? {
              automaticInstallUnavailableReason: "Homebrew를 먼저 설치해야 합니다.",
            }
          : {}),
        installed,
        ...(installed && version ? { version } : {}),
        ...(!installed ? { missingReason: startupMissingReasons[prerequisite.id] } : {}),
      };
    }),
    ready: false,
  };
}

export function StartupGate({ children }: { children: ReactNode }) {
  const {
    location,
    navigate,
    startupRoute,
    resourcePath,
    selectResourcePath,
    dashboard,
    loadError,
    startup,
    startupError,
    startupRefreshing,
    refreshStartup,
    refresh,
    operations,
    operationError,
    submitting,
    mutate,
    setOperationError,
  } = useAppSession();
  const [startupPreview] = useState(startupPreviewFromLocation);
  const [startupReviewMode, setStartupReviewMode] = useState(startupRoute);
  const [startupOperationId, setStartupOperationId] = useState<string>();
  const [startupStep, setStartupStep] = useState<StartupStepId>();
  const [composeSkipped, setComposeSkipped] = useState(
    () =>
      startupPreview !== "docker" &&
      window.localStorage.getItem("overseer-compose-setup") === "skipped",
  );
  const [engineSetupSkipped, setEngineSetupSkipped] = useState(
    () => window.sessionStorage.getItem("overseer-engine-setup") === "skipped",
  );
  const operationCategory = APP_OPERATION_ROUTES.find(
    ({ path }) => path === resourcePath,
  )?.category;
  const isOperationsPage = operationCategory !== undefined;
  const displayedStartup =
    startup && startupPreview ? withStartupPreview(startup, startupPreview) : startup;
  const firstMissingRequiredPrerequisite = displayedStartup?.prerequisites.find(
    ({ installed, required }) => required && !installed,
  );
  const composePrerequisite = displayedStartup?.prerequisites.find(({ id }) => id === "compose");
  const dockerInstalled = displayedStartup?.prerequisites.find(
    ({ id }) => id === "docker",
  )?.installed;
  const composeDecisionPending = Boolean(
    composePrerequisite &&
    !composePrerequisite.installed &&
    !composeSkipped &&
    (startupRoute || firstMissingRequiredPrerequisite || dashboard?.runtime.phase === "missing") &&
    dockerInstalled &&
    firstMissingRequiredPrerequisite?.id !== "homebrew" &&
    firstMissingRequiredPrerequisite?.id !== "docker",
  );
  const prerequisiteStartupStep = composeDecisionPending
    ? "compose"
    : firstMissingRequiredPrerequisite?.id;
  const detectedStartupStep: StartupStepId | undefined =
    prerequisiteStartupStep ??
    (displayedStartup?.ready &&
    (dashboard?.runtime.phase === "missing" || dashboard?.runtime.phase === "error")
      ? "engine"
      : undefined);
  const requiredStartupStep =
    detectedStartupStep === "engine" && engineSetupSkipped && !startupRoute
      ? undefined
      : detectedStartupStep;
  const engineManagementRoute =
    requiredStartupStep === "engine" &&
    (isOperationsPage ||
      resourcePath === "/settings" ||
      resourcePath === "/docker-plugins" ||
      resourcePath.startsWith("/image-repositories") ||
      resourcePath.startsWith("/instances"));
  const entryStartupStep =
    startupReviewMode && !startupPreview
      ? "homebrew"
      : engineManagementRoute
        ? undefined
        : requiredStartupStep;
  const currentStartupStep = startupStep ?? entryStartupStep;
  const startupVisible = Boolean(displayedStartup && currentStartupStep);
  const startupCheckPending = Boolean(!startup && !startupError);
  const installStartupTarget = (target: StartupInstallTarget) => {
    if (target === "compose" || target === "docker-with-compose") {
      window.localStorage.removeItem("overseer-compose-setup");
      setComposeSkipped(false);
    }
    return mutate({
      key: `startup-install-${target}`,
      onAccepted: (operation) => setStartupOperationId(operation.id),
      request: () =>
        apiRequest<OperationAccepted>(`/startup/prerequisites/${target}/install`, {
          method: "POST",
        }),
    });
  };
  const startDockerEngineForStartup = (configuration?: DockerEngineConfiguration) =>
    mutate({
      key: "runtime-start",
      onAccepted: (operation) => setStartupOperationId(operation.id),
      request: () =>
        apiRequest<OperationAccepted>("/runtime/start", {
          ...(configuration ? { body: JSON.stringify({ configuration }) } : {}),
          method: "POST",
        }),
    });
  const forceRestartDockerEngineForStartup = () =>
    mutate({
      key: "runtime-force-restart",
      onAccepted: (operation) => setStartupOperationId(operation.id),
      request: () =>
        apiRequest<OperationAccepted>("/runtime/force-restart", {
          method: "POST",
        }),
    });
  useEffect(() => {
    if (!startupVisible) return;
    const interval = window.setInterval(() => {
      if (currentStartupStep === "engine") {
        void Promise.all([refreshStartup(), refresh(true)]);
        return;
      }
      void refreshStartup();
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [currentStartupStep, refresh, refreshStartup, startupVisible]);
  useEffect(() => {
    if (startupStep || !entryStartupStep) return;
    setStartupStep(entryStartupStep);
  }, [entryStartupStep, startupStep]);
  useEffect(() => {
    if (
      !displayedStartup ||
      startupRoute ||
      !requiredStartupStep ||
      (requiredStartupStep === "engine" &&
        (isOperationsPage ||
          resourcePath === "/settings" ||
          resourcePath === "/docker-plugins" ||
          resourcePath.startsWith("/image-repositories") ||
          resourcePath.startsWith("/instances")))
    ) {
      return;
    }
    setStartupReviewMode(false);
    void navigate(`/startup${location.search}`, {
      replace: true,
      state: { automaticStartup: true },
    });
  }, [
    displayedStartup,
    isOperationsPage,
    requiredStartupStep,
    resourcePath,
    startupRoute,
    location.search,
    navigate,
  ]);
  useEffect(() => {
    const review = startupRoute && location.state?.automaticStartup !== true;
    setStartupReviewMode(review);
    setStartupOperationId(undefined);
    setStartupStep(review && !startupPreview ? "homebrew" : undefined);
  }, [location, startupRoute, startupPreview]);
  if ((!dashboard && !loadError && !currentStartupStep) || startupCheckPending) {
    return <LoadingScreen path={resourcePath} startup={startupRoute} />;
  }
  if (displayedStartup && currentStartupStep) {
    const startupOperation = startupOperationId
      ? operations.find(({ id }) => id === startupOperationId)
      : undefined;
    const continueStartup = () => {
      if (!currentStartupStep) return;
      setOperationError(undefined);
      setStartupOperationId(undefined);
      if (currentStartupStep === "homebrew") {
        setStartupStep("docker");
        return;
      }
      if (currentStartupStep === "docker") {
        setStartupStep(
          composePrerequisite && !composePrerequisite.installed && !composeSkipped
            ? "compose"
            : "lima",
        );
        return;
      }
      if (currentStartupStep === "compose") {
        setStartupStep("lima");
        return;
      }
      if (currentStartupStep === "lima") {
        setStartupStep("engine");
        return;
      }
      setStartupStep(undefined);
      if (startupRoute) selectResourcePath(resourcePath);
    };
    return (
      <Suspense fallback={<LoadingScreen path={resourcePath} startup />}>
        <StartupPage
          composeSkipped={composeSkipped}
          engineBusy={submitting === "runtime-start" || submitting === "runtime-force-restart"}
          error={startupError ?? operationError ?? (!dashboard ? loadError : undefined)}
          onContinue={continueStartup}
          onForceRestartEngine={forceRestartDockerEngineForStartup}
          onInstall={installStartupTarget}
          onRefresh={async () => {
            setOperationError(undefined);
            if (currentStartupStep === "engine") {
              await Promise.all([refreshStartup(), refresh(true)]);
              return;
            }
            await refreshStartup();
          }}
          onSkipCompose={() => {
            window.localStorage.setItem("overseer-compose-setup", "skipped");
            setComposeSkipped(true);
          }}
          onSkipEngine={() => {
            window.sessionStorage.setItem("overseer-engine-setup", "skipped");
            setEngineSetupSkipped(true);
            setStartupStep(undefined);
            if (startupRoute) selectResourcePath(resourcePath);
          }}
          operation={startupOperation}
          preview={Boolean(startupPreview)}
          refreshing={startupRefreshing}
          runtime={
            dashboard?.runtime ?? {
              instance: "-",
              message: loadError ?? "런타임 상태를 확인하고 있습니다.",
              phase: "error",
            }
          }
          snapshot={displayedStartup}
          onStartEngine={startDockerEngineForStartup}
          step={currentStartupStep}
        />
      </Suspense>
    );
  }
  return children;
}
