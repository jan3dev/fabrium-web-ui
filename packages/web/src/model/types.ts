// Fabrium-shaped view model. Components import these types, never matrix-js-sdk;
// `from-matrix.ts` is the one place Matrix data is mapped onto them.
import type { ArtifactRef } from "@/lib/artifacts/refs";
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
  | "artifact"
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
  artifactRefs?: ArtifactRef[]; // dev.fabrium.artifact_refs
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
  /** Source payload for kinds rendered by the agent cards (agent-turn, approval, question, error, artifact). */
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

export const ARTIFACT_KINDS = ["html", "svg", "react", "markdown", "code"] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** One version of an agent's artifact, numbered per thread + identifier. */
export interface ArtifactVersion {
  eventId: string;
  identifier: string;
  kind: ArtifactKind;
  title: string;
  language?: string;
  /** Inline content; otherwise fetch `mxc` and check it against `sha256`. */
  body?: string;
  mxc?: string;
  sha256?: string;
  /** 1-based. */
  version: number;
  createdAt: number;
  author: ActorSummary;
  threadRootId: string | null;
}
