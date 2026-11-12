import { createServer, request, type IncomingMessage, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect, type AddressInfo, type Socket } from 'node:net'
import { Duplex } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGateway, frameAncestors, hostOnlyCookies } from './gateway.js'
import { PreviewHub } from './hub.js'
import { PreviewSupervisor } from './supervisor.js'
import { startTunnelClient, type TunnelClient } from './tunnel-client.js'
import { heartbeat, previewOriginProblem, type PreviewState } from './protocol.js'

const AGENT = '@ws.coder:test'
const TOKEN = 'as-token'

/** Who has joined the preview's room. */
const JOINED = new Set<string>()

/**
 * Homeserver stub: TOKEN is an appservice token that may act as AGENT, and nothing else.
 * USER_TOKEN is a person's token: like a real homeserver, whoami ignores `user_id` for it.
 */
const USER_TOKEN = 'user-token'
const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input))
  if (url.pathname === '/_matrix/client/v3/account/whoami') {
    if (new Headers(init?.headers).get('authorization') === `Bearer ${USER_TOKEN}`) {
      return Response.json({ user_id: '@mallory:test' })
    }
    const asUser = url.searchParams.get('user_id')
    return Response.json({ user_id: asUser === AGENT ? AGENT : '@ws:test' })
  }
  const member = /\/state\/m\.room\.member\/(.+)$/.exec(decodeURIComponent(url.pathname))?.[1]
  // Membership is read as the preview's agent, with its workstation's token.
  if (member && url.searchParams.get('user_id') === AGENT) {
    return JOINED.has(member) ? Response.json({ membership: 'join' }) : new Response('{}', { status: 404 })
  }
  return new Response('{}', { status: 404 })
}) as typeof fetch

function listen(server: Server): Promise<number> {
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r((server.address() as AddressInfo).port)))
}

/** Open an upgrade (an HMR WebSocket stand-in) through the gateway. */
function upgradeTo(port: number, host: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/hmr', headers: { host, connection: 'Upgrade', upgrade: 'echo' } })
    req.on('upgrade', (_res, socket: Socket) => resolve(socket))
    req.on('error', reject).end()
  })
}

