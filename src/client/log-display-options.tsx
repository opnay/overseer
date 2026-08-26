import { Button } from "@opnay/city-ds-react/button";
import { Dialog } from "@opnay/city-ds-react/dialog";
import { Menu } from "@opnay/city-ds-react/menu";
import { Tooltip } from "@opnay/city-ds-react/tooltip";
import { Maximize2, SlidersHorizontal } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode, type Ref } from "react";

export type LogFontSize = "large" | "medium" | "small";

export const DEFAULT_LOG_FONT_SIZE: LogFontSize = "medium";
export type LogViewerHeight = "compact" | "default" | "expanded";

const fontSizes: Array<{ label: string; value: LogFontSize }> = [
  { label: "작게", value: "small" },
  { label: "보통", value: "medium" },
  { label: "크게", value: "large" },
];

export function LogDisplayOptions({
  ariaLabel = "로그 옵션",
  fontSize,
  onFontSizeChange,
  onShowLineNumbersChange,
  onWrappedChange,
  showLineNumbers,
  wrapped,
}: {
  ariaLabel?: string;
  fontSize: LogFontSize;
  onFontSizeChange(value: LogFontSize): void;
  onShowLineNumbersChange(value: boolean): void;
  onWrappedChange(value: boolean): void;
  showLineNumbers: boolean;
  wrapped: boolean;
}) {
  return (
    <Menu.Root density="compact">
      <Menu.Trigger render={<Button aria-label={ariaLabel} iconOnly size="sm" variant="ghost" />}>
        <SlidersHorizontal aria-hidden="true" size={14} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={6}>
          <Menu.Popup>
            <Menu.Group>
              <Menu.GroupLabel>표시</Menu.GroupLabel>
              <Menu.CheckboxItem
                checked={wrapped}
                onCheckedChange={(checked) => onWrappedChange(checked === true)}
              >
                <Menu.CheckboxItemIndicator />
                줄 바꿈
              </Menu.CheckboxItem>
              <Menu.CheckboxItem
                checked={showLineNumbers}
                onCheckedChange={(checked) => onShowLineNumbersChange(checked === true)}
              >
                <Menu.CheckboxItemIndicator />
                줄 번호
              </Menu.CheckboxItem>
            </Menu.Group>
            <Menu.Separator />
            <Menu.Group>
              <Menu.GroupLabel>폰트 크기</Menu.GroupLabel>
              <Menu.RadioGroup
                onValueChange={(value) => onFontSizeChange(value as LogFontSize)}
                value={fontSize}
              >
                {fontSizes.map((option) => (
                  <Menu.RadioItem key={option.value} value={option.value}>
                    <Menu.RadioItemIndicator />
                    {option.label}
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
            </Menu.Group>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function LogViewer({
  actions,
  ariaLabel,
  context,
  emptyMessage = "기록된 출력이 없습니다.",
  followOutput = false,
  height = "default",
  loading = false,
  loadingMessage = "출력을 불러오는 중…",
  optionsLabel = "로그 옵션",
  scrollRef,
  value,
}: {
  actions?: ReactNode;
  ariaLabel: string;
  context?: ReactNode;
  emptyMessage?: string;
  followOutput?: boolean;
  height?: LogViewerHeight;
  loading?: boolean;
  loadingMessage?: string;
  optionsLabel?: string;
  scrollRef?: Ref<HTMLPreElement>;
  value: string;
}) {
  const [fontSize, setFontSize] = useState<LogFontSize>(DEFAULT_LOG_FONT_SIZE);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState(false);
  const [wrapped, setWrapped] = useState(false);
  const followScrollRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!followOutput || !followScrollRef.current) return;
    followScrollRef.current.scrollTop = followScrollRef.current.scrollHeight;
  }, [followOutput, fullscreenOpen, value]);

  const renderViewer = (fullscreen = false) => (
    <section
      aria-busy={loading}
      aria-label={fullscreen ? `${ariaLabel} 전체 화면` : ariaLabel}
      className="overseer-log-viewer"
      data-fullscreen={fullscreen ? "true" : undefined}
      data-height={height}
    >
      <div className="overseer-log-viewer-toolbar">
        {context ? <div className="overseer-log-viewer-context">{context}</div> : null}
        <div className="overseer-log-viewer-actions">
          {actions}
          <LogDisplayOptions
            ariaLabel={optionsLabel}
            fontSize={fontSize}
            onFontSizeChange={setFontSize}
            onShowLineNumbersChange={setShowLineNumbers}
            onWrappedChange={setWrapped}
            showLineNumbers={showLineNumbers}
            wrapped={wrapped}
          />
          {!fullscreen ? (
            <Tooltip.Root>
              <Tooltip.Trigger
                render={
                  <Dialog.Trigger
                    render={<Button aria-label="크게 보기" iconOnly size="sm" variant="ghost" />}
                  >
                    <Maximize2 aria-hidden="true" size={14} />
                  </Dialog.Trigger>
                }
              />
              <Tooltip.Portal>
                <Tooltip.Positioner align="end" side="top" sideOffset={6}>
                  <Tooltip.Popup>크게 보기</Tooltip.Popup>
                </Tooltip.Positioner>
              </Tooltip.Portal>
            </Tooltip.Root>
          ) : null}
        </div>
      </div>
      {loading && !value ? (
        <div className="overseer-log-viewer-empty" role="status">
          {loadingMessage}
        </div>
      ) : value ? (
        <pre
          className="overseer-log-viewer-code"
          data-font-size={fontSize}
          data-line-numbers={showLineNumbers}
          data-wrap={wrapped}
          ref={
            followOutput ? followScrollRef : fullscreen === fullscreenOpen ? scrollRef : undefined
          }
          tabIndex={0}
        >
          <LogCodeContent showLineNumbers={showLineNumbers} value={value} />
        </pre>
      ) : (
        <div className="overseer-log-viewer-empty">{emptyMessage}</div>
      )}
    </section>
  );

  return (
    <Dialog.Root onOpenChange={setFullscreenOpen} open={fullscreenOpen}>
      {renderViewer()}
      <Dialog.Portal>
        <Dialog.Backdrop className="overseer-log-viewer-fullscreen-backdrop" />
        <Dialog.Viewport className="overseer-log-viewer-fullscreen-viewport">
          <Dialog.Popup className="overseer-log-viewer-fullscreen-dialog" scroll="body" size="full">
            <Dialog.Header>
              <div>
                <Dialog.Title>{ariaLabel}</Dialog.Title>
                <Dialog.Description>로그를 창 전체에서 확인합니다.</Dialog.Description>
              </div>
            </Dialog.Header>
            <Dialog.Body className="overseer-log-viewer-fullscreen-body">
              {renderViewer(true)}
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

export function LogCodeContent({
  showLineNumbers,
  value,
}: {
  showLineNumbers: boolean;
  value: string;
}) {
  if (!showLineNumbers) return <code>{value}</code>;

  const lines = value.split(/\r?\n/);
  return (
    <code className="overseer-log-code-lines">
      {lines.map((line, index) => (
        <Fragment key={`${index}-${line.slice(0, 24)}`}>
          <span className="overseer-log-code-line">
            <span className="overseer-log-code-line-content">{line || " "}</span>
          </span>
          {index < lines.length - 1 ? "\n" : null}
        </Fragment>
      ))}
    </code>
  );
}
