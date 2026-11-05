import { Alert } from "@opnay/city-ds-react/alert";
import { Button } from "@opnay/city-ds-react/button";
import { Item } from "@opnay/city-ds-react/item";
import { Progress } from "@opnay/city-ds-react/progress";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import {
  checkAppUpdate,
  installAppUpdate,
  readAppVersion,
  supportsAppUpdates,
  type AppUpdateCheck,
  type AppUpdateProgress,
} from "../api/app-updates.ts";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function AppUpdateSettings() {
  const desktop = supportsAppUpdates();
  const [version, setVersion] = useState<string>();
  const [result, setResult] = useState<AppUpdateCheck>();
  const [phase, setPhase] = useState<"idle" | "checking" | "installing">("idle");
  const [progress, setProgress] = useState<AppUpdateProgress>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    readAppVersion().then(
      (value) => {
        if (!cancelled) setVersion(value);
      },
      (reason) => {
        if (!cancelled) setError(errorMessage(reason));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  const check = async () => {
    setPhase("checking");
    setError(undefined);
    setResult(undefined);
    try {
      const next = await checkAppUpdate();
      setVersion(next.currentVersion);
      setResult(next);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setPhase("idle");
    }
  };

  const install = async () => {
    setPhase("installing");
    setError(undefined);
    setProgress({ state: "downloading", downloaded: 0, total: null });
    try {
      await installAppUpdate(setProgress);
    } catch (reason) {
      setError(errorMessage(reason));
      setProgress(undefined);
      setPhase("idle");
    }
  };

  const percentage =
    progress?.state === "downloading" && progress.total
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null;
  const progressLabel =
    progress?.state === "installing"
      ? "업데이트 서명을 확인하고 설치하고 있습니다."
      : progress?.state === "restarting"
        ? "설치를 마쳤습니다. 앱을 다시 시작하고 있습니다."
        : "업데이트를 다운로드하고 있습니다.";

  return (
    <Item.Root
      appearance="outline"
      aria-labelledby="overseer-settings-updates"
      className="overseer-settings-general-section bg-city-surface-raised p-5"
      render={<section />}
    >
      <Item.Media
        aria-hidden="true"
        variant="icon"
        className="size-(--city-control-lg) rounded-city-sm bg-city-muted text-city-muted-foreground"
      >
        <Download size={18} strokeWidth={1.8} />
      </Item.Media>
      <Item.Content>
        <Item.Title
          render={<h2 className="city-text-subsection-title" />}
          id="overseer-settings-updates"
        >
          업데이트 관리
        </Item.Title>
        <Item.Description>
          {desktop
            ? `현재 버전 ${version ?? "확인 중…"}`
            : "업데이트는 설치한 데스크톱 앱에서 사용할 수 있습니다."}
        </Item.Description>
        <div aria-live="polite" className="flex flex-col gap-3">
          {result?.version ? (
            <>
              <p>새 버전 {result.version}을 설치할 수 있습니다.</p>
              {result.notes ? (
                <p className="whitespace-pre-wrap text-city-muted-foreground">{result.notes}</p>
              ) : null}
            </>
          ) : result ? (
            <p>최신 버전입니다.</p>
          ) : null}
          {progress ? (
            <div className="flex flex-col gap-2">
              <p>{progressLabel}</p>
              <Progress.Root aria-label="앱 업데이트 진행률" value={percentage}>
                <Progress.Track>
                  <Progress.Indicator />
                </Progress.Track>
              </Progress.Root>
              <p className="text-city-muted-foreground">
                업데이트 중에는 새 작업을 시작할 수 없습니다. 설치 후 앱이 다시 실행됩니다.
              </p>
            </div>
          ) : null}
          {error ? (
            <Alert.Root tone="destructive">
              <Alert.Title level={3}>업데이트를 완료하지 못했습니다.</Alert.Title>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Root>
          ) : null}
        </div>
      </Item.Content>
      <Item.Actions>
        <Button
          disabled={!desktop || phase !== "idle"}
          onClick={() => void check()}
          variant="outline"
        >
          {phase === "checking" ? "업데이트 확인 중…" : "업데이트 확인"}
        </Button>
        {result?.version ? (
          <Button disabled={phase !== "idle"} onClick={() => void install()}>
            {phase === "installing" ? "업데이트 중…" : "업데이트 설치"}
          </Button>
        ) : null}
      </Item.Actions>
    </Item.Root>
  );
}
