// Workstation side: runs the agents' preview apps (PREVIEWS_SPEC.md §4.1, §4.2).
// The daemon owns the process so the app outlives the agent's turn.
import { spawn, type ChildProcess } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { isAbsolute, resolve } from 'node:path'
import type { PreviewCallerRef } from '@zooid/context-mcp'
import { LOG_LIMIT, NAME_RE, dialLoopback, previewKey, type PreviewKind, type PreviewState, type PreviewStatus } from './protocol.js'

const PREVIEW_EVENT_KEY = 'dev.fabrium.preview'
const READY_TIMEOUT_MS = 60_000
const STOP_GRACE_MS = 5_000
const PORT_RANGE = [20000, 29999] as const
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

export interface PreviewAgent {
  userId: string
  /** Absolute host workdir. */
  workdir: string
}

export interface PreviewStartInput {
  name: string
  command: string
  title?: string
  port?: number
  cwd?: string
  env?: Record<string, string>
  kind?: PreviewKind
}

export interface PreviewStartResult {
  name: string
  status: PreviewStatus
  port: number
  exit_code: number | null
  logs_tail: string
}

export interface SupervisorDeps {
  /** The agents that may run previews: `runtime: local` only in v1. */
  agents: Record<string, PreviewAgent>
  max: number
  /** Persisted registry; previews restart when the daemon starts. */
  stateFile?: string
  sendEvent(agentUserId: string, roomId: string, content: Record<string, unknown>): Promise<void>
  isEncrypted(roomId: string, agentUserId: string): Promise<boolean>
  onState?(state: PreviewState): void
  onLog?(agentId: string, name: string, text: string): void
  /** A preview left the registry (old stopped ones beyond the cap). */
  onRemove?(agentId: string, name: string): void
  readyTimeoutMs?: number
}

interface Entry {
  agentName: string
  state: PreviewState
  port: number
  cwd: string
  env: Record<string, string>
  child?: ChildProcess
  stopping: boolean
  log: string
  startedAt: number
  /** Resolves on running, exit, or the first readiness timeout. */
  settled?: Promise<void>
}

type Persisted = Pick<Entry, 'agentName' | 'port' | 'cwd' | 'env'> & { state: PreviewState }

function tail(text: string, lines: number): string {
  return text.split('\n').slice(-lines - 1).join('\n')
}

/** True when something accepts TCP on the port. */
function portOpen(port: number): Promise<boolean> {
  return dialLoopback(port, 1000).then(
    (socket) => (socket.destroy(), true),
    () => false,
  )
}

function portFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer()
    server.once('error', () => done(false))
    server.listen({ port, host: '127.0.0.1' }, () => server.close(() => done(true)))
  })
}

export class PreviewSupervisor {
  private readonly entries = new Map<string, Entry>()
  /** Preview key → its last operation: start, stop and restart of one preview run one at a time. */
  private readonly queues = new Map<string, Promise<unknown>>()
  /** Set at shutdown: the saved registry keeps what ran, not the stops that shutdown causes. */
  private closing = false

  constructor(private readonly deps: SupervisorDeps) {}

  private agent(name: string): PreviewAgent {
    const agent = this.deps.agents[name]
    if (!agent) throw new Error('unsupported: previews need `runtime: local` for this agent')
    return agent
  }

  private own(agentName: string, name: string): Entry {
    const entry = this.entries.get(previewKey(this.agent(agentName).userId, name))
    if (!entry) throw new Error(`not_found: no preview "${name}". Start it with zooid_preview_start.`)
    return entry
  }

  /** Every preview with its retained output, for a new tunnel connection. */
  snapshot(): Array<{ preview: PreviewState; log: string }> {
    return [...this.entries.values()].map((e) => ({ preview: e.state, log: e.log }))
  }

  /** The loopback port of a preview, for the tunnel. Undefined unless it is running or starting. */
  port(agentId: string, name: string): number | undefined {
    const entry = this.entries.get(previewKey(agentId, name))
    return entry && (entry.state.status === 'running' || entry.state.status === 'starting') ? entry.port : undefined
  }

