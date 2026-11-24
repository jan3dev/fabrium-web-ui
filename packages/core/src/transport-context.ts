export interface HistoryOptions {
  /** Max messages to return. Default 50, max 200 (enforced by the MCP server). */
  limit?: number
  /** Pagination cursor — opaque to the agent. Provider-defined shape. */
  before?: string
}

export interface Message {
  id: string
  sender: string
  text: string
  timestamp: string
  is_agent: boolean
  agent_name?: string
  /**
   * Thread root event id when this message belongs to a thread. Absent for
   * top-level messages. Lets agents group messages by thread or drill into
   * a specific thread root.
   */
  thread_id?: string
}

export interface Member {
  id: string
  name: string
  is_agent: boolean
  agent_name?: string
}

/** Renamed from ChannelInfo — "channel" is not a Matrix primitive ([[ZOD084]]). */
export interface RoomInfo {
  id: string
  name: string
  transport: 'http' | 'matrix'
}

export interface SendMessageInput {
  room: string
  thread_id?: string
  text: string
}

export interface SendMessageResult {
  event_id: string
  thread_id?: string
}

export const ARTIFACT_KINDS = ['html', 'svg', 'react', 'markdown', 'code', 'slides', 'design', 'design-system'] as const
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

export interface ArtifactEdit {
  old_str: string
  new_str: string
}

/**
 * A new version of an artifact shown in the client's artifact panel. Exactly
 * one of `content` (the full new version) or `edits` (find/replace pairs
 * against the latest version with the same identifier, from any allowed
 * author) is set. `read: true` with only `identifier` sends nothing and
 * returns the latest version instead. `assets` with only `identifier` sends
 * nothing and uploads those workspace files, returning their `mxc://` URIs.
 */
export interface ArtifactInput {
  identifier: string
  type?: ArtifactKind
  title?: string
  language?: string
  content?: string
  edits?: ArtifactEdit[]
  read?: boolean
  assets?: string[]
}

/** A sent version; for `read`, the latest version and its content; for `assets`, only `assets`. */
export interface ArtifactResult {
  event_id?: string
  identifier: string
  type?: ArtifactKind
  title?: string
  language?: string
  sender?: string
  content?: string
  /** Each given asset path → its `mxc://` URI. */
  assets?: Record<string, string>
}

/** A design system a workspace or project lists (`dev.fabrium.design_systems`, design modes spec §5.6). */
export interface DesignSystemRef {
  room_id: string
  thread_id: string
  identifier: string
  name: string
  default?: true
  /** Only for these kinds; absent = every kind. */
  for?: Array<'slides' | 'design'>
  /** The kinds this system is the default for, after merging every list. */
  default_for?: Array<'slides' | 'design'>
}

/** No `identifier`: list the systems. With it: read one; with `component` too, that component's markup. */
export interface DesignSystemInput {
  identifier?: string
  /** Disambiguates two listed systems with the same identifier. */
  room_id?: string
  component?: string
}

/** `{ systems }` for a list; for a read, the system's parts (overview, css, tokens, components, …). */
export type DesignSystemResult = Record<string, unknown>

export interface SendAttachmentInput {
  /** As the agent sees it. Relative paths resolve against the agent's workspace. */
  path: string
  /** Display filename. Default: basename of `path`. */
  name?: string
  /** Sent as a threaded m.notice right after the media event. Empty/absent = none. */
  caption?: string
}

export interface SendAttachmentResult {
  /** The media event, not the caption. */
  event_id: string
  mxc_uri: string
}

export interface HistoryPage {
  messages: Message[]
  next_before?: string
  has_more: boolean
}

/**
 * A top-level entry in a room — either a standalone message or a thread
 * root. Lets the agent scan a room without thread-reply noise. Drill into
 * a thread with `getThreadHistory(thread_id)` where `thread_id` is this
 * entry's `id`.
 */
export interface ThreadOverview {
  id: string
  sender: string
  text: string
  timestamp: string
  is_agent: boolean
  agent_name?: string
  /** Number of replies in the thread under this entry. 0 = no replies yet. */
  reply_count: number
  /**
   * ISO 8601 of the latest activity in the thread (latest reply, or this
   * entry's own timestamp when there are no replies). Useful for sorting.
   */
  last_activity_at: string
}

export interface ThreadOverviewPage {
  threads: ThreadOverview[]
  next_before?: string
  has_more: boolean
}

/**
 * Read-only conversation-context surface for a single transport.
 * Implemented per-transport when the transport owns (or fronts) durable
 * conversation context. Transports that don't (e.g. current HTTP) return
 * `null` from `Transport.getContextProvider()`.
 *
 * Lets agents navigate a room the way a human does:
 *   - `getRoomHistory`     — every message chronologically
 *   - `getRecentThreads`   — top-level entries only (scan-the-room view)
 *   - `getThreadHistory`   — drill into one specific thread
 */
export interface TransportContextProvider {
  getRoomHistory(channelId: string, opts: HistoryOptions): Promise<HistoryPage>
  getRecentThreads(channelId: string, opts: HistoryOptions): Promise<ThreadOverviewPage>
  getThreadHistory(
    channelId: string,
    threadId: string,
    opts: HistoryOptions,
  ): Promise<HistoryPage>
  getChannelMembers(channelId: string): Promise<Member[]>
  /** Renamed from getChannelInfo. */
  getRoomInfo(channelId: string): Promise<RoomInfo>
  /** Rooms this agent is bound to. Targets for sendMessage. */
  getRooms(): Promise<RoomInfo[]>
  /**
   * Resolve an agent-supplied room selector (canonical ID or configured alias)
   * against this agent's own bindings, locally: no transport read. Returns
   * the canonical room ID, or undefined when the agent is not in that room.
   * Absent = the provider cannot name rooms, so an explicit-room read is
   * refused ([[ZOD084]]).
   */
  resolveRoom?(selector: string): string | undefined
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>
  /** Post an artifact version into the bound thread, or with `read` return the latest. Absent = transport has no artifacts. */
  sendArtifact?(channelId: string, threadId: string, input: ArtifactInput): Promise<ArtifactResult>
  /** List the design systems the room's project and workspace list, or read one. Absent = none on this transport. */
  designSystem?(channelId: string, input: DesignSystemInput): Promise<DesignSystemResult>
  /**
   * Post a file to the given thread as the agent. Optional: absent = the
   * transport cannot send attachments ([[ZOD068]]).
   */
  sendAttachment?(
    channelId: string,
    threadId: string,
    input: SendAttachmentInput,
  ): Promise<SendAttachmentResult>
}
