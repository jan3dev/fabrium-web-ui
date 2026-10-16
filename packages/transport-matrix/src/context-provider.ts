import type {
  ArtifactInput,
  ArtifactResult,
  TransportContextProvider,
  HistoryOptions,
  HistoryPage,
  Member,
  RoomInfo,
  SendMessageInput,
  SendMessageResult,
  Message,
  ThreadOverview,
  ThreadOverviewPage,
} from '@zooid/core'
import type { MatrixClient } from './matrix-client.js'
import type { MediaClient } from './media-client.js'
import {
  ARTIFACT_EVENT_TYPE,
  MAX_ARTIFACT_BYTES,
  MAX_INLINE_ARTIFACT_BYTES,
  applyArtifactEdits,
  readStoredArtifact,
  sha256Hex,
  validateArtifactInput,
  type StoredArtifact,
} from './artifacts.js'
import type { RoomBinding } from '@zooid/core'

interface MatrixMessageEvent {
  event_id: string
  sender: string
  origin_server_ts: number
  type: string
  content?: {
    msgtype?: string
    body?: string
    'm.relates_to'?: { rel_type?: string; event_id?: string }
  }
  unsigned?: {
    'm.relations'?: {
      'm.thread'?: {
        count?: number
        latest_event?: { origin_server_ts?: number }
      }
    }
  }
}

export interface MatrixContextProviderOpts {
  client: MatrixClient
  /**
   * The **agent's own** Matrix user (`@{workstation}.{name}:server`), which
   * every read is impersonated as via `?user_id=`. Not the AS bot: that would
   * read every room on the homeserver and make this class the only thing
   * standing between an agent and someone else's conversation.
   *
   * This is load-bearing. It is what makes the homeserver — not our own
   * bookkeeping — the authorization boundary for context reads, so a room or
   * thread the agent is not in fails at Matrix with 403/404. Anything that
   * widens who can name a room (a CLI, a new tool parameter) is safe only
   * while this holds.
   */
  asUserId: string
  /** Map of Matrix user IDs → agent names, for is_agent / agent_name flags. */
  agentBots: Map<string, string>
  /**
   * This agent's own room bindings — the live array `BotPool.bootstrap`
   * rewrites `.alias` on in place, so reads through this field after
   * bootstrap see canonical room IDs. Backs `getRooms()` and the
   * `sendMessage()` authorization check. Absent/empty = no rooms known
   * (context providers built before this field existed, or in tests that
   * don't exercise either method).
   */
  rooms?: RoomBinding[]
  /** Stores artifact bodies over 48 KB. Absent = such artifacts are refused. */
  media?: Pick<MediaClient, 'download' | 'upload'>
}

/** Pages of thread relations searched for an artifact's latest version. */
const ARTIFACT_SEARCH_PAGES = 10

export class MatrixContextProvider implements TransportContextProvider {
  constructor(private readonly opts: MatrixContextProviderOpts) {}

  async getRoomHistory(channelId: string, hopts: HistoryOptions): Promise<HistoryPage> {
    // Server-side filter: only `m.room.message` events. Without this we'd
    // burn the page budget on reactions, `dev.zooid.*` custom events, typing
    // notifications, etc., and routinely return empty pages with a stale
    // `has_more` cursor.
    const { chunk, end } = await this.opts.client.fetchRoomMessages({
      roomId: channelId,
      asUserId: this.opts.asUserId,
      limit: hopts.limit,
      from: hopts.before,
      filter: { types: ['m.room.message'] },
    })
    const messages: Message[] = []
    for (let i = chunk.length - 1; i >= 0; i--) {
      const ev = chunk[i] as unknown as MatrixMessageEvent
      const msg = this.toMessage(ev)
      if (msg) messages.push(msg)
    }
    return {
      messages,
      next_before: end,
      has_more: end !== undefined,
    }
  }