  async start(caller: PreviewCallerRef, input: PreviewStartInput): Promise<PreviewStartResult> {
    const agent = this.agent(caller.agentName)
    if (!NAME_RE.test(input.name ?? '')) {
      throw new Error('invalid_name: use kebab-case, e.g. "todo-app" (max 40 characters).')
    }
    const command = (input.command ?? '').trim()
    if (!command || command.length > 2000) throw new Error('invalid_command: give the shell command that starts the app.')
    if (!caller.threadId.startsWith('$')) {
      throw new Error('unsupported: previews are shown in threads. Reply in a thread to use zooid_preview_start.')
    }
    if (input.port !== undefined && (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535)) {
      throw new Error('invalid_port: use a port from 1024 to 65535, or leave it out.')
    }
    const kind = input.kind ?? 'web'
    if (kind !== 'web' && kind !== 'expo') throw new Error('invalid_kind: use "web" or "expo".')
    const env: Record<string, string> = {}
    for (const [key, value] of Object.entries(input.env ?? {})) {
      if (!ENV_KEY_RE.test(key) || typeof value !== 'string') throw new Error(`invalid_env: ${key}`)
      env[key] = value
    }
    if (await this.deps.isEncrypted(caller.channelId, agent.userId)) {
      throw new Error('unsupported: previews are off in encrypted rooms.')
    }

    const key = previewKey(agent.userId, input.name)
    const entry = await this.serial(key, async () => {
      const previous = this.entries.get(key)
      if (previous) await this.kill(previous)
      const port = input.port ?? previous?.port ?? (await this.freePort())
      const entry: Entry = {
        agentName: caller.agentName,
        port,
        cwd: input.cwd ? (isAbsolute(input.cwd) ? input.cwd : resolve(agent.workdir, input.cwd)) : agent.workdir,
        env,
        stopping: false,
        log: '',
        startedAt: Date.now(),
        state: {
          agent_id: agent.userId,
          name: input.name,
          title: (input.title ?? '').trim().slice(0, 120) || input.name,
          command,
          kind,
          room_id: caller.channelId,
          thread_root: caller.threadId,
          status: 'starting',
          since: new Date().toISOString(),
          exit_code: null,
        },
      }
      this.entries.delete(key)
      this.entries.set(key, entry)
      await this.enforceMax(key)
      this.spawn(entry)
      this.persist()
      await this.notify(entry, 'started', `Preview: ${entry.state.title} (${command})`)
      return entry
    })
    await entry.settled
    return this.result(entry)
  }

  async stop(caller: PreviewCallerRef, input: { name: string }): Promise<{ name: string; status: PreviewStatus }> {
    const entry = this.own(caller.agentName, input.name)
    await this.serial(previewKey(entry.state.agent_id, input.name), async () => {
      await this.kill(entry)
      await this.notify(entry, 'stopped', `Preview stopped: ${entry.state.title}`)
    })
    return { name: input.name, status: entry.state.status }
  }

  logs(caller: PreviewCallerRef, input: { name: string; lines?: number }): PreviewStartResult {
    const entry = this.own(caller.agentName, input.name)
    return { ...this.result(entry), logs_tail: tail(entry.log, Math.min(Math.max(input.lines ?? 100, 1), 1000)) }
  }

  /** From a human in the web UI, through the gateway. */
  restartById(agentId: string, name: string): Promise<void> {
    const key = previewKey(agentId, name)
    return this.serial(key, async () => {
      const entry = this.entries.get(key)
      if (!entry) return
      await this.kill(entry)
      entry.stopping = false
      entry.startedAt = Date.now()
      this.spawn(entry)
      this.persist()
    })
  }

  stopById(agentId: string, name: string): Promise<void> {
    const key = previewKey(agentId, name)
    return this.serial(key, async () => {
      const entry = this.entries.get(key)
      if (entry) await this.kill(entry)
    })
  }

