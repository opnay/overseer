import { Alert } from "@opnay/city-ds-react/alert";
import { Badge } from "@opnay/city-ds-react/badge";
import { Button } from "@opnay/city-ds-react/button";
import { DataTableRegion } from "@opnay/city-ds-react/data-table-region";
import { Meter } from "@opnay/city-ds-react/meter";
import { Select } from "@opnay/city-ds-react/select";
import { Skeleton } from "@opnay/city-ds-react/skeleton";
import { Table } from "@opnay/city-ds-react/table";
import { Tooltip } from "@opnay/city-ds-react/tooltip";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Fragment, useState } from "react";
import type { BuildStep, BuildStepsResponse } from "@contracts/builds.ts";
import { LogViewer } from "@/shared/ui/log-viewer";
import {
  buildStatusPresentation,
  formatBuildDuration,
  type BuildRequestState,
} from "../model/build-history.ts";

type StepFilter = "all" | "failed" | "cached";
type StepOrder = "build" | "duration";

const filterOptions = [
  { label: "모든 단계", value: "all" },
  { label: "실패 단계", value: "failed" },
  { label: "캐시 단계", value: "cached" },
] as const;

const orderOptions = [
  { label: "빌드 순서", value: "build" },
  { label: "시간 긴 순", value: "duration" },
] as const;

