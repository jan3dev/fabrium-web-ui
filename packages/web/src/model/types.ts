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
  | "preview"
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

export const ARTIFACT_KINDS = [
  "html",
  "svg",
  "react",
  "markdown",
  "code",
  "slides",
  "design",
  "design-system",
  "whiteboard",
  "motion",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/**
 * One version of an artifact, numbered per thread + identifier. An agent's event starts a
 * version; a person's event is a save that folds into the version before it (spec §5.2 as
 * changed: saves autosave into the current version). The content fields are the newest
 * save's. A person's event with no version before it (Duplicate) starts version 1.
 */
export interface ArtifactVersion {
  /** The event that started the version: it names the version (`?version=`) and does not change. */
  eventId: string;
  /** The newest event folded into the version: its content is shown, the next save is based on it. */
  headEventId: string;
  identifier: string;
  kind: ArtifactKind;
  title: string;
  language?: string;
  /** Inline content; otherwise fetch `mxc` and check it against `sha256`. */
  body?: string;
  mxc?: string;
  sha256?: string;
  /** The starting event's one line for the version list. */
  summary?: string;
  /** Saves folded into the version: the newest one's author, time and summary, and how many. */
  edited?: { by: ActorSummary; at: number; saves: number; summary?: string };
  /** An event of this version was made from content older than the one before it (`based_on`). */
  madeFromOlder?: { version: number | null };
  /** 1-based. */
  version: number;
  createdAt: number;
  author: ActorSummary;
  threadRootId: string | null;
}

/** The artifact kinds a design system can be limited to (`for`, spec §5.6). */
export type DesignSystemScope = "slides" | "design" | "motion";

/** A design system a workspace or project lists (`dev.fabrium.design_systems`, spec §5.6). */
export interface DesignSystemEntry {
  /** The `design-system` artifact: its room, thread and identifier. */
  roomId: string;
  threadId: string;
  identifier: string;
  name: string;
  isDefault: boolean;
  /** Only for these kinds; absent = every kind. */
  for?: DesignSystemScope[];
}

/** The user's own choice (account data): a default of their own, or design systems off. */
export interface DesignSystemPrefs {
  off: boolean;
  default?: { roomId: string; identifier: string };
}

/** One `dev.fabrium.preview` event: an agent started or stopped a live app preview. */
export interface PreviewEvent {
  eventId: string;
  /** kebab-case, unique per agent. A preview is (agent, name). */
  name: string;
  title: string;
  command: string;
  /** `expo`: a React Native app that Expo Go also opens. */
  kind: PreviewKind;
  action: "started" | "stopped";
  createdAt: number;
  author: ActorSummary;
  threadRootId: string | null;
}

// Fabrium service API. Field names match the wire format.
export type PreviewStatus = "starting" | "running" | "crashed" | "stopped" | "offline";
export type PreviewKind = "web" | "expo";

export interface PreviewInfo {
  agent_id: string;
  name: string;
  title: string;
  command: string;
  kind: PreviewKind;
  room_id: string;
  thread_root: string;
  status: PreviewStatus;
  /** RFC 3339. */
  since: string;
  exit_code: number | null;
  /** The app serves a page the panel can show. False for an Expo app without a web build. */
  web: boolean;
}

export interface PreviewDetail extends PreviewInfo {
  /** Log text after the requested offset; pass `offset` back to get only new text. */
  /** `reset`: the offset asked for is gone (a reconnect or a lost window); `text` replaces the log. */
  log: { offset: number; text: string; reset?: boolean };
  /** Where the agent works in the app now (plan P6): a page path and an untrusted selector. */
  focus?: { path: string; selector: string };
}

export interface PreviewSession {
  /** The only URL the preview iframe may load. */
  url: string;
  expires_at: string;
}

/** Where an agent works in an artifact right now (`GET /previews/focus`): the agent cursor (spec §6.8). */
export interface AgentFocusInfo {
  agent_id: string;
  room_id: string;
  thread_root: string;
  identifier: string;
  /** Untrusted: only ever queried in the frame. */
  selector: string;
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
