/**
 * Test helper: a small in-memory homeserver behind a `fetch`. It answers the
 * calls of the VM API the way tuwunel 1.9.3 does for the cases the tests need.
 * Production code never imports it.
 */

export interface FakeCall {
  method: string
  /** Path and query, as sent. */
  path: string
}

export interface FakeMatrix {
  fetch: typeof fetch
  serverName: string
  /** The token of the central appservice, `@zooid`. */
  centralToken: string
  /** The workforce space. */
  spaceId: string
  calls: FakeCall[]
  /** A new OpenID access token for `userId`. */
  openIdToken(userId: string): string
  addUser(userId: string): void
  setMember(roomId: string, userId: string, membership: string): void
  setLevel(roomId: string, userId: string, level: number): void
  setPowerLevels(roomId: string, content: Record<string, unknown>): void
  setCreate(roomId: string, content: Record<string, unknown>, sender: string): void
  /** Join `userId` to the workforce space, with a power level when given. */
  joinSpace(userId: string, level?: number): void
  /** The next request that matches answers `status`. */
  failOnce(method: string, path: RegExp, status: number): void
}

interface StateEvent {
  content: Record<string, unknown>
  sender: string
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export function createFakeMatrix(opts: { serverName?: string } = {}): FakeMatrix {
  const serverName = opts.serverName ?? 'example.org'
  const centralToken = 'central-token'
  const zooid = `@zooid:${serverName}`
  const spaceId = `!space:${serverName}`
  const users = new Set<string>([zooid])
  const openIdTokens = new Map<string, string>()
  const rooms = new Map<string, Map<string, StateEvent>>()
  const failures: { method: string; path: RegExp; status: number }[] = []
  const calls: FakeCall[] = []

  const stateKeyOf = (type: string, stateKey: string) => `${type}\n${stateKey}`
  const stateOf = (roomId: string) => {
    let state = rooms.get(roomId)
    if (!state) rooms.set(roomId, (state = new Map()))
    return state
  }
  const setState = (
    roomId: string,
    type: string,
    stateKey: string,
    content: Record<string, unknown>,
    sender = zooid,
  ) => {
    stateOf(roomId).set(stateKeyOf(type, stateKey), { content, sender })
  }
  const setPowerLevels = (roomId: string, content: Record<string, unknown>) =>
    setState(roomId, 'm.room.power_levels', '', content)

  setState(spaceId, 'm.room.create', '', { room_version: '11' })
  setPowerLevels(spaceId, { users: { [zooid]: 100 }, users_default: 0 })
  setState(spaceId, 'm.room.member', zooid, { membership: 'join' })

  function handle(method: string, url: URL, token: string | undefined): Response {
    const path = url.pathname
    if (method === 'GET' && path === '/_matrix/federation/v1/openid/userinfo') {
      const sub = openIdTokens.get(url.searchParams.get('access_token') ?? '')
      return sub ? json(200, { sub }) : json(401, { errcode: 'M_UNAUTHORIZED' })
    }
    if (token !== centralToken) return json(401, { errcode: 'M_UNKNOWN_TOKEN' })
    if (method === 'GET' && path === '/_matrix/client/v3/account/whoami') {
      return json(200, { user_id: zooid })
    }
    if (method === 'GET' && path === '/_matrix/client/v3/register/available') {
      const user = `@${url.searchParams.get('username')}:${serverName}`
      return users.has(user)
        ? json(400, { errcode: 'M_USER_IN_USE' })
        : json(200, { available: true })
    }
    const full = /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/state$/.exec(path)
    if (method === 'GET' && full) {
      const state = rooms.get(decodeURIComponent(full[1]!))
      if (!state) return json(403, { errcode: 'M_FORBIDDEN' })
      return json(
        200,
        [...state.entries()].map(([k, ev]) => {
          const [type, stateKey] = k.split('\n')
          return { type, state_key: stateKey, content: ev.content, sender: ev.sender }
        }),
      )
    }
    const one = /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/state\/([^/]+)(?:\/(.*))?$/.exec(path)
    if (method === 'GET' && one) {
      const event = rooms
        .get(decodeURIComponent(one[1]!))
        ?.get(stateKeyOf(decodeURIComponent(one[2]!), decodeURIComponent(one[3] ?? '')))
      return event ? json(200, event.content) : json(404, { errcode: 'M_NOT_FOUND' })
    }
    return json(404, { errcode: 'M_UNRECOGNIZED', error: `${method} ${path}` })
  }

  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    )
    const method = (init?.method ?? 'GET').toUpperCase()
    const auth = new Headers(init?.headers).get('authorization')
    calls.push({ method, path: url.pathname + url.search })
    const failure = failures.find((f) => f.method === method && f.path.test(url.pathname))
    if (failure) {
      failures.splice(failures.indexOf(failure), 1)
      return json(failure.status, { errcode: 'M_UNKNOWN', error: 'injected failure' })
    }
    return handle(method, url, auth?.replace(/^Bearer /, ''))
  }) as typeof fetch

  return {
    fetch: fakeFetch,
    serverName,
    centralToken,
    spaceId,
    calls,
    openIdToken(userId) {
      const token = `openid-${openIdTokens.size + 1}`
      openIdTokens.set(token, userId)
      return token
    },
    addUser: (userId) => void users.add(userId),
    setMember: (roomId, userId, membership) => setState(roomId, 'm.room.member', userId, { membership }),
    setLevel(roomId, userId, level) {
      const current = stateOf(roomId).get(stateKeyOf('m.room.power_levels', ''))?.content ?? {}
      setPowerLevels(roomId, {
        ...current,
        users: { ...(current.users as Record<string, number> | undefined), [userId]: level },
      })
    },
    setPowerLevels,
    setCreate: (roomId, content, sender) => setState(roomId, 'm.room.create', '', content, sender),
    joinSpace(userId, level) {
      users.add(userId)
      setState(spaceId, 'm.room.member', userId, { membership: 'join' })
      if (level !== undefined) this.setLevel(spaceId, userId, level)
    },
    failOnce: (method, path, status) => void failures.push({ method, path, status }),
  }
}
