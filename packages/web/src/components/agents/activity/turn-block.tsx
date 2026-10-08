// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/agents/ui/AgentSessionTranscriptList.tsx. Modified.
import { UserAvatar } from "@/components/user-avatar";
import { formatDuration } from "@/lib/time";
import type { AgentTurn } from "@/model/agent-activity";
import { TurnLivenessIndicator } from "../turn-liveness";
import { ActivityRow, ActivityRowContent } from "./activity-row";
import { PlanActivity } from "./plan-activity";
import { ToolItem } from "./tool-item";

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * One agent turn in a timeline or thread: "Coder · Payments used 6 tools · 42s",
 * expanding to every tool call and plan update. Open while the turn runs,
 * collapsed once it ends.
 */
export function TurnBlock({ turn }: { turn: AgentTurn }) {
  const running = turn.endedAt === null;
  const tools = turn.items.filter((i) => i.type === "tool").length;
  const did = running
    ? tools > 0
      ? `is working · ${plural(tools, "tool")}`
      : "is working"
    : tools > 0
      ? `used ${plural(tools, "tool")}`
      : "updated the plan";
  return (
    <ActivityRow
      // Remount when the turn ends, so it collapses.
      key={running ? "running" : "ended"}
      className="rounded-card border border-surface-border-primary bg-surface-secondary px-2.5 py-1.5"
      defaultOpen={running}
      testId="agent-turn"
    >
      <UserAvatar userId={turn.agent.id} size="xs" />
      <span className="min-w-0 truncate text-body2">
        <span className="font-semibold text-text-primary">
          {turn.agent.displayName}
        </span>{" "}
        {did}
      </span>
      {running ? (
        <TurnLivenessIndicator />
      ) : (
        <span className="shrink-0 text-caption1 text-text-tertiary">
          · {formatDuration(turn.endedAt! - turn.startedAt)}
        </span>
      )}
      <span className="flex-1" />
      <ActivityRowContent className="mt-1.5 flex flex-col gap-0.5 border-l-2 border-surface-border-primary pl-2.5">
        {turn.items.map((item) =>
          item.type === "tool" ? (
            <ToolItem key={item.id} item={item} />
          ) : (
            <PlanActivity key={item.id} item={item} />
          ),
        )}
      </ActivityRowContent>
    </ActivityRow>
  );
}
