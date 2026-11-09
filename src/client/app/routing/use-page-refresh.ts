import { getAppDetailLocation, type AppLocationPath } from "@/shared/routes";
import type { OperationSnapshot } from "@contracts/contracts.ts";
import { useState } from "react";

export function usePageRefresh(resourcePath: AppLocationPath, operations: OperationSnapshot[]) {
  const currentDetail = getAppDetailLocation(resourcePath);
  const [operationsRefreshRevision, setOperationsRefreshRevision] = useState(0);
  const [detailRefreshRevision, setDetailRefreshRevision] = useState(0);
  const [settingsRefreshRevision, setSettingsRefreshRevision] = useState(0);
  const latestFinishedRuntimeOperation = operations.find(
    ({ status, target }) =>
      target.resource === "runtime" && status !== "queued" && status !== "running",
  );
  const settingsRefreshToken = `${settingsRefreshRevision}:${latestFinishedRuntimeOperation?.id ?? ""}:${latestFinishedRuntimeOperation?.status ?? ""}`;
  const detailOperationResource =
    currentDetail?.type === "instance" ? "runtime" : currentDetail?.type;
  const latestFinishedDetailOperation = currentDetail
    ? operations.find(
        ({ status, target }) =>
          target.resource === detailOperationResource &&
          status !== "queued" &&
          status !== "running" &&
          (target.id === currentDetail.identifier || target.name === currentDetail.identifier),
      )
    : undefined;
  const detailRefreshToken = `${detailRefreshRevision}:${latestFinishedDetailOperation?.id ?? ""}:${latestFinishedDetailOperation?.status ?? ""}`;
  return {
    operationsRefreshRevision,
    setOperationsRefreshRevision,
    settingsRefreshRevision,
    setSettingsRefreshRevision,
    setDetailRefreshRevision,
    settingsRefreshToken,
    detailRefreshToken,
  };
}
