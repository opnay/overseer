import { Button } from "@opnay/city-ds-react/button";
import { Menu } from "@opnay/city-ds-react/menu";
import { SlidersHorizontal } from "lucide-react";
import { Fragment, useState, type ReactNode, type Ref } from "react";

export type LogFontSize = "large" | "medium" | "small";

export const DEFAULT_LOG_FONT_SIZE: LogFontSize = "medium";
export type LogViewerHeight = "compact" | "default" | "expanded";

const fontSizes: Array<{ label: string; value: LogFontSize }> = [
  { label: "작게", value: "small" },
  { label: "보통", value: "medium" },
  { label: "크게", value: "large" },
];

export function LogDisplayOptions({
  fontSize,
  onFontSizeChange,
  onShowLineNumbersChange,
  onWrappedChange,
  showLineNumbers,
  wrapped,
}: {
  fontSize: LogFontSize;
  onFontSizeChange(value: LogFontSize): void;
  onShowLineNumbersChange(value: boolean): void;
  onWrappedChange(value: boolean): void;
  showLineNumbers: boolean;
  wrapped: boolean;
}) {
  return (
    <Menu.Root density="compact">
      <Menu.Trigger render={<Button aria-label="로그 옵션" iconOnly size="sm" variant="ghost" />}>
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
  height = "default",
  loading = false,
  loadingMessage = "출력을 불러오는 중…",
  scrollRef,
  value,
}: {
  actions?: ReactNode;
  ariaLabel: string;
  context?: ReactNode;
  emptyMessage?: string;
  height?: LogViewerHeight;
  loading?: boolean;
  loadingMessage?: string;
  scrollRef?: Ref<HTMLPreElement>;
  value: string;
}) {
  const [fontSize, setFontSize] = useState<LogFontSize>(DEFAULT_LOG_FONT_SIZE);
  const [showLineNumbers, setShowLineNumbers] = useState(false);
  const [wrapped, setWrapped] = useState(false);

  return (
    <section
      aria-busy={loading}
      aria-label={ariaLabel}
      className="overseer-log-viewer"
      data-height={height}
    >
      <div className="overseer-log-viewer-toolbar">
        {context ? <div className="overseer-log-viewer-context">{context}</div> : null}
        <div className="overseer-log-viewer-actions">
          {actions}
          <LogDisplayOptions
            fontSize={fontSize}
            onFontSizeChange={setFontSize}
            onShowLineNumbersChange={setShowLineNumbers}
            onWrappedChange={setWrapped}
            showLineNumbers={showLineNumbers}
            wrapped={wrapped}
          />
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
          ref={scrollRef}
          tabIndex={0}
        >
          <LogCodeContent showLineNumbers={showLineNumbers} value={value} />
        </pre>
      ) : (
        <div className="overseer-log-viewer-empty">{emptyMessage}</div>
      )}
    </section>
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
