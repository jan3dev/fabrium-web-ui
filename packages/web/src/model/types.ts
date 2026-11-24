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
}

export interface PreviewSession {
  /** The only URL the preview iframe may load. */
  url: string;
  expires_at: string;
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
  /** Hours of uptime after which the VM stops itself; null or absent when unknown. */
  auto_stop_hours?: number | null;
  /** The agents of the VM, sorted by name. Only the live VM of a name has agents. */
  agents: { id: string; name: string; agent_id: string }[];
  /** The Matrix user who created the VM; null or absent for a VM from before the registry. */
  creator?: string | null;
  /** False for a VM from before the registry: its auto-stop hours cannot change. */
  registered?: boolean;
}

export interface VmInstanceType {
  name: string;
  vcpus: number;
  memory_mib: number;
  sev_snp: boolean;
  default: boolean;
}

export type FabriumRole = "agents-manager" | "vm-creator" | "admin" | "owner";

export interface FabriumAccess {
  user_id: string;
  role: FabriumRole;
}

/** What the caller may do with an agent. The daemon computes it; the web holds no rule. */
export interface AgentCan {
  edit: boolean;
  set_owner: boolean;
  assign: boolean;
  create_vm: boolean;
  delete: boolean;
  delete_needs_vm: boolean;
}

/** `id` and `state` are absent when the VM name has no live VM. */
export interface AgentVm {
  name: string;
  id?: string;
  state?: VmState;
  owner?: string | null;
}

export interface Agent {
  id: string;
  name: string;
  /** `@<vm>.<name>:<server>`; null for a profile. */
  agent_id: string | null;
  owner: string | null;
  description: string | null;
  model: string | null;
  tag: string | null;
  project: string | null;
  /** Null for a profile. */
  vm: AgentVm | null;
  /** `instance`: an agent of the config of the central zooid. Read-only. */
  source: "control-plane" | "instance";
  can: AgentCan;
}

/** A member of the workforce space who is not an agent: an owner to choose from. */
export interface Person {
  user_id: string;
  /** The display name in the space, or the localpart. */
  name: string;
}

export interface AgentList {
  agents: Agent[];
  /** The live VMs that the caller can assign an agent to. */
  vms: { name: string; state: VmState }[];
  /** Every person, sorted by the daemon. */
  people: Person[];
}

/** The body of a create or an edit. An edit sends only the fields that changed; "" clears tag and project. */
export interface AgentInput {
  name?: string;
  description?: string;
  model?: string;
  tag?: string;
  project?: string;
  owner?: string;
  vm?: string;
}

export interface ModelList {
  models: { id: string }[];
  default: string | null;
}

export interface VmCredentials {
  haven_api_key: string;
  github_token?: string;
}

export interface CreateVmRequest extends VmCredentials {
  /** The id of the agent record the VM is for. */
  agent: string;
  name: string;
  instance_type?: string;
  /** Integer from 1 to 168. */
  auto_stop_hours?: number;
}
