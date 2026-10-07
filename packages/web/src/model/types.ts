// Fabrium-shaped view model. Components import these types, never matrix-js-sdk;
// `from-matrix.ts` is the one place Matrix data is mapped onto them.
import type { QuoteRef } from "@/lib/matrix/quote";

export type ActorKind = "human" | "agent" | "system";

export interface ActorSummary {
  id: string; // Matrix user ID
  kind: ActorKind;
  displayName: string;
  avatarUrl: string | null; // mxc; resolve with useAuthedMediaUrl
  persona?: string; // agents only
  project?: string; // agents only
}

export interface TimelineReaction {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  myEventId?: string;
  actorIds: string[];
}

export type TimelineKind =
  | "message"
  | "membership"
  | "state"
  | "agent-turn"
  | "approval"
  | "question"
  | "error"
  | "gap"
  | "divider";

export interface TimelineMessage {
  id: string;
  kind: TimelineKind;
  createdAt: number;
  author: ActorSummary;
  /** Text as displayed: the latest edit, without a quote's fallback lines. */
  body: string;
  formattedBody?: string; // sanitized at render
  threadRootId: string | null; // m.thread
  replyToId: string | null; // m.in_reply_to
  quote?: QuoteRef; // dev.zooid.quote
  edited: boolean;
  pending: boolean;
  failed: boolean;
  /** Why the server rejected a failed send. */
  failedReason?: string;
  redacted: boolean;
  reactions: TimelineReaction[];
  media?: {
    mxc: string;
    mimetype: string;
    name: string;
    size?: number;
    w?: number;
    h?: number;
  };
  /** Source payload for kinds rendered by the agent cards (agent-turn, approval, question, error). */
  raw?: unknown;
}

export interface ThreadSummary {
  rootId: string;
  replyCount: number;
  lastReplyAt: number | null;
  participants: ActorSummary[];
}

export interface TimelineEntry {
  message: TimelineMessage;
  thread: ThreadSummary | null;
}
