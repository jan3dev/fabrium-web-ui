// Central side: the tunnel endpoint, the registry of previews that workstations report,
// and the session tokens that name a preview origin (PREVIEWS_SPEC.md §5.1, §5.2).
import { randomBytes } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { bearerToken } from '../fabrium-api/auth.js'
import { stateEvent, whoami, type MatrixConn } from '../fabrium-api/matrix.js'
import {
  LOG_LIMIT,
  NAME_RE,
  STREAM_PATH,
  TUNNEL_PATH,
  TUNNEL_PROTOCOL,
  heartbeat,
  lineReader,
  previewKey,
  type DownMessage,
  type PreviewState,
  type UpMessage,
} from './protocol.js'

const SESSION_TTL_MS = 12 * 60 * 60_000
const STREAM_TIMEOUT_MS = 10_000
const TOKEN_RE = /^[0-9a-f]{32}$/
/** How long a "joined" answer holds; leaving the room ends access after at most this. */
const MEMBER_TTL_MS = 60_000

interface Tunnel {
  socket: Duplex
  token: string
  /** Who the token itself is (the appservice sender); never an agent it acts as. */
  sender: string
  /** Agent ID → may this token act as it (checked once). */
  canActAs: Map<string, Promise<boolean>>
}

interface Preview {
  state: PreviewState
  tunnel: Tunnel | undefined
  /** The last tunnel's token: reads room state as the agent, also while the workstation is offline. */
  token: string
  log: string
  /** Characters of output received in total; the API's `log_offset` counts in it. */
  logEnd: number
}

export interface Session {
  token: string
  key: string
  agentId: string
  name: string
  userId: string
  /** Origin of the web UI that opened it: the only frame ancestor and bridge target. */
  appOrigin: string
  expires: number
}

export interface PreviewHubDeps {
  conn: MatrixConn
  /** e.g. `http://*.preview.localhost:9000`. */
  origin: string
  now?: () => number
}

const hostnameOf = (host: string | undefined) => (host ?? '').replace(/:\d+$/, '').toLowerCase()

