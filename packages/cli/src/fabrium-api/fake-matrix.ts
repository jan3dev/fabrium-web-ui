/**
 * Test helper: an in-memory homeserver behind a `fetch`, answering like tuwunel 1.9.3 for the
 * cases the tests need (including `!admin appservices register`). Production code never imports it.
 */
import { parse } from 'yaml'

export interface FakeCall {
  method: string
  /** Path and query, as sent. */
  path: string
}

export interface FakeMessage {
  roomId: string
  sender: string
  body: string
}

type JoinRule = 'invite' | 'public'

export interface FakeMatrix {
  fetch: typeof fetch
  serverName: string
  /** The token of the central appservice, `@zooid`. */
  centralToken: string
  /** The workforce space (alias `#dev`). Invite only. */
  spaceId: string
  /** `#general`. Anyone can join. */
  generalRoomId: string
  /** `#admins`, joined by `@zooid`. */
  adminRoomId: string
  calls: FakeCall[]
  /** Every `m.room.message` that was sent. */
  messages: FakeMessage[]
  knobs: {
    /** When false the admin room takes a command and nothing happens. */
    adminCommandWorks: boolean
    /** whoami fails this many times after a registration, as a slow load does. */
    registerAfterWhoamiPolls: number
  }
  /** A new OpenID access token for `userId`. */
  openIdToken(userId: string): string
  /** Load an appservice, as `!admin appservices register` does: its token answers whoami as `@<senderLocalpart>`. */
  registerAppservice(registration: {
    id: string
    asToken: string
    senderLocalpart: string
    /** Regex of the users it owns. */
    users: string
  }): void
  addUser(userId: string): void
  userExists(userId: string): boolean
  /** A room that `@zooid` has joined. `alias` gets the server name when it has none. */
  addRoom(alias: string, roomId: string, joinRule: JoinRule): void
  membership(roomId: string, userId: string): string | undefined
  state(roomId: string, type: string, stateKey: string): Record<string, unknown> | undefined
  /** Set one state event, sent by `@zooid`. */
  setState(roomId: string, type: string, stateKey: string, content: Record<string, unknown>): void
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

interface Appservice {
  id: string
  sender: string
  users: RegExp
  delayPolls: number
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function createFakeMatrix(opts: { serverName?: string } = {}): FakeMatrix {
  const serverName = opts.serverName ?? 'example.org'
  const centralToken = 'central-token'
  const zooid = `@zooid:${serverName}`
  const spaceId = `!space:${serverName}`
  const generalRoomId = `!general:${serverName}`
  const adminRoomId = `!admins:${serverName}`
  const users = new Set<string>([zooid])
  const openIdTokens = new Map<string, string>()
  const rooms = new Map<string, Map<string, StateEvent>>()
  const joinRules = new Map<string, JoinRule>()
  const aliases = new Map<string, string>()
  const appservices = new Map<string, Appservice>()
  const failures: { method: string; path: RegExp; status: number }[] = []
  const calls: FakeCall[] = []
  const messages: FakeMessage[] = []
  const knobs = { adminCommandWorks: true, registerAfterWhoamiPolls: 0 }

  appservices.set(centralToken, {
    id: 'zooid',
    sender: zooid,
    users: new RegExp(`^@.*:${escapeRegExp(serverName)}$`),
    delayPolls: 0,
  })

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
  const getState = (roomId: string, type: string, stateKey: string) =>
    rooms.get(roomId)?.get(stateKeyOf(type, stateKey))?.content
  const membershipOf = (roomId: string, userId: string) =>
    getState(roomId, 'm.room.member', userId)?.membership as string | undefined
  const setPowerLevels = (roomId: string, content: Record<string, unknown>) =>
    setState(roomId, 'm.room.power_levels', '', content)
  const addRoom = (alias: string, roomId: string, joinRule: JoinRule) => {
    joinRules.set(roomId, joinRule)
    aliases.set(alias.includes(':') ? alias : `${alias}:${serverName}`, roomId)
    setState(roomId, 'm.room.member', zooid, { membership: 'join' })
  }

  addRoom('#dev', spaceId, 'invite')
  setState(spaceId, 'm.room.create', '', { room_version: '11' })
  setPowerLevels(spaceId, { users: { [zooid]: 100 }, users_default: 0 })
  addRoom('#general', generalRoomId, 'public')
  addRoom('#admins', adminRoomId, 'invite')

  /** What tuwunel does with a message in the admin room: `!admin appservices register` and a code block. */
  function runAdminCommand(text: string): void {
    const match = /^!admin appservices register\n```\n([\s\S]*)\n```$/.exec(text)
    if (!knobs.adminCommandWorks || !match) return
    const registration = parse(match[1]!) as {
      id: string
      as_token: string
      sender_localpart: string
      namespaces: { users: { regex: string }[] }
    }
    registerAppservice({
      id: registration.id,
      asToken: registration.as_token,
      senderLocalpart: registration.sender_localpart,
      users: registration.namespaces.users[0]!.regex,
    })
  }

  function registerAppservice(r: {
    id: string
    asToken: string
    senderLocalpart: string
    users: string
  }): void {
    // tuwunel 1.9.3 refuses a loaded ID: "Duplicate id".
    if ([...appservices.values()].some((a) => a.id === r.id)) return
    const sender = `@${r.senderLocalpart}:${serverName}`
    appservices.set(r.asToken, {
      id: r.id,
      sender,
      users: new RegExp(r.users, 'i'),
      delayPolls: knobs.registerAfterWhoamiPolls,
    })
    users.add(sender)
  }

  function handle(
    method: string,
    url: URL,
    token: string | undefined,
    body: Record<string, unknown> | undefined,
  ): Response {
    const path = url.pathname
    if (method === 'GET' && path === '/_matrix/federation/v1/openid/userinfo') {
      const sub = openIdTokens.get(url.searchParams.get('access_token') ?? '')
      return sub ? json(200, { sub }) : json(401, { errcode: 'M_UNAUTHORIZED' })
    }
    const as = token ? appservices.get(token) : undefined
    if (!as) return json(401, { errcode: 'M_UNKNOWN_TOKEN' })
    const actor = url.searchParams.get('user_id') ?? as.sender
    const mayAct = actor === as.sender || as.users.test(actor)
    const forbidden = () => json(403, { errcode: 'M_FORBIDDEN' })

    if (method === 'GET' && path === '/_matrix/client/v3/account/whoami') {
      if (as.delayPolls > 0) {
        as.delayPolls--
        return json(401, { errcode: 'M_UNKNOWN_TOKEN' })
      }
      return json(200, { user_id: as.sender })
    }
    if (method === 'GET' && path === '/_matrix/client/v3/register/available') {
      const user = `@${url.searchParams.get('username')}:${serverName}`
      return users.has(user)
        ? json(400, { errcode: 'M_USER_IN_USE' })
        : json(200, { available: true })
    }
    if (method === 'POST' && path === '/_matrix/client/v3/register') {
      const user = `@${body?.username}:${serverName}`
      if (user !== as.sender && !as.users.test(user)) return json(403, { errcode: 'M_EXCLUSIVE' })
      if (users.has(user)) return json(400, { errcode: 'M_USER_IN_USE' })
      users.add(user)
      return json(200, { user_id: user, device_id: 'DEVICE' })
    }
    const alias = /^\/_matrix\/client\/v3\/directory\/room\/([^/]+)$/.exec(path)
    if (method === 'GET' && alias) {
      const roomId = aliases.get(decodeURIComponent(alias[1]!))
      return roomId ? json(200, { room_id: roomId }) : json(404, { errcode: 'M_NOT_FOUND' })
    }
    const join = /^\/_matrix\/client\/v3\/join\/([^/]+)$/.exec(path)
    if (method === 'POST' && join) {
      const target = decodeURIComponent(join[1]!)
      const roomId = aliases.get(target) ?? target
      const current = membershipOf(roomId, actor)
      const allowed = current === 'join' || current === 'invite' || joinRules.get(roomId) === 'public'
      if (!mayAct || current === 'ban' || !allowed) return forbidden()
      setState(roomId, 'm.room.member', actor, { membership: 'join' }, actor)
      return json(200, { room_id: roomId })
    }
    const invite = /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/invite$/.exec(path)
    if (method === 'POST' && invite) {
      const roomId = decodeURIComponent(invite[1]!)
      if (!mayAct || membershipOf(roomId, actor) !== 'join') return forbidden()
      const target = String(body?.user_id)
      const current = membershipOf(roomId, target)
      if (current === 'join' || current === 'ban') {
        return json(403, {
          errcode: 'M_FORBIDDEN',
          error: 'cannot invite user that is joined or banned',
        })
      }
      setState(roomId, 'm.room.member', target, { membership: 'invite' }, actor)
      return json(200, {})
    }
    const send = /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/send\/([^/]+)\/([^/]+)$/.exec(path)
    if (method === 'PUT' && send) {
      const roomId = decodeURIComponent(send[1]!)
      if (!mayAct || membershipOf(roomId, actor) !== 'join') return forbidden()
      const text = String(body?.body ?? '')
      messages.push({ roomId, sender: actor, body: text })
      if (roomId === adminRoomId) runAdminCommand(text)
      return json(200, { event_id: `$event${messages.length}` })
    }
    const joinedMembers = /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/joined_members$/.exec(path)
    if (method === 'GET' && joinedMembers) {
      const roomId = decodeURIComponent(joinedMembers[1]!)
      const state = rooms.get(roomId)
      if (!state || membershipOf(roomId, actor) !== 'join') return forbidden()
      const joined: Record<string, object> = {}
      for (const [k, ev] of state) {
        const [type, stateKey] = k.split('\n')
        if (type === 'm.room.member' && ev.content.membership === 'join') joined[stateKey!] = {}
      }
      return json(200, { joined })
    }
    const full = /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/state$/.exec(path)
    if (method === 'GET' && full) {
      const state = rooms.get(decodeURIComponent(full[1]!))
      if (!state) return forbidden()
      return json(
        200,
        [...state.entries()].map(([k, ev]) => {
          const [type, stateKey] = k.split('\n')
          return { type, state_key: stateKey, content: ev.content, sender: ev.sender }
        }),
      )
    }
    const one = /^\/_matrix\/client\/v3\/rooms\/([^/]+)\/state\/([^/]+)(?:\/(.*))?$/.exec(path)
    if (one) {
      const roomId = decodeURIComponent(one[1]!)
      const type = decodeURIComponent(one[2]!)
      const stateKey = decodeURIComponent(one[3] ?? '')
      if (method === 'GET') {
        const content = getState(roomId, type, stateKey)
        return content ? json(200, content) : json(404, { errcode: 'M_NOT_FOUND' })
      }
      if (method === 'PUT') {
        if (!mayAct || membershipOf(roomId, actor) !== 'join') return forbidden()
        setState(roomId, type, stateKey, body ?? {}, actor)
        return json(200, { event_id: `$state${calls.length}` })
      }
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
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
    return handle(method, url, auth?.replace(/^Bearer /, ''), body)
  }) as typeof fetch

  return {
    fetch: fakeFetch,
    serverName,
    centralToken,
    spaceId,
    generalRoomId,
    adminRoomId,
    calls,
    messages,
    knobs,
    openIdToken(userId) {
      const token = `openid-${openIdTokens.size + 1}`
      openIdTokens.set(token, userId)
      return token
    },
    registerAppservice,
    addUser: (userId) => void users.add(userId),
    userExists: (userId) => users.has(userId),
    addRoom,
    membership: membershipOf,
    state: getState,
    setState,
    setMember: (roomId, userId, membership) => setState(roomId, 'm.room.member', userId, { membership }),
    setLevel(roomId, userId, level) {
      const current = getState(roomId, 'm.room.power_levels', '') ?? {}
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