  async getRecentThreads(
    channelId: string,
    hopts: HistoryOptions,
  ): Promise<ThreadOverviewPage> {
    // Server-side filter: `m.room.message` only, and exclude thread replies
    // (`not_rel_types: ['m.thread']`) so the overview shows top-level entries
    // and thread roots, not the reply noise underneath them.
    const { chunk, end } = await this.opts.client.fetchRoomMessages({
      roomId: channelId,
      asUserId: this.opts.asUserId,
      limit: hopts.limit,
      from: hopts.before,
      filter: { types: ['m.room.message'], not_rel_types: ['m.thread'] },
    })
    // /messages returns newest-first; keep that order for the overview.
    const threads: ThreadOverview[] = []
    for (const ev of chunk as unknown as MatrixMessageEvent[]) {
      if (ev.type !== 'm.room.message') continue
      // m.notice: agent prose sends as m.notice so
      // .m.rule.suppress_notices silences the chunk storm server-side
      // (ZNC025 §10) — a thread root sent by an agent must still surface here.
      if (
        (ev.content?.msgtype !== 'm.text' && ev.content?.msgtype !== 'm.notice') ||
        typeof ev.content.body !== 'string'
      )
        continue
      const relatesTo = ev.content['m.relates_to']
      if (relatesTo?.rel_type === 'm.thread') continue // skip thread replies
      const agent = this.opts.agentBots.get(ev.sender)
      const bundled = ev.unsigned?.['m.relations']?.['m.thread']
      const replyCount = bundled?.count ?? 0
      const latestTs = bundled?.latest_event?.origin_server_ts ?? ev.origin_server_ts
      threads.push({
        id: ev.event_id,
        sender: ev.sender,
        text: ev.content.body,
        timestamp: new Date(ev.origin_server_ts).toISOString(),
        is_agent: agent !== undefined,
        ...(agent !== undefined ? { agent_name: agent } : {}),
        reply_count: replyCount,
        last_activity_at: new Date(latestTs).toISOString(),
      })
    }
    return {
      threads,
      next_before: end,
      has_more: end !== undefined,
    }
  }

  async getThreadHistory(
    channelId: string,
    threadId: string,
    hopts: HistoryOptions,
  ): Promise<HistoryPage> {
    // Root event first (only on the first page when no pagination cursor).
    const messages: Message[] = []
    if (!hopts.before) {
      const root = (await this.opts.client.fetchEvent(
        channelId,
        threadId,
        this.opts.asUserId,
      )) as unknown as MatrixMessageEvent | null
      if (root) {
        const rootMsg = this.toMessage(root)
        if (rootMsg) messages.push({ ...rootMsg, thread_id: threadId })
      }
    }
    const { chunk, next_batch } = await this.opts.client.fetchThreadRelations({
      roomId: channelId,
      rootEventId: threadId,
      asUserId: this.opts.asUserId,
      limit: hopts.limit,
      from: hopts.before,
    })
    for (const ev of chunk as unknown as MatrixMessageEvent[]) {
      const reply = this.toMessage(ev)
      if (reply) messages.push({ ...reply, thread_id: threadId })
    }
    return {
      messages,
      next_before: next_batch,
      has_more: next_batch !== undefined,
    }
  }

  private toMessage(ev: MatrixMessageEvent): Message | null {
    if (ev.type !== 'm.room.message') return null
    const msgtype = ev.content?.msgtype
    const body = ev.content?.body
    const agent = this.opts.agentBots.get(ev.sender)
    const relatesTo = ev.content?.['m.relates_to']
    const threadId =
      relatesTo?.rel_type === 'm.thread' && relatesTo.event_id ? relatesTo.event_id : undefined

    // Media events render as context placeholders
    if (msgtype === 'm.image' || msgtype === 'm.file' || msgtype === 'm.video' || msgtype === 'm.audio') {
      const kind = msgtype.slice(2) // 'image', 'file', 'video', 'audio'
      const name = typeof body === 'string' && body ? body : 'untitled'
      return {
        id: ev.event_id,
        sender: ev.sender,
        text: `[${kind}: ${name}]`,
        timestamp: new Date(ev.origin_server_ts).toISOString(),
        is_agent: agent !== undefined,
        ...(agent !== undefined ? { agent_name: agent } : {}),
        ...(threadId !== undefined ? { thread_id: threadId } : {}),
      }
    }

    // Agent prose sends as m.notice (ZNC025 §10); m.text is human prose.
    if ((msgtype !== 'm.text' && msgtype !== 'm.notice') || typeof body !== 'string') return null
    return {
      id: ev.event_id,
      sender: ev.sender,
      text: body,
      timestamp: new Date(ev.origin_server_ts).toISOString(),
      is_agent: agent !== undefined,
      ...(agent !== undefined ? { agent_name: agent } : {}),
      ...(threadId !== undefined ? { thread_id: threadId } : {}),
    }
  }

  async getChannelMembers(channelId: string): Promise<Member[]> {
    const { joined } = await this.opts.client.getJoinedMembers(channelId, this.opts.asUserId)
    return Object.entries(joined).map(([id, info]) => {
      const agent = this.opts.agentBots.get(id)
      return {
        id,
        name: info.display_name ?? id,
        is_agent: agent !== undefined,
        ...(agent !== undefined ? { agent_name: agent } : {}),
      }
    })
  }

  async getRoomInfo(channelId: string): Promise<RoomInfo> {
    const name = await this.opts.client.fetchRoomName(channelId, this.opts.asUserId)
    return {
      id: channelId,
      name: name ?? channelId,
      transport: 'matrix',
    }
  }

