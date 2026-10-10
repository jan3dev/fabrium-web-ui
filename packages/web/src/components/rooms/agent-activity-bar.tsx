// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/channels/ui/BotActivityBar.tsx. Modified.
import * as React from "react";

import { TurnLivenessIndicator } from "@/components/agents/turn-liveness";
import { StopIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import {
  buildToolSummary,
  isToolRunning,
} from "@/lib/agent-activity/tool-summary";
import { parseSlashCommand } from "@/lib/slash-commands";
import type { AgentTurn } from "@/model/agent-activity";
import { toActor } from "@/model/from-matrix";
import type { ActorSummary } from "@/model/types";
import { useMatrixClient } from "../../hooks/use-matrix-client";
import { useNow } from "../../hooks/use-now";
import { useOpenTurns } from "../../hooks/use-timeline-entries";
import { useTyping } from "../../hooks/use-typing";
import { useWorkforce } from "../../hooks/use-workforce";

/**
 * A turn without turn.end whose agent has been silent this long (no event, not
 * typing) is a daemon that died mid-turn, not a running agent. The daemon keeps
 * an agent typing for the whole turn, so a long quiet tool call still counts.
 */
const STALE_TURN_MS = 30 * 60 * 1000;

export interface AgentActivityRow {
  key: string;
  agent: ActorSummary;
  threadRootId: string;
  /** "Editing auth.ts", or "Working" between tool calls. */
  activity: string;
}

export function currentActivity(turn: AgentTurn): string {
  for (let i = turn.items.length - 1; i >= 0; i--) {
    const item = turn.items[i]!;
    if (item.type === "tool" && isToolRunning(item)) {
      const s = buildToolSummary(item);
      return s.object ? `${s.verb} ${s.object}` : s.verb;
    }
  }
  return "Working";
}

function lastActivityAt(turn: AgentTurn): number {
  return Math.max(
    turn.startedAt,
    ...turn.items.map((i) =>
      i.type === "tool" ? i.lastActivityAt : i.updatedAt,
    ),
  );
}

/**
 * Agents working in the room (or one thread), above the composer, each with a
 * Stop button. Stop sends `dev.zooid.interrupt` into the turn's thread.
 */
export function AgentActivityBar({
  roomId,
  threadRootId = null,
  workforceSpaceId = null,
  openThreadId = null,
  onOpenThread,
}: {
  roomId: string;
  /** Only this thread's agents. In a thread, an agent typing before its first tool call counts too. */
  threadRootId?: string | null;
  workforceSpaceId?: string | null;
  /** The thread open in the side pane, whose own bar already shows its turns. */
  openThreadId?: string | null;
  onOpenThread?: (rootId: string) => void;
}) {
  const client = useMatrixClient();
  const turns = useOpenTurns(roomId, workforceSpaceId);
  const typing = useTyping(roomId);
  const roster = useWorkforce(workforceSpaceId ?? "");
  const now = useNow();
  const [stopping, setStopping] = React.useState<ReadonlySet<string>>(
    new Set(),
  );
  const [error, setError] = React.useState<string | null>(null);

  const rows: AgentActivityRow[] = turns
    .filter(
      (t) =>
        t.threadRootId &&
        (threadRootId ? t.threadRootId === threadRootId : t.threadRootId !== openThreadId) &&
        (typing.includes(t.agent.id) ||
          now - lastActivityAt(t) < STALE_TURN_MS),
    )
    .map((t) => ({
      key: t.id,
      agent: t.agent,
      threadRootId: t.threadRootId!,
      activity: currentActivity(t),
    }));
  if (threadRootId) {
    const room = client.getRoom(roomId);
    for (const id of typing) {
      // Without a roster every typer may be an agent, as before the roster existed.
      if (
        (roster.ready && !roster.isAgent(id)) ||
        rows.some((r) => r.agent.id === id)
      )
        continue;
      rows.push({
        key: `typing:${id}`,
        agent: toActor(id, room, roster),
        threadRootId,
        activity: "Working",
      });
    }
  }

  async function stop(row: AgentActivityRow) {
    const slash = parseSlashCommand("/stop", { threadScoped: true });
    if (!slash) return;
    setError(null);
    setStopping((s) => new Set(s).add(row.key));
    try {
      await (
        client.sendEvent as unknown as (
          roomId: string,
          threadId: string,
          type: string,
          content: Record<string, unknown>,
        ) => Promise<unknown>
      ).call(client, roomId, row.threadRootId, slash.eventType, {
        ...slash.content,
        "m.relates_to": { rel_type: "m.thread", event_id: row.threadRootId },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStopping((s) => {
        const next = new Set(s);
        next.delete(row.key);
        return next;
      });
    }
  }

  return (
    <AgentActivityBarView
      rows={rows}
      stopping={stopping}
      error={error}
      onStop={(row) => void stop(row)}
      onOpenThread={threadRootId ? undefined : onOpenThread}
    />
  );
}

export function AgentActivityBarView({
  rows,
  stopping = new Set(),
  error,
  onStop,
  onOpenThread,
}: {
  rows: AgentActivityRow[];
  stopping?: ReadonlySet<string>;
  error?: string | null;
  onStop?: (row: AgentActivityRow) => void;
  /** Shown in the room, where the turn runs in a thread off-screen. */
  onOpenThread?: (rootId: string) => void;
}) {
  if (rows.length === 0 && !error) return null;
  return (
    <div
      className="flex shrink-0 flex-col gap-1 px-3 pb-1.5"
      data-testid="agent-activity-bar"
    >
      {rows.map((row) => (
        <div
          className="flex min-w-0 items-center gap-2 rounded-card border border-surface-border-primary bg-surface-secondary py-1 pl-2.5 pr-1"
          key={row.key}
        >
          <TurnLivenessIndicator />
          <UserAvatar userId={row.agent.id} size="xs" />
          <span className="min-w-0 flex-1 truncate text-body2">
            <span className="font-semibold text-text-primary">
              {row.agent.displayName}
            </span>{" "}
            <span className="text-text-secondary">{row.activity}</span>
          </span>
          {onOpenThread ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => onOpenThread(row.threadRootId)}
            >
              View thread
            </Button>
          ) : null}
          <Button
            type="button"
            size="xs"
            variant="outline"
            aria-label={`Stop ${row.agent.displayName}`}
            disabled={stopping.has(row.key)}
            onClick={() => onStop?.(row)}
          >
            <StopIcon />
            {stopping.has(row.key) ? "Stopping…" : "Stop"}
          </Button>
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-caption1 text-accent-danger">
          Could not stop the agent: {error}
        </p>
      ) : null}
    </div>
  );
}