/** The status line the server answers a raw tunnel upgrade with. */
function rawUpgrade(port: number, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port }, () =>
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: fabrium-tunnel\r\nAuthorization: Bearer x\r\n\r\n`),
    )
    socket.setEncoding('utf8').once('data', (d: string) => {
      resolve(d.split('\r\n')[0]!)
      socket.destroy()
    })
    socket.once('error', reject)
  })
}

function get(port: number, host: string, path = '/'): Promise<{ res: IncomingMessage; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
      let body = ''
      res.setEncoding('utf8').on('data', (c: string) => (body += c))
      res.on('end', () => resolve({ res, body }))
    })
    req.on('error', reject).end()
  })
}

async function until(check: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const end = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 50))
  }
}

const closers: Array<() => void> = []
afterEach(() => {
  while (closers.length) closers.pop()!()
})

describe('preview tunnel and gateway', () => {
  it('serves the app on its preview origin, injects the bridge, and passes upgrades', async () => {
    // The app: HTML with its own CSP and X-Frame-Options, plus an upgrade echo (HMR stand-in).
    let seenHost = ''
    let seenProto = ''
    const app = createServer((req, res) => {
      seenHost = req.headers.host ?? ''
      seenProto = String(req.headers['x-forwarded-proto'])
      res.writeHead(200, {
        'content-type': 'text/html',
        'x-frame-options': 'DENY',
        'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
      })
      res.end('<!doctype html><html><head><title>t</title></head><body>hello</body></html>')
    })
    app.on('upgrade', (_req, socket: Socket) => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: echo\r\nConnection: Upgrade\r\n\r\n')
      socket.pipe(socket)
    })
    const appPort = await listen(app)
    closers.push(() => app.close())

    // The central listener, wired as in start-daemon.ts.
    let hub!: PreviewHub
    let gateway!: ReturnType<typeof createGateway>
    const central = createServer((req, res) => {
      if (hub.isPreviewHost(req.headers.host)) gateway.handleRequest(req, res)
      else res.writeHead(404).end()
    })
    const centralPort = await listen(central)
    let clock = Date.now()
    hub = new PreviewHub({
      conn: { homeserver: 'http://hs.test', fetch: fakeFetch },
      origin: `http://*.preview.localhost:${centralPort}`,
      now: () => clock,
    })
    JOINED.add('@alice:test')
    closers.push(() => JOINED.clear())
    gateway = createGateway(hub)
    central.on('upgrade', (req, socket, head) => {
      if (hub.isPreviewHost(req.headers.host)) gateway.handleUpgrade(req, socket, head)
      else if (!hub.handleTunnelUpgrade(req, socket)) socket.destroy()
    })
    closers.push(() => {
      hub.close()
      central.close()
    })

    // The workstation side, with one running preview.
    const state: PreviewState = {
      agent_id: AGENT,
      name: 'todo-app',
      title: 'Todo app',
      command: 'npm run dev',
      kind: 'web',
      room_id: '!room:test',
      thread_root: '$root',
      status: 'running',
      since: new Date().toISOString(),
      exit_code: null,
    }
    const restarts: string[] = []
    const tunnel: TunnelClient = startTunnelClient({
      url: `http://127.0.0.1:${centralPort}`,
      asToken: TOKEN,
      snapshot: () => [{ preview: state, log: 'ready in 300 ms\n' }],
      port: () => appPort,
      restart: async (_agent, name) => void restarts.push(name),
      stop: async () => {},
    })
    closers.push(() => tunnel.close())
    await until(() => hub.get(AGENT, 'todo-app')?.status === 'running')
    expect(hub.log(AGENT, 'todo-app', 0)).toEqual({ offset: 17, text: 'ready in 300 ms\n', reset: true })

    // A token for another agent is refused.
    tunnel.send({ t: 'state', preview: { ...state, agent_id: '@other:test' } })
    tunnel.send({ t: 'log', agent_id: AGENT, name: 'todo-app', text: 'more\n' })
    await until(() => hub.log(AGENT, 'todo-app', 17).text === 'more\n')
    expect(hub.get('@other:test', 'todo-app')).toBeUndefined()

    // A person's own token cannot register previews as itself.
    const impostor = startTunnelClient({
      url: `http://127.0.0.1:${centralPort}`,
      asToken: USER_TOKEN,
      snapshot: () => [{ preview: { ...state, agent_id: '@mallory:test', name: 'fake' }, log: '' }],
      port: () => appPort,
      restart: async () => {},
      stop: async () => {},
    })
    closers.push(() => impostor.close())
    await new Promise((r) => setTimeout(r, 200))
    expect(hub.get('@mallory:test', 'fake')).toBeUndefined()

    // A malformed stream ID is refused, not decoded: a bad escape must not crash the daemon.
    expect(await rawUpgrade(centralPort, '/_fabrium/v1/tunnel/stream/%E0')).toBe('HTTP/1.1 404 Not Found')

    // No session, no app.
    const host = (url: string) => new URL(url).host
    expect((await get(centralPort, `${'0'.repeat(32)}.preview.localhost:${centralPort}`)).res.statusCode).toBe(404)

    const { url } = hub.createSession(AGENT, 'todo-app', '@alice:test', 'http://localhost:5173')
    const { res, body } = await get(centralPort, host(url))
    expect(res.statusCode).toBe(200)
    expect(body).toContain('<head><script src="/__fabrium/bridge.js"></script><title>')
    expect(res.headers['x-frame-options']).toBeUndefined()
    expect(res.headers['content-security-policy']).toBe("default-src 'self'; frame-ancestors http://localhost:5173")
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    expect(seenHost).toBe('localhost')

    const bridge = await get(centralPort, host(url), '/__fabrium/bridge.js')
    expect(bridge.body).toContain('"http://localhost:5173"')

    // An upgrade (HMR WebSocket) reaches the app and bytes flow both ways.
    const hmr = await upgradeTo(centralPort, host(url))
    const echoed = new Promise<string>((resolve) => hmr.setEncoding('utf8').once('data', resolve))
    hmr.write('ping')
    expect(await echoed).toBe('ping')

    // Expo: Metro writes the manifest's URLs from Host, so the public host reaches it.
    tunnel.send({ t: 'state', preview: { ...state, kind: 'expo' } })
    await until(() => hub.get(AGENT, 'todo-app')?.kind === 'expo')
    await get(centralPort, host(url))
    expect([seenHost, seenProto]).toEqual([host(url), 'http'])
    tunnel.send({ t: 'state', preview: state })

    // Membership is checked again after a minute; leaving the room ends the session and its sockets.
    clock += 61_000
    expect((await get(centralPort, host(url))).res.statusCode).toBe(200)
    JOINED.delete('@alice:test')
    clock += 61_000
    const hmrClosed = new Promise((r) => hmr.once('close', r))
    expect((await get(centralPort, host(url))).res.statusCode).toBe(404)
    await hmrClosed
    JOINED.add('@alice:test')
    expect((await get(centralPort, host(url))).res.statusCode).toBe(404)

    // Stopping the app ends its links; a restart does not bring them back.
    const stopped = hub.createSession(AGENT, 'todo-app', '@alice:test', 'http://localhost:5173')
    tunnel.send({ t: 'state', preview: { ...state, status: 'stopped' } })
    await until(() => hub.get(AGENT, 'todo-app')?.status === 'stopped')
    tunnel.send({ t: 'state', preview: state })
    await until(() => hub.get(AGENT, 'todo-app')?.status === 'running')
    expect((await get(centralPort, host(stopped.url))).res.statusCode).toBe(404)
    const live = hub.createSession(AGENT, 'todo-app', '@alice:test', 'http://localhost:5173')

    // Commands reach the workstation; a lost tunnel marks the preview offline.
    expect(hub.command(AGENT, 'todo-app', 'restart')).toBe(true)
    await until(() => restarts.length === 1)
    tunnel.close()
    await until(() => hub.get(AGENT, 'todo-app')?.status === 'offline')
    expect((await get(centralPort, host(live.url))).res.statusCode).toBe(503)
  })
})

