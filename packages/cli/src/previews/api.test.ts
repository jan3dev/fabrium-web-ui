import { describe, expect, it, vi } from 'vitest'
import { previewApi } from './api.js'
import type { PreviewHub } from './hub.js'
import type { PreviewState } from './protocol.js'

const AGENT = '@ws.coder:test'
const PREVIEW: PreviewState = {
  agent_id: AGENT,
  name: 'todo-app',
  title: 'Todo app',
  command: 'npm run dev',
  kind: 'web',
  room_id: '!room:test',
  thread_root: '$root',
  status: 'running',
  since: '2026-11-09T00:00:00.000Z',
  exit_code: null,
}
// OpenID token → user; alice is in the room, mallory is not, the agent is.
const USERS: Record<string, string> = { alice: '@alice:test', mallory: '@mallory:test', agent: AGENT }
const JOINED = new Set(['@alice:test', AGENT])

const fakeFetch = (async (input: string | URL) => {
  const url = new URL(String(input))
  if (url.pathname.endsWith('/openid/userinfo')) {
    const sub = USERS[url.searchParams.get('access_token') ?? '']
    return sub ? Response.json({ sub }) : new Response('{}', { status: 401 })
  }
  return new Response('{}', { status: 404 })
}) as typeof fetch

function setup() {
  const hub = {
    get: (agent: string, name: string) => (agent === AGENT && name === 'todo-app' ? PREVIEW : undefined),
    list: (room: string) => (room === PREVIEW.room_id ? [PREVIEW] : []),
    log: () => ({ offset: 5, text: 'ready' }),
    isMember: async (userId: string) => JOINED.has(userId),
    command: vi.fn(() => true),
    createSession: vi.fn(() => ({ url: 'http://abc.preview.localhost:9000/', expires_at: 'x' })),
  }
  const app = previewApi({
    hub: hub as unknown as PreviewHub,
    conn: { homeserver: 'http://hs.test', fetch: fakeFetch },
    serverName: 'test',
    isNotHuman: (userId) => userId === AGENT,
  })
  const call = (method: string, path: string, token: string, headers: Record<string, string> = {}) =>
    app.request(path, { method, headers: { authorization: `Bearer ${token}`, ...headers } })
  return { hub, call }
}

const ONE = `/${encodeURIComponent(AGENT)}/todo-app`

describe('preview API', () => {
  it('lets room members read and hides previews from everyone else', async () => {
    const { call } = setup()
    expect(await (await call('GET', '/?room=!room:test', 'alice')).json()).toEqual([PREVIEW])
    expect(await (await call('GET', '/?room=!room:test', 'mallory')).json()).toEqual([])
    const one = await call('GET', `${ONE}?log_offset=0`, 'alice')
    expect(await one.json()).toEqual({ ...PREVIEW, log: { offset: 5, text: 'ready' } })
    expect((await call('GET', ONE, 'mallory')).status).toBe(404)
    expect((await call('GET', ONE, 'nobody')).status).toBe(401)
  })

  it('opens sessions and runs commands for humans only', async () => {
    const { hub, call } = setup()
    expect((await call('POST', `${ONE}/session`, 'alice')).status).toBe(400)
    expect((await call('POST', `${ONE}/session`, 'alice', { origin: "http://a.test; script-src 'none'" })).status).toBe(400)
    const ok = await call('POST', `${ONE}/session`, 'alice', { origin: 'http://localhost:5173' })
    expect(await ok.json()).toEqual({ url: 'http://abc.preview.localhost:9000/', expires_at: 'x' })
    expect(hub.createSession).toHaveBeenCalledWith(AGENT, 'todo-app', '@alice:test', 'http://localhost:5173')
    expect((await call('POST', `${ONE}/session`, 'agent', { origin: 'http://localhost:5173' })).status).toBe(403)

    expect((await call('POST', `${ONE}/restart`, 'alice')).status).toBe(204)
    expect(hub.command).toHaveBeenCalledWith(AGENT, 'todo-app', 'restart')
    expect((await call('POST', `${ONE}/stop`, 'mallory')).status).toBe(404)
  })
})
