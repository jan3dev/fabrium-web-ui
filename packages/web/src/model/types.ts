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

// Fabrium service API (VM management). Field names match the wire format.
export type VmState = "pending" | "running" | "stopping" | "stopped" | "shutting-down";
export type VmSetup = "pending" | "delivered" | "expired";

export interface Vm {
  id: string;
  name: string;
  state: VmState;
  instance_type: string;
  sev_snp: boolean;
  public_ip: string | null;
  /** RFC 3339, UTC. EC2 resets it at each start. */
  launched_at: string;
  setup: VmSetup;
  /** From the agent bundle of the VM; null when there is none. */
  agent_id: string | null;
}

export interface VmInstanceType {
  name: string;
  vcpus: number;
  memory_mib: number;
  sev_snp: boolean;
  default: boolean;
}

export interface VmAgent {
  workstation: string;
  agent_id: string;
  preset: string;
  /** No VM that is not terminated has this workstation name. */
  free: boolean;
}

export interface VmAccess {
  user_id: string;
  role: "admin" | "owner";
}

/** What the New VM dialog offers. */
export interface VmFormOptions {
  instanceTypes: VmInstanceType[];
  agents: VmAgent[];
}

export type CreateVmAgent =
  | { mode: "new"; name: string; persona?: string; project?: string }
  | { mode: "existing"; name: string };

export interface CreateVmRequest {
  /** The VM name, which is also the workstation name. */
  name: string;
  instance_type?: string;
  agent: CreateVmAgent;
  haven_api_key: string;
  github_token?: string;
}