describe('PreviewSupervisor', () => {
  it('runs the app with a clean environment, reports it running, and stops it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'preview-'))
    closers.push(() => rmSync(dir, { recursive: true, force: true }))
    process.env.ZOOID_TEST_SECRET = 'leak'
    closers.push(() => delete process.env.ZOOID_TEST_SECRET)
    const events: Array<Record<string, unknown>> = []
    const states: string[] = []
    const supervisor = new PreviewSupervisor({
      agents: { coder: { userId: AGENT, workdir: dir } },
      max: 3,
      stateFile: join(dir, 'previews.json'),
      sendEvent: async (_u, _r, content) => void events.push(content),
      isEncrypted: async () => false,
      onState: (s) => states.push(s.status),
    })
    closers.push(() => void supervisor.shutdown())
    const caller = { agentName: 'coder', channelId: '!room:test', threadId: '$root' }
    const app =
      'node -e "console.log(\'secret=\' + (process.env.ZOOID_TEST_SECRET ?? \'none\')); ' +
      "require('http').createServer((q, s) => s.end('ok')).listen(process.env.PORT, '127.0.0.1')\""

    const started = await supervisor.start(caller, { name: 'todo-app', command: app })
    expect(started.status).toBe('running')
    expect(started.logs_tail).toContain('secret=none')
    expect(events[0]?.['dev.fabrium.preview']).toMatchObject({ name: 'todo-app', action: 'started' })
    expect(supervisor.port(AGENT, 'todo-app')).toBe(started.port)

    const stopped = await supervisor.stop(caller, { name: 'todo-app' })
    expect(stopped.status).toBe('stopped')
    expect(states).toEqual(['starting', 'running', 'stopped'])

    // Two starts of one name run one after the other: the second replaces the first on its port.
    const [first, second] = await Promise.all([
      supervisor.start(caller, { name: 'twice', command: app }),
      supervisor.start(caller, { name: 'twice', command: app }),
    ])
    expect(second.status).toBe('running')
    expect(second.port).toBe(first.port)
    await supervisor.stop(caller, { name: 'twice' })

    const crashed = await supervisor.start(caller, { name: 'broken', command: 'echo boom; exit 3' })
    expect(crashed).toMatchObject({ status: 'crashed', exit_code: 3 })
    expect(crashed.logs_tail).toContain('boom')

    // `expo start` needs CI=1 to run without a keyboard.
    const expo = await supervisor.start(caller, { name: 'phone', kind: 'expo', command: 'echo ci=$CI' })
    expect(expo.logs_tail).toContain('ci=1')
    expect(events.at(-1)?.['dev.fabrium.preview']).toMatchObject({ name: 'phone', kind: 'expo' })
    await expect(supervisor.start(caller, { name: 'x', kind: 'ios' as never, command: 'true' })).rejects.toThrow(/invalid_kind/)

    await expect(supervisor.start({ ...caller, threadId: '' }, { name: 'x', command: 'true' })).rejects.toThrow(/threads/)
    // The app runs inside the workdir, with no loader or shell variables from the model.
    await expect(supervisor.start(caller, { name: 'x', command: 'true', cwd: '..' })).rejects.toThrow(/invalid_cwd/)
    await expect(supervisor.start(caller, { name: 'x', command: 'true', cwd: '/' })).rejects.toThrow(/invalid_cwd/)
    await expect(
      supervisor.start(caller, { name: 'x', command: 'true', env: { LD_PRELOAD: '/tmp/x.so' } }),
    ).rejects.toThrow(/invalid_env: LD_PRELOAD/)
    await expect(supervisor.start(caller, { name: 'Bad Name', command: 'true' })).rejects.toThrow(/invalid_name/)
  })
})