  private serial<T>(key: string, op: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(key) ?? Promise.resolve()).then(op, op)
    this.queues.set(key, run.catch(() => {}))
    return run
  }

  /** Restart what ran before the daemon stopped. */
  resume(): void {
    if (!this.deps.stateFile) return
    let saved: Persisted[] = []
    try {
      saved = JSON.parse(readFileSync(this.deps.stateFile, 'utf8')) as Persisted[]
    } catch {
      return
    }
    for (const s of saved) {
      const agent = this.deps.agents[s.agentName]
      if (!agent || agent.userId !== s.state?.agent_id) continue
      // Registries saved before `kind` existed hold web apps.
      const entry: Entry = { ...s, state: { ...s.state, kind: s.state.kind ?? 'web' }, stopping: false, log: '', startedAt: Date.now() }
      const key = previewKey(agent.userId, s.state.name)
      this.entries.set(key, entry)
      if (s.state.status === 'stopped') this.emit(entry)
      else void this.serial(key, () => this.respawn(entry))
    }
  }

  /**
   * After a daemon crash the old app can outlive it and still hold its port: then the
   * readiness check would see the old app. Move to a free port instead.
   */
  private async respawn(entry: Entry): Promise<void> {
    try {
      if (await portOpen(entry.port)) {
        this.appendLog(entry, `[port ${entry.port} is in use, perhaps by this app from before the restart; using a new port]\n`)
        entry.port = await this.freePort()
      }
      this.spawn(entry)
      this.persist()
    } catch (err) {
      this.appendLog(entry, `[cannot start: ${(err as Error).message}]\n`)
      this.setStatus(entry, 'crashed', 1)
    }
  }

  /** Daemon shutdown: stop the apps, keep the registry for the next start. */
  async shutdown(): Promise<void> {
    this.persist()
    this.closing = true
    await Promise.all([...this.entries.values()].map((e) => this.kill(e, false)))
  }

  private result(entry: Entry): PreviewStartResult {
    return {
      name: entry.state.name,
      status: entry.state.status,
      port: entry.port,
      exit_code: entry.state.exit_code,
      logs_tail: tail(entry.log, 30),
    }
  }

  /** The `dev.fabrium.preview` notice in the preview's thread (spec §6). */
  private notify(entry: Entry, action: 'started' | 'stopped', body: string): Promise<void> {
    const { agent_id, room_id, thread_root, name, title, command, kind } = entry.state
    return this.deps.sendEvent(agent_id, room_id, {
      msgtype: 'm.notice',
      body,
      [PREVIEW_EVENT_KEY]: { name, title, command, kind, action },
      'm.relates_to': { rel_type: 'm.thread', event_id: thread_root },
    })
  }

  private emit(entry: Entry): void {
    this.deps.onState?.(entry.state)
  }

  private setStatus(entry: Entry, status: PreviewStatus, exitCode: number | null = null): void {
    entry.state = { ...entry.state, status, exit_code: exitCode, since: new Date().toISOString() }
    this.emit(entry)
  }

  private appendLog(entry: Entry, text: string): void {
    entry.log = (entry.log + text).slice(-LOG_LIMIT)
    this.deps.onLog?.(entry.state.agent_id, entry.state.name, text)
  }

  private spawn(entry: Entry): void {
    this.setStatus(entry, 'starting')
    // A clean environment: the daemon's holds the appservice token and secrets.env.
    const child = spawn('sh', ['-c', entry.state.command], {
      cwd: entry.cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: process.env.HOME ?? entry.cwd,
        LANG: process.env.LANG ?? 'C.UTF-8',
        BROWSER: 'none',
        // `expo start` waits for keyboard input unless it runs as CI.
        ...(entry.state.kind === 'expo' ? { CI: '1' } : {}),
        ...entry.env,
        PORT: String(entry.port),
      },
    })
    entry.child = child
    child.stdout?.setEncoding('utf8').on('data', (t: string) => this.appendLog(entry, t))
    child.stderr?.setEncoding('utf8').on('data', (t: string) => this.appendLog(entry, t))

    let settle!: () => void
    entry.settled = new Promise<void>((r) => (settle = r))
    const timeout = setTimeout(settle, this.deps.readyTimeoutMs ?? READY_TIMEOUT_MS)
    const done = () => {
      clearTimeout(timeout)
      settle()
    }
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (entry.child !== child) return
      entry.child = undefined
      if (entry.stopping) this.setStatus(entry, 'stopped')
      else {
        this.appendLog(entry, `\n[app exited with ${code ?? signal}]\n`)
        this.setStatus(entry, 'crashed', code ?? 1)
      }
      done()
    }
    child.once('exit', onExit)
    child.once('error', (err) => {
      this.appendLog(entry, `[cannot start: ${err.message}]\n`)
      onExit(127, null)
    })
    // Poll until the port opens or the process ends; keeps polling after the tool returns.
    const poll = async () => {
      while (entry.child === child && entry.state.status === 'starting') {
        if (await portOpen(entry.port)) {
          if (entry.child === child) this.setStatus(entry, 'running')
          break
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      done()
    }
    void poll()
  }

  private kill(entry: Entry, markStopped = true): Promise<void> {
    const child = entry.child
    entry.stopping = true
    if (!child || child.exitCode !== null) {
      entry.child = undefined
      if (markStopped && entry.state.status !== 'stopped') this.setStatus(entry, 'stopped')
      this.persist()
      return Promise.resolve()
    }
    return new Promise<void>((done) => {
      const pid = child.pid!
      // The whole group: `npm run dev` forks the real app.
      const signal = (sig: NodeJS.Signals | 0): boolean => {
        try {
          process.kill(-pid, sig)
          return true
        } catch {
          return false // already gone
        }
      }
      const deadline = Date.now() + STOP_GRACE_MS
      const force = setTimeout(() => signal('SIGKILL'), STOP_GRACE_MS)
      // `sh` can exit before the app it forked, which may still hold the port: wait for the group.
      const finish = () => {
        if (signal(0) && Date.now() < deadline) return void setTimeout(finish, 100)
        signal('SIGKILL')
        this.persist()
        done()
      }
      child.once('exit', () => {
        clearTimeout(force)
        finish()
      })
      signal('SIGTERM')
    })
  }

  private async enforceMax(keep: string): Promise<void> {
    const live = [...this.entries.entries()]
      .filter(([k, e]) => k !== keep && e.state.status !== 'stopped')
      .sort((a, b) => a[1].startedAt - b[1].startedAt)
    while (live.length >= this.deps.max) await this.kill(live.shift()![1])
    // Stopped previews stay visible as stopped; drop the oldest beyond a few.
    const stopped = [...this.entries.entries()].filter(([, e]) => e.state.status === 'stopped')
    for (const [k, e] of stopped.slice(0, Math.max(0, stopped.length - 10))) {
      this.entries.delete(k)
      this.deps.onRemove?.(e.state.agent_id, e.state.name)
    }
  }

  private async freePort(): Promise<number> {
    const used = new Set([...this.entries.values()].map((e) => e.port))
    for (let i = 0; i < 50; i++) {
      const port = PORT_RANGE[0] + Math.floor(Math.random() * (PORT_RANGE[1] - PORT_RANGE[0]))
      if (!used.has(port) && (await portFree(port))) return port
    }
    throw new Error('no_port: no free port in 20000-29999')
  }

  private persist(): void {
    if (!this.deps.stateFile || this.closing) return
    const saved: Persisted[] = [...this.entries.values()].map((e) => ({
      agentName: e.agentName,
      port: e.port,
      cwd: e.cwd,
      env: e.env,
      state: e.state,
    }))
    try {
      writeFileSync(this.deps.stateFile, JSON.stringify(saved, null, 2), { mode: 0o600 })
    } catch (err) {
      console.warn('[previews] cannot save the registry:', (err as Error).message)
    }
  }
}
