// Derived from Buzz (Apache-2.0, © Block, Inc.): desktop/src/features/agents/ui/agentSessionTypes.ts. Modified.
// What an agent did in one turn, folded from the daemon's dev.zooid.* events.
import type { ApprovalDecision, ApprovalRequest } from "@/events/approval";
import type {
  DiffBlock,
  PlanBoardEntry,
  ToolLocation,
} from "@/events/zooid-events";
import type { ActorSummary } from "./types";

/** ACP tool call status. "stalled" is derived at render from the last activity. */
export type ToolStatus = "pending" | "in_progress" | "completed" | "failed";

export interface ToolTranscriptItem {
  type: "tool";
  id: string; // ACP tool_call_id
  title: string;
  /** ACP tool kind: read, edit, delete, move, search, execute, think, fetch, other. */
  toolKind: string;
  status: ToolStatus;
  /** Input merged across the tool_call and every update; a later update can omit earlier fields. */
  rawInput: Record<string, unknown> | null;
  /** Text output of the latest update. */
  content: string | null;
  diffs: DiffBlock[];
  locations: ToolLocation[];
  startedAt: number;
  /** Time of the latest event for this call, for stall detection. */
  lastActivityAt: number;
}

export interface PlanTranscriptItem {
  type: "plan";
  id: string;
  /** The latest plan of the turn (ACP sends full snapshots). */
  entries: PlanBoardEntry[];
  updatedAt: number;
}

export type TranscriptItem = ToolTranscriptItem | PlanTranscriptItem;

/** One agent turn: everything an agent did between a prompt and its turn.end. */
export interface AgentTurn {
  id: string;
  sessionId: string;
  agent: ActorSummary;
  threadRootId: string | null;
  items: TranscriptItem[];
  startedAt: number;
  /** turn.end time; null while the turn runs. */
  endedAt: number | null;
}

/** An approval request and what became of it. */
export interface ApprovalView {
  request: ApprovalRequest;
  resolution: {
    decision: ApprovalDecision;
    optionId?: string;
    respondedBy: string;
    respondedAt: number;
  } | null;
  /** The agent's turn ended unanswered (timeout, interrupt, restart): nothing waits on it any more. */
  expired: boolean;
  /** The viewer is an agent: agents never answer approvals. */
  viewerIsAgent: boolean;
}
