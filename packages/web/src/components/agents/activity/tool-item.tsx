// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/agents/ui/AgentSessionToolItem/ToolItem.tsx, CompactToolSummaryRow.tsx. Modified.
import * as React from "react";

import {
  CheckIcon,
  CloseIcon,
  FileEditIcon,
  FileSearchIcon,
  GlobeIcon,
  LoaderIcon,
  SearchIcon,
  TerminalIcon,
  WarningIcon,
} from "@/components/icons";
import { buildToolSummary, isToolRunning } from "@/lib/agent-activity/tool-summary";
import { formatDuration } from "@/lib/time";
import type { ToolTranscriptItem } from "@/model/agent-activity";
import { ActivityRow, ActivityRowContent, ActivityRowLabel } from "./activity-row";
import { ToolDetailBlocks } from "./tool-detail-blocks";

const STALL_THRESHOLD_MS = 5 * 60 * 1000;
const STALL_TICK_MS = 30 * 1000;

const KIND_ICONS: Record<string, typeof TerminalIcon> = {
  edit: FileEditIcon,
  delete: FileEditIcon,
  move: FileEditIcon,
  read: FileSearchIcon,
  search: SearchIcon,
  fetch: GlobeIcon,
};

/**
 * Re-renders periodically while a tool call could still turn "stalled". Stops
 * once the call resolves.
 */
function useStalenessTick(active: boolean): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), STALL_TICK_MS);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function StatusMark({ status }: { status: ToolTranscriptItem["status"] | "stalled" }) {
  switch (status) {
    case "completed":
      return <CheckIcon aria-label="completed" className="size-3.5 shrink-0 text-accent-success" />;
    case "failed":
      return <CloseIcon aria-label="failed" className="size-3.5 shrink-0 text-accent-danger" />;
    case "stalled":
      return <WarningIcon aria-label="stalled" className="size-3.5 shrink-0 text-accent-warning" />;
    default:
      return <LoaderIcon aria-label="running" className="size-3.5 shrink-0 animate-spin text-text-tertiary" />;
  }
}

/** One tool call: a summary line that expands to its input, diff and output. */
export function ToolItem({ item }: { item: ToolTranscriptItem }) {
  const summary = buildToolSummary(item);
  const running = isToolRunning(item);
  const now = useStalenessTick(running);
  const stalled = running && now - item.lastActivityAt > STALL_THRESHOLD_MS;
  const Icon = KIND_ICONS[item.toolKind] ?? TerminalIcon;
  const took = running ? 0 : item.lastActivityAt - item.startedAt;
  return (
    <ActivityRow testId="transcript-tool-item" title={summary.objectTitle ?? undefined}>
      <Icon className="size-3.5 shrink-0 text-text-tertiary" />
      <ActivityRowLabel verb={summary.verb} object={summary.object} stats={summary.stats} />
      <StatusMark status={stalled ? "stalled" : item.status} />
      {took >= 1000 ? <span className="shrink-0 text-caption1 text-text-tertiary">{formatDuration(took)}</span> : null}
      <ActivityRowContent>
        <ToolDetailBlocks item={item} summary={summary} stalled={stalled} />
      </ActivityRowContent>
    </ActivityRow>
  );
}
