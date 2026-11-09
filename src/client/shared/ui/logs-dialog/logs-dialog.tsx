import { apiRequest } from "@/shared/api";
import { LogViewer } from "@/shared/ui/log-viewer";
import { Alert } from "@opnay/city-ds-react/alert";
import { Button } from "@opnay/city-ds-react/button";
import { Dialog } from "@opnay/city-ds-react/dialog";
import { Toolbar } from "@opnay/city-ds-react/toolbar";
import { ArrowDownToLine, Check, Copy, Radio, RefreshCw, Terminal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface LogsTarget {
  description: string;
  requestPath: string;
  title: string;
}

export function LogsDialog({ onClose, target }: { onClose: () => void; target?: LogsTarget }) {
  const [logs, setLogs] = useState("");
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [following, setFollowing] = useState(true);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLPreElement>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!target) return;
      if (!quiet) setLoading(true);
      setError(undefined);
      try {
        const result = await apiRequest<{ logs: string }>(target.requestPath);
        setLogs(result.logs);
      } catch (loadError) {
        setError(actionError(loadError));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [target],
  );

  useEffect(() => {
    setLogs("");
    setError(undefined);
    setFollowing(true);
    setCopied(false);
    if (target) void load();
  }, [target, load]);

  useEffect(() => {
    if (!target || !following) return;
    const interval = window.setInterval(() => void load(true), 3_000);
    return () => window.clearInterval(interval);
  }, [following, load, target]);

  useEffect(() => {
    if (!following || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [following, logs]);

  const copyLogs = async () => {
    if (!logs || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(logs);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  const lines = logs ? logs.split(/\r?\n/) : [];

  return (
    <Dialog.Root onOpenChange={(open) => !open && onClose()} open={Boolean(target)}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        <Dialog.Viewport>
          <Dialog.Popup size="xl">
            <Dialog.Header>
              <div>
                <Dialog.Title>{target?.title}</Dialog.Title>
                <Dialog.Description>{target?.description}</Dialog.Description>
              </div>
            </Dialog.Header>
            <Dialog.Body className="overseer-log-stack">
              {error ? (
                <Alert.Root tone="destructive">
                  <Alert.Title level={3}>로그를 불러오지 못했습니다.</Alert.Title>
                  <Alert.Description>{error}</Alert.Description>
                </Alert.Root>
              ) : null}
              <LogViewer
                actions={
                  <Toolbar.Root appearance="plain" aria-label="로그 명령" size="sm">
                    <Toolbar.Button
                      disabled={!logs}
                      onClick={() => void copyLogs()}
                      variant="ghost"
                    >
                      {copied ? (
                        <Check aria-hidden="true" size={14} />
                      ) : (
                        <Copy aria-hidden="true" size={14} />
                      )}
                      {copied ? "복사됨" : "복사"}
                    </Toolbar.Button>
                    <Toolbar.Button
                      disabled={!logs}
                      onClick={() => {
                        if (scrollRef.current) {
                          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                        }
                      }}
                      variant="ghost"
                    >
                      <ArrowDownToLine aria-hidden="true" size={14} />
                      맨 아래
                    </Toolbar.Button>
                    <Toolbar.Toggle
                      aria-label={following ? "자동 갱신 켜짐" : "자동 갱신 꺼짐"}
                      onPressedChange={setFollowing}
                      pressed={following}
                      variant="ghost"
                    >
                      <Radio aria-hidden="true" size={14} />
                      자동 갱신
                    </Toolbar.Toggle>
                    <Toolbar.Button disabled={loading} onClick={() => void load()} variant="ghost">
                      <RefreshCw aria-hidden="true" size={14} />
                      새로고침
                    </Toolbar.Button>
                  </Toolbar.Root>
                }
                ariaLabel={`${target?.title} 터미널`}
                context={
                  <>
                    <Terminal aria-hidden="true" size={14} />
                    <code>tail -n 300</code>
                    <span aria-live="polite">{loading ? "동기화 중…" : `${lines.length}줄`}</span>
                  </>
                }
                emptyMessage="출력된 로그가 없습니다."
                height="expanded"
                key={target?.requestPath ?? "empty-log"}
                loading={loading}
                loadingMessage="로그를 불러오는 중…"
                scrollRef={scrollRef}
                value={logs}
              />
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.Close render={<Button variant="outline" />}>닫기</Dialog.Close>
            </Dialog.Footer>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function actionError(error: unknown): string {
  return error instanceof Error ? error.message : "요청을 완료하지 못했습니다.";
}