function isKnownDuration(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

function StepStatusBadge({ status }: { status: BuildStep["status"] }) {
  const presentation =
    status === "failed"
      ? buildStatusPresentation.failed
      : status === "running"
        ? buildStatusPresentation.running
        : status === "succeeded"
          ? buildStatusPresentation.succeeded
          : buildStatusPresentation.unknown;

  return (
    <Badge appearance="subtle" size="sm" tone={presentation.tone}>
      {status === "pending" ? "대기" : presentation.label}
    </Badge>
  );
}

function StepSelect({
  ariaLabel,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  onChange(value: string): void;
  options: ReadonlyArray<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <Select.Root
      items={Object.fromEntries(
        options.map(({ label, value: optionValue }) => [optionValue, label]),
      )}
      onValueChange={(nextValue) => nextValue && onChange(String(nextValue))}
      size="sm"
      value={value}
    >
      <Select.Trigger aria-label={ariaLabel}>
        <Select.Value />
        <Select.Icon />
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner>
          <Select.Popup>
            <Select.List>
              {options.map((option) => (
                <Select.Item key={option.value} value={option.value}>
                  <Select.ItemIndicator />
                  <Select.ItemText>{option.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

function StepOutputButton({
  expanded,
  onClick,
  step,
}: {
  expanded: boolean;
  onClick(): void;
  step: BuildStep;
}) {
  const label = `${step.name} 출력 ${expanded ? "접기" : "펼치기"}`;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        render={
          <Button
            aria-label={label}
            aria-pressed={expanded}
            iconOnly
            onClick={onClick}
            size="sm"
            variant="ghost"
          />
        }
      >
        {expanded ? (
          <ChevronUp aria-hidden="true" size={14} />
        ) : (
          <ChevronDown aria-hidden="true" size={14} />
        )}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="top" sideOffset={6}>
          <Tooltip.Popup>{label}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function StepDuration({ maxDuration, step }: { maxDuration: number; step: BuildStep }) {
  if (!isKnownDuration(step.durationMs)) return <span>—</span>;

  return (
    <div className="overseer-build-step-duration">
      <span>
        {formatBuildDuration({ durationMs: step.durationMs, startedAt: step.startedAt ?? "" })}
      </span>
      {maxDuration > 0 ? (
        <Meter.Root
          aria-label={`${step.name} 단계 상대 소요 시간`}
          getAriaValueText={(_formattedValue, value) =>
            `${formatBuildDuration({ durationMs: value, startedAt: "" })}`
          }
          max={maxDuration}
          size="sm"
          value={step.durationMs}
        >
          <Meter.Track>
            <Meter.Indicator />
          </Meter.Track>
        </Meter.Root>
      ) : null}
    </div>
  );
}

function StepOutput({ step }: { step: BuildStep }) {
  return (
    <div className="overseer-build-step-output">
      {step.error ? (
        <Alert.Root tone="destructive">
          <Alert.Title level={3}>단계 오류</Alert.Title>
          <Alert.Description>{step.error}</Alert.Description>
        </Alert.Root>
      ) : null}
      <LogViewer
        ariaLabel={`${step.name} 단계 출력`}
        emptyMessage="이 단계의 출력이 없습니다."
        height="default"
        value={step.log}
      />
      {step.logTruncated ? (
        <p className="city-text-supporting">표시 길이 제한으로 출력의 일부만 보여줍니다.</p>
      ) : null}
    </div>
  );
}

function LoadingSteps() {
  return (
    <section aria-label="빌드 단계 불러오는 중" className="overseer-detail-loading">
      <Skeleton />
      <Skeleton className="overseer-loading-table" />
    </section>
  );
}

export function BuildAnalysisSection({
  onRetry,
  state,
}: {
  onRetry(): void;
  state?: BuildRequestState<BuildStepsResponse>;
}) {
  const [filter, setFilter] = useState<StepFilter>("all");
  const [order, setOrder] = useState<StepOrder>("build");
  const [expandedStepId, setExpandedStepId] = useState<string>();

  if (!state?.data && state?.loading !== false) return <LoadingSteps />;

  if (!state?.data && state?.error?.code === "build_running") {
    return (
      <Alert.Root tone="info">
        <Alert.Title level={2}>진행 중인 빌드의 단계 기록은 제공되지 않습니다.</Alert.Title>
        <Alert.Description>빌드가 완료된 뒤 단계와 출력을 확인해 주세요.</Alert.Description>
      </Alert.Root>
    );
  }

  if (!state?.data && state?.error) {
    return (
      <Alert.Root tone="destructive">
        <Alert.Title level={2}>빌드 단계 정보를 불러오지 못했습니다.</Alert.Title>
        <Alert.Description>{state.error.message}</Alert.Description>
        <Alert.Action>
          <Button onClick={onRetry} size="sm" variant="outline">
            다시 시도
          </Button>
        </Alert.Action>
      </Alert.Root>
    );
  }

  if (!state?.data) return <LoadingSteps />;

  const steps = state.data.steps;
  const failedSteps = steps.filter((step) => step.status === "failed");
  const maxDuration = Math.max(0, ...steps.map((step) => step.durationMs).filter(isKnownDuration));
  const visibleSteps = steps.filter((step) => {
    if (filter === "failed") return step.status === "failed";
    if (filter === "cached") return step.cached;
    return true;
  });
  const orderedSteps =
    order === "duration"
      ? [...visibleSteps].sort(
          (left, right) =>
            (isKnownDuration(right.durationMs) ? right.durationMs : -1) -
            (isKnownDuration(left.durationMs) ? left.durationMs : -1),
        )
      : visibleSteps;

  function jumpToFailedStep(step: BuildStep) {
    setFilter("all");
    setOrder("build");
    setExpandedStepId(step.id);
    window.setTimeout(() => {
      const target = document.getElementById(`build-step-${encodeURIComponent(step.id)}`);
      target?.scrollIntoView?.({ block: "center" });
      target?.focus();
    }, 0);
  }

  return (
    <section
      aria-busy={state.loading || undefined}
      aria-label="빌드 단계 분석"
      className="overseer-detail-section"
    >
      {state.error ? (
        <Alert.Root tone="warning">
          <Alert.Title level={2}>새 단계 기록을 불러오지 못했습니다.</Alert.Title>
          <Alert.Description>
            {state.error.message} 이전에 불러온 기록을 표시합니다.
          </Alert.Description>
          <Alert.Action>
            <Button onClick={onRetry} size="sm" variant="outline">
              다시 시도
            </Button>
          </Alert.Action>
        </Alert.Root>
      ) : null}
      {failedSteps.length > 0 ? (
        <Alert.Root tone="destructive">
          <Alert.Title level={2}>실패한 단계 {failedSteps.length}개</Alert.Title>
          <Alert.Description>실패한 단계를 선택하면 오류와 단계 출력을 펼칩니다.</Alert.Description>
          <ul className="grid gap-1">
            {failedSteps.map((step) => (
              <li key={step.id}>
                <Button onClick={() => jumpToFailedStep(step)} size="sm" variant="outline">
                  {step.name} 보기
                </Button>
              </li>
            ))}
          </ul>
        </Alert.Root>
      ) : null}
      <header>
        <div>
          <h3 className="city-text-subsection-title">단계 기록</h3>
          <p>
            단계 시간은 서로 겹칠 수 있습니다. 캐시 단계 수는 절약된 시간으로 환산하지 않습니다.
          </p>
        </div>
        <div className="overseer-build-step-controls">
          <StepSelect
            ariaLabel="단계 필터"
            onChange={(value) => setFilter(value as StepFilter)}
            options={filterOptions}
            value={filter}
          />
          <StepSelect
            ariaLabel="단계 정렬"
            onChange={(value) => setOrder(value as StepOrder)}
            options={orderOptions}
            value={order}
          />
        </div>
      </header>
      {steps.length === 0 ? (
        <p className="overseer-detail-empty-copy">기록된 빌드 단계가 없습니다.</p>
      ) : orderedSteps.length === 0 ? (
        <p className="overseer-detail-empty-copy">선택한 조건에 맞는 단계가 없습니다.</p>
      ) : (
        <DataTableRegion className="overseer-data-table-region" label="빌드 단계 표">
          <Table.Root
            aria-label="빌드 단계"
            className="overseer-table overseer-build-steps-table"
            size="sm"
          >
            <Table.Caption className="overseer-table-caption">
              느린 단계 막대는 기록된 단계 시간의 상대 비교입니다.
            </Table.Caption>
            <Table.Header>
              <Table.Row>
                <Table.Head>단계</Table.Head>
                <Table.Head>상태</Table.Head>
                <Table.Head>소요 시간</Table.Head>
                <Table.Head>캐시</Table.Head>
                <Table.Head>출력</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {orderedSteps.map((step) => {
                const expanded = expandedStepId === step.id;
                const rowId = `build-step-${encodeURIComponent(step.id)}`;
                return (
                  <Fragment key={step.id}>
                    <Table.Row id={rowId} tabIndex={-1}>
                      <Table.Cell className="overseer-table-column-wide overseer-build-step-name">
                        {step.name}
                      </Table.Cell>
                      <Table.Cell>
                        <StepStatusBadge status={step.status} />
                      </Table.Cell>
                      <Table.Cell>
                        <StepDuration maxDuration={maxDuration} step={step} />
                      </Table.Cell>
                      <Table.Cell>{step.cached ? "캐시" : "미사용"}</Table.Cell>
                      <Table.Cell>
                        <StepOutputButton
                          expanded={expanded}
                          onClick={() => setExpandedStepId(expanded ? undefined : step.id)}
                          step={step}
                        />
                      </Table.Cell>
                    </Table.Row>
                    {expanded ? (
                      <Table.Row>
                        <Table.Cell colSpan={5}>
                          <StepOutput step={step} />
                        </Table.Cell>
                      </Table.Row>
                    ) : null}
                  </Fragment>
                );
              })}
            </Table.Body>
          </Table.Root>
        </DataTableRegion>
      )}
    </section>
  );
}
