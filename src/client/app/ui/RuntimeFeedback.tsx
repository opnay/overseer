import { apiRequest, useOperationClient } from "@/shared/api";
import { APP_OPERATION_ROUTES, getAppRoute } from "@/shared/routes";
import type { OperationAccepted } from "@contracts/contracts.ts";
import { Alert } from "@opnay/city-ds-react/alert";
import { Button } from "@opnay/city-ds-react/button";
import { EmptyState } from "@opnay/city-ds-react/empty-state";
import { Container, Download, Layers3, Server } from "lucide-react";
import { runtimePresentation } from "../model/runtime-presentation.ts";
import { useAppSession } from "../runtime/AppSession.tsx";
export function RuntimeFeedback() {
  const {
    dashboard,
    loadError,
    operationError,
    startupError,
    resourcePath,
    refresh,
    refreshStartup,
    selectResourcePath,
    mutate,
  } = useAppSession();
  const { targetBusy } = useOperationClient();
  const runtime = dashboard?.runtime;
  const runtimeStatus = runtime ? runtimePresentation[runtime.phase] : runtimePresentation.error;
  const runtimeRunning = runtime?.phase === "running";
  const dockerComposeAvailable = dashboard?.capabilities?.dockerCompose ?? true;
  const currentRoute = getAppRoute(resourcePath);
  const isOperationsPage = APP_OPERATION_ROUTES.some(({ path }) => path === resourcePath);
  const installCompose = () => {
    window.localStorage.removeItem("overseer-compose-setup");
    return mutate({
      key: "startup-install-compose",
      request: () =>
        apiRequest<OperationAccepted>("/startup/prerequisites/compose/install", { method: "POST" }),
    });
  };
  return (
    <>
      {loadError ? (
        <Alert.Root tone="destructive">
          <Alert.Title level={2}>Overseer에 연결하지 못했습니다.</Alert.Title>
          <Alert.Description>{loadError}</Alert.Description>
          <Alert.Action>
            <Button onClick={() => void refresh()} size="sm" variant="outline">
              다시 시도
            </Button>
          </Alert.Action>
        </Alert.Root>
      ) : null}

      {operationError ? (
        <Alert.Root appearance="subtle" tone="destructive">
          <Alert.Title level={2}>작업을 완료하지 못했습니다.</Alert.Title>
          <Alert.Description>{operationError}</Alert.Description>
        </Alert.Root>
      ) : null}

      {startupError && !runtimeRunning ? (
        <Alert.Root appearance="subtle" tone="destructive">
          <Alert.Title level={2}>필수 도구 상태를 확인하지 못했습니다.</Alert.Title>
          <Alert.Description>{startupError}</Alert.Description>
          <Alert.Action>
            <Button onClick={() => void refreshStartup()} size="sm" variant="outline">
              다시 확인
            </Button>
          </Alert.Action>
        </Alert.Root>
      ) : null}

      {runtime &&
      !runtimeRunning &&
      resourcePath !== "/settings" &&
      resourcePath !== "/docker-plugins" &&
      !resourcePath.startsWith("/image-repositories") &&
      !resourcePath.startsWith("/instances") ? (
        <Alert.Root appearance="subtle" tone={runtimeStatus.tone}>
          <Alert.Title level={2}>Lima · {runtimeStatus.label}</Alert.Title>
          <Alert.Description>
            {runtime.message}
            {runtime.dockerVersion ? ` Docker ${runtime.dockerVersion}` : ""}
          </Alert.Description>
        </Alert.Root>
      ) : null}

      {dashboard &&
      !runtimeRunning &&
      !isOperationsPage &&
      resourcePath !== "/settings" &&
      resourcePath !== "/docker-plugins" &&
      !resourcePath.startsWith("/image-repositories") &&
      !resourcePath.startsWith("/instances") ? (
        <section className="overseer-runtime-empty">
          <EmptyState.Root>
            <EmptyState.Icon>
              <Container aria-hidden="true" />
            </EmptyState.Icon>
            <EmptyState.Title level={2}>
              {runtime?.phase === "missing"
                ? "Lima 환경을 먼저 만드십시오."
                : "Lima 런타임이 준비되지 않았습니다."}
            </EmptyState.Title>
            <EmptyState.Description>
              {runtime?.phase === "missing"
                ? "인스턴스 페이지에서 사용할 Lima VM을 만드십시오."
                : "인스턴스 페이지에서 중지된 VM을 다시 시작할 수 있습니다."}
            </EmptyState.Description>
            <EmptyState.Actions>
              <Button onClick={() => selectResourcePath("/instances")} size="sm">
                <Server aria-hidden="true" size={14} />
                인스턴스 열기
              </Button>
            </EmptyState.Actions>
          </EmptyState.Root>
        </section>
      ) : null}

      {dashboard &&
      runtimeRunning &&
      !dockerComposeAvailable &&
      currentRoute.path === "/compose" ? (
        <section className="overseer-runtime-empty">
          <EmptyState.Root>
            <EmptyState.Icon>
              <Layers3 aria-hidden="true" />
            </EmptyState.Icon>
            <EmptyState.Title level={2}>Docker Compose가 설치되지 않았습니다.</EmptyState.Title>
            <EmptyState.Description>
              Compose 기능은 선택 사항입니다. 사용하려면 Docker Compose 플러그인을 설치하십시오.
            </EmptyState.Description>
            <EmptyState.Actions>
              <Button
                disabled={targetBusy("startup", "compose")}
                onClick={() => void installCompose().catch(() => undefined)}
                size="sm"
              >
                <Download aria-hidden="true" size={14} />
                {targetBusy("startup", "compose") ? "설치 중…" : "Docker Compose 설치"}
              </Button>
            </EmptyState.Actions>
          </EmptyState.Root>
        </section>
      ) : null}
    </>
  );
}