function refuse(socket: Duplex, status: number, reason: string): void {
  socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

function accept(socket: Duplex): void {
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: ${TUNNEL_PROTOCOL}\r\n\r\n`)
}

export class PreviewHub {
  private readonly previews = new Map<string, Preview>()
  private readonly sessions = new Map<string, Session>()
  private readonly streams = new Map<string, { tunnel: Tunnel; resolve(socket: Duplex): void }>()
  /** Upgraded sockets: http.Server.close() does not end them. */
  private readonly open = new Set<Duplex>()
  /** Session token → its upgraded sockets (HMR), ended when the session is revoked. */
  private readonly sessionSockets = new Map<string, Set<Duplex>>()
  /** `room\nuser` → membership check; a "joined" answer holds for MEMBER_TTL_MS. */
  private readonly members = new Map<string, { until: number; check: Promise<boolean> }>()
  private readonly hostSuffix: string
  /** `http` or `https`: the scheme of the preview origin, for X-Forwarded-Proto. */
  readonly proto: string
  private readonly now: () => number
  private readonly sweeper: ReturnType<typeof setInterval>

  constructor(private readonly deps: PreviewHubDeps) {
    const sample = new URL(deps.origin.replace('*', 'x'))
    // `x.preview.localhost` → `preview.localhost`
    this.hostSuffix = sample.hostname.slice(2)
    this.proto = sample.protocol.slice(0, -1)
    this.now = deps.now ?? Date.now
    this.sweeper = setInterval(() => void this.sweep(), MEMBER_TTL_MS)
    this.sweeper.unref()
  }

  /** Track an upgraded socket so close() can end it, and revoking `session` too. */
  track(socket: Duplex, session?: Session): void {
    if (!this.open.has(socket)) {
      this.open.add(socket)
      socket.once('close', () => this.open.delete(socket))
    }
    if (!session) return
    const set = this.sessionSockets.get(session.token) ?? new Set()
    this.sessionSockets.set(session.token, set.add(socket))
    socket.once('close', () => set.delete(socket))
  }

  close(): void {
    clearInterval(this.sweeper)
    for (const socket of this.open) socket.destroy()
    this.open.clear()
  }

  /**
   * Open WebSockets make no new requests: end those whose session expired or whose user
   * left the room, at most a minute late (spec §5.2). A homeserver error keeps them.
   */
  private async sweep(): Promise<void> {
    for (const [token, sockets] of this.sessionSockets) {
      const s = this.sessions.get(token)
      if (sockets.size === 0 || !s) continue
      const state = this.get(s.agentId, s.name)
      const ok = s.expires > this.now() && !!state && (await this.isMember(s.userId, state).catch(() => true))
      if (!ok) this.revoke(token)
    }
  }

  // ── tunnel ──────────────────────────────────────────────────────────────

  /** Handle a tunnel upgrade. False when the request is not for the tunnel. */
  handleTunnelUpgrade(req: IncomingMessage, socket: Duplex): boolean {
    // An upgraded socket has no error listener: a client reset would crash the process.
    socket.on('error', () => {})
    const path = (req.url ?? '').split('?')[0]!
    if (path !== TUNNEL_PATH && !path.startsWith(STREAM_PATH)) return false
    if ((req.headers.upgrade ?? '').toLowerCase() !== TUNNEL_PROTOCOL) {
      refuse(socket, 400, 'Bad Request')
      return true
    }
    const token = bearerToken(req.headers.authorization)
    if (!token) {
      refuse(socket, 401, 'Unauthorized')
      return true
    }
    this.track(socket)
    if (path === TUNNEL_PATH) void this.acceptControl(socket, token)
    else this.acceptStream(socket, token, path.slice(STREAM_PATH.length))
    return true
  }

  private async acceptControl(socket: Duplex, token: string): Promise<void> {
    const sender = await whoami(this.deps.conn, token).catch(() => null)
    if (!sender) return refuse(socket, 401, 'Unauthorized')
    accept(socket)
    heartbeat(socket)
    const tunnel: Tunnel = { socket, token, sender, canActAs: new Map() }
    const read = lineReader((line) => void this.onUp(tunnel, line))
    socket.on('data', (chunk: Buffer) => {
      if (!read(chunk)) socket.destroy()
    })
    // Server sockets are half-open: the workstation's FIN only emits 'end'.
    socket.once('end', () => socket.destroy())
    socket.once('close', () => {
      for (const p of this.previews.values()) {
        if (p.tunnel !== tunnel) continue
        p.tunnel = undefined
        p.state = { ...p.state, status: 'offline', since: new Date(this.now()).toISOString() }
      }
    })
  }

  private acceptStream(socket: Duplex, token: string, id: string): void {
    const pending = TOKEN_RE.test(id) ? this.streams.get(id) : undefined
    if (!pending || pending.tunnel.token !== token) return refuse(socket, 404, 'Not Found')
    this.streams.delete(id)
    accept(socket)
    pending.resolve(socket)
  }

  private actsAs(tunnel: Tunnel, agentId: string): Promise<boolean> {
    let check = tunnel.canActAs.get(agentId)
    if (!check) {
      // Homeservers ignore `user_id` for a user's own token: it answers as itself, so an
      // agent must differ from the token's own user. Only an appservice token acts as another.
      check = whoami(this.deps.conn, tunnel.token, agentId)
        .then((id) => id === agentId && agentId !== tunnel.sender)
        .catch(() => false)
      tunnel.canActAs.set(agentId, check)
    }
    return check
  }

  private async onUp(tunnel: Tunnel, line: string): Promise<void> {
    let msg: UpMessage
    try {
      msg = JSON.parse(line) as UpMessage
    } catch {
      return
    }
    const agentId = msg.t === 'state' ? msg.preview?.agent_id : msg.agent_id
    const name = msg.t === 'state' ? msg.preview?.name : msg.name
    if (typeof agentId !== 'string' || typeof name !== 'string' || !NAME_RE.test(name)) return
    // A workstation reports only for agents its appservice token may act as.
    if (!(await this.actsAs(tunnel, agentId))) return
    const key = previewKey(agentId, name)
    if (msg.t === 'state') {
      const s = msg.preview
      const known = this.previews.get(key)
      const preview: Preview = known ?? { state: s, tunnel: undefined, token: tunnel.token, log: '', logEnd: 0 }
      preview.state = {
        agent_id: agentId,
        name,
        title: String(s.title ?? name).slice(0, 120),
        command: String(s.command ?? '').slice(0, 2000),
        kind: s.kind === 'expo' ? 'expo' : 'web',
        room_id: String(s.room_id ?? ''),
        thread_root: String(s.thread_root ?? ''),
        status: ['starting', 'running', 'crashed', 'stopped'].includes(s.status) ? s.status : 'offline',
        since: String(s.since ?? new Date(this.now()).toISOString()),
        exit_code: typeof s.exit_code === 'number' ? s.exit_code : null,
      }
      // A new connection resends the whole log once, with its first state. It replaces the old
      // one; the skipped offset puts every reader's offset outside the window, so they reset.
      if (preview.tunnel !== tunnel && typeof msg.log === 'string') {
        preview.log = msg.log.slice(-LOG_LIMIT)
        preview.logEnd += preview.log.length + 1
      }
      preview.tunnel = tunnel
      preview.token = tunnel.token
      this.previews.set(key, preview)
      // A stopped app's links end; the web UI asks for a new session on the next run.
      if (preview.state.status === 'stopped') this.revokePreview(key)
    } else if (msg.t === 'log' && typeof msg.text === 'string') {
      const preview = this.previews.get(key)
      if (!preview || preview.tunnel !== tunnel) return
      preview.log = (preview.log + msg.text).slice(-LOG_LIMIT)
      preview.logEnd += msg.text.length
    } else if (msg.t === 'remove') {
      if (this.previews.get(key)?.tunnel !== tunnel) return
      this.previews.delete(key)
      this.revokePreview(key)
    }
  }

  private down(tunnel: Tunnel, msg: DownMessage): void {
    tunnel.socket.write(JSON.stringify(msg) + '\n')
  }

  // ── registry ────────────────────────────────────────────────────────────

  get(agentId: string, name: string): PreviewState | undefined {
    return this.previews.get(previewKey(agentId, name))?.state
  }

  list(roomId: string): PreviewState[] {
    return [...this.previews.values()].map((p) => p.state).filter((s) => s.room_id === roomId)
  }

  /**
   * Output since `offset`; the returned offset is the next one to ask for. `reset` when the
   * offset is outside the retained log: `text` is then all of it, to replace what the reader has.
   */
  log(agentId: string, name: string, offset: number): { offset: number; text: string; reset: boolean } {
    const p = this.previews.get(previewKey(agentId, name))
    if (!p) return { offset: 0, text: '', reset: true }
    const start = p.logEnd - p.log.length
    const reset = offset < start || offset > p.logEnd
    return { offset: p.logEnd, text: p.log.slice(reset ? 0 : offset - start), reset }
  }

  /** The appservice token that may act as the agent: reads room state as it. */
  private tokenFor(agentId: string, name: string): string | undefined {
    return this.previews.get(previewKey(agentId, name))?.token
  }

  /**
   * True when the user has joined the preview's room; read as the agent, through its workstation's
   * token. Concurrent callers share one check; only a "joined" answer is cached.
   */
  isMember(userId: string, preview: PreviewState): Promise<boolean> {
    const token = this.tokenFor(preview.agent_id, preview.name)
    if (!token) return Promise.resolve(false)
    const key = `${preview.room_id}\n${userId}`
    const now = this.now()
    const hit = this.members.get(key)
    if (hit && now < hit.until) return hit.check
    for (const [k, v] of this.members) if (v.until <= now) this.members.delete(k)
    const check = stateEvent(this.deps.conn, token, preview.room_id, 'm.room.member', userId, preview.agent_id).then(
      (m) => m?.membership === 'join',
    )
    const entry = { until: now + MEMBER_TTL_MS, check }
    this.members.set(key, entry)
    const forget = () => void (this.members.get(key) === entry && this.members.delete(key))
    check.then((joined) => joined || forget(), forget)
    return check
  }

  /** False when the workstation is offline. */
  command(agentId: string, name: string, t: 'restart' | 'stop'): boolean {
    const tunnel = this.previews.get(previewKey(agentId, name))?.tunnel
    if (!tunnel) return false
    this.down(tunnel, { t, agent_id: agentId, name })
    return true
  }

  /** A byte stream to the app, through its workstation. */
  openStream(agentId: string, name: string): Promise<Duplex> {
    const tunnel = this.previews.get(previewKey(agentId, name))?.tunnel
    if (!tunnel) return Promise.reject(new Error('workstation offline'))
    const id = randomBytes(16).toString('hex')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.streams.delete(id)
        reject(new Error('the app did not answer'))
      }, STREAM_TIMEOUT_MS)
      timer.unref()
      this.streams.set(id, {
        tunnel,
        resolve: (socket) => {
          clearTimeout(timer)
          resolve(socket)
        },
      })
      this.down(tunnel, { t: 'open', stream: id, agent_id: agentId, name })
    })
  }

  // ── sessions ────────────────────────────────────────────────────────────

  createSession(agentId: string, name: string, userId: string, appOrigin: string): { url: string; expires_at: string } {
    const now = this.now()
    for (const [token, s] of [...this.sessions]) if (s.expires <= now) this.revoke(token)
    const token = randomBytes(16).toString('hex')
    const expires = now + SESSION_TTL_MS
    this.sessions.set(token, { token, key: previewKey(agentId, name), agentId, name, userId, appOrigin, expires })
    return { url: this.deps.origin.replace('*', token) + '/', expires_at: new Date(expires).toISOString() }
  }

  /** True when the request is for a preview origin (by Host). */
  isPreviewHost(host: string | undefined): boolean {
    return hostnameOf(host).endsWith('.' + this.hostSuffix)
  }

  /** The live session named by a preview Host, or undefined. */
  session(host: string | undefined): Session | undefined {
    const token = hostnameOf(host).slice(0, -(this.hostSuffix.length + 1))
    if (!TOKEN_RE.test(token)) return undefined
    const s = this.sessions.get(token)
    if (!s || s.expires <= this.now()) return undefined
    return s
  }

  /**
   * What the gateway serves for a preview Host: the session, when it is live and its user
   * is still in the room (see isMember). Leaving the room revokes it.
   * Rejects when the homeserver cannot answer.
   */
  async access(host: string | undefined): Promise<Session | 'expired' | 'not running'> {
    const session = this.session(host)
    if (!session) return 'expired'
    const state = this.get(session.agentId, session.name)
    if (state?.status !== 'running' && state?.status !== 'starting') return 'not running'
    if (!(await this.isMember(session.userId, state))) {
      this.revoke(session.token)
      return 'expired'
    }
    return session
  }

  private revoke(token: string): void {
    this.sessions.delete(token)
    for (const socket of this.sessionSockets.get(token) ?? []) socket.destroy()
    this.sessionSockets.delete(token)
  }

  private revokePreview(key: string): void {
    for (const s of [...this.sessions.values()]) if (s.key === key) this.revoke(s.token)
  }
}