describe('heartbeat', () => {
  it('pings, and ends a connection that stays silent for over a minute', () => {
    vi.useFakeTimers()
    try {
      const sent: string[] = []
      const socket = new Duplex({
        read() {},
        write(chunk: Buffer, _enc, done) {
          sent.push(String(chunk))
          done()
        },
      })
      heartbeat(socket)
      vi.advanceTimersByTime(20_000)
      expect(sent).toEqual(['{"t":"ping"}\n'])
      expect(socket.destroyed).toBe(false)
      vi.advanceTimersByTime(60_000) // checked every 20 s: cut at 80 s
      expect(socket.destroyed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('gateway headers', () => {
  it('replaces frame-ancestors in every policy and keeps cookies host-only', () => {
    expect(frameAncestors("default-src 'self', frame-ancestors 'none'", 'http://app')).toBe(
      "default-src 'self'; frame-ancestors http://app, frame-ancestors http://app",
    )
    expect(hostOnlyCookies(['a=1; Domain=preview.localhost; Path=/', 'b=2'])).toEqual(['a=1; Path=/', 'b=2'])
  })
})

describe('previewOriginProblem', () => {
  it('refuses a preview origin on the same site as the homeserver', () => {
    expect(previewOriginProblem('https://*.preview.example.net', 'https://fabrium.example.net')).toMatch(/same site/)
    expect(previewOriginProblem('https://*.fabrium-preview.net', 'https://fabrium.example.net')).toBeNull()
    expect(previewOriginProblem('http://*.preview.localhost:9000', 'http://localhost:8448')).toBeNull()
  })
})