  async getRooms(): Promise<RoomInfo[]> {
    const rooms = this.opts.rooms ?? []
    return Promise.all(
      rooms.map(async (r) => {
        const name = await this.opts.client.fetchRoomName(r.alias, this.opts.asUserId)
        return { id: r.alias, name: name ?? r.alias, transport: 'matrix' as const }
      }),
    )
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const rooms = this.opts.rooms ?? []
    if (!rooms.some((r) => r.alias === input.room)) {
      throw new Error(`not_in_room: this agent is not a member of ${input.room}`)
    }
    const { event_id } = await this.opts.client.sendMessage({
      roomId: input.room,
      asUserId: this.opts.asUserId,
      // m.notice, not m.text: agent prose sends as m.notice so
      // .m.rule.suppress_notices silences it server-side (ZNC025 §10).
      content: { msgtype: 'm.notice', body: input.text },
      ...(input.thread_id ? { threadRoot: input.thread_id } : {}),
    })
    return { event_id, ...(input.thread_id ? { thread_id: input.thread_id } : {}) }
  }

  /**
   * Edits are applied here, against this agent's latest version in the
   * thread, so every event holds a whole version and a bad edit fails back to
   * the model instead of rendering a broken artifact.
   */
  async sendArtifact(channelId: string, threadId: string, input: ArtifactInput): Promise<ArtifactResult> {
    validateArtifactInput(input)
    // The web client opens artifacts beside their thread; a room-level one would be a dead card.
    if (!threadId.startsWith('$')) {
      throw new Error('unsupported: artifacts are shown in threads. Reply in a thread to use zooid_artifact.')
    }
    const previous =
      input.edits || !input.title ? await this.latestArtifact(channelId, threadId, input.identifier) : null
    if (input.edits && !previous) {
      throw new Error(`not_found: no earlier version of "${input.identifier}" by you in this thread. Send the full content.`)
    }
    const text = input.edits
      ? applyArtifactEdits(await this.artifactBody(previous!), input.edits)
      : input.content!
    const bytes = new TextEncoder().encode(text)
    if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
      throw new Error(`too_large: ${bytes.byteLength} bytes, the limit is ${MAX_ARTIFACT_BYTES}. Split or simplify it.`)
    }
    const type = input.type ?? previous!.type
    const content: Record<string, unknown> = {
      identifier: input.identifier,
      type,
      title: input.title || previous?.title || input.identifier,
    }
    const language = input.language ?? (input.type ? undefined : previous?.language)
    if (language) content.language = language
    // Measured as encoded in the event: JSON escaping can double quote- and newline-heavy code.
    if (new TextEncoder().encode(JSON.stringify(text)).byteLength <= MAX_INLINE_ARTIFACT_BYTES) {
      content.body = text
    } else {
      if (!this.opts.media) throw new Error(`too_large: artifacts over ${MAX_INLINE_ARTIFACT_BYTES} bytes are not supported here.`)
      const { content_uri } = await this.opts.media.upload({
        data: bytes,
        contentType: 'text/plain; charset=utf-8',
        filename: `${input.identifier}.txt`,
        asUserId: this.opts.asUserId,
      })
      Object.assign(content, { url: content_uri, sha256: sha256Hex(bytes), size: bytes.byteLength })
    }
    content['m.relates_to'] = { rel_type: 'm.thread', event_id: threadId }
    const { event_id } = await this.opts.client.sendCustomEvent({
      roomId: channelId,
      asUserId: this.opts.asUserId,
      eventType: ARTIFACT_EVENT_TYPE,
      content,
    })
    return { event_id, identifier: input.identifier }
  }

  private async latestArtifact(roomId: string, threadId: string, identifier: string): Promise<StoredArtifact | null> {
    let from: string | undefined
    for (let page = 0; page < ARTIFACT_SEARCH_PAGES; page++) {
      const { chunk, next_batch } = await this.opts.client.fetchThreadRelations({
        roomId,
        rootEventId: threadId,
        asUserId: this.opts.asUserId,
        eventType: ARTIFACT_EVENT_TYPE,
        dir: 'b',
        limit: 50,
        from,
      })
      for (const ev of chunk) {
        if (ev.sender !== this.opts.asUserId) continue
        const stored = readStoredArtifact(ev.content)
        if (stored?.identifier === identifier) return stored
      }
      if (!next_batch) return null
      from = next_batch
    }
    return null
  }

  private async artifactBody(stored: StoredArtifact): Promise<string> {
    if (typeof stored.body === 'string') return stored.body
    if (!this.opts.media) throw new Error('media_unavailable: cannot read the earlier version. Send the full content.')
    const { data } = await this.opts.media.download({
      mxcUri: stored.url!,
      asUserId: this.opts.asUserId,
      maxBytes: MAX_ARTIFACT_BYTES,
    })
    if (stored.sha256 && sha256Hex(data) !== stored.sha256) {
      throw new Error('media_mismatch: the earlier version does not match its checksum. Send the full content.')
    }
    return new TextDecoder().decode(data)
  }
}
