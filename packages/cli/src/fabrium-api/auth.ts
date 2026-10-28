import type { MatrixClient } from '@zooid/transport-matrix'
import type { MiddlewareHandler } from 'hono'
import { ApiError } from './errors.js'
import { openIdSub, stateEvent, type MatrixConn } from './matrix.js'

export type Role = 'admin' | 'owner'

export interface Caller {
  userId: string
  role: Role
}

export interface AuthDeps {
  /** Internal homeserver URL and `fetch`, for the OpenID check. */
  conn: MatrixConn
  /** Central appservice client, `@zooid`: it reads the workforce space. */
  client: MatrixClient
  serverName: string
  asToken: string
  asUserId: string
  /** The workforce space; unknown until the daemon has provisioned it. */
  getSpaceRoomId(): string | undefined
  now?: () => number
}

// A valid OpenID check is reused for this long. The role is never cached.
const IDENTITY_TTL_MS = 5 * 60_000
// The role thresholds of packages/web/src/lib/roles.ts.
const OWNER_LEVEL = 100
const ADMIN_LEVEL = 90

function isLocalUser(userId: string, serverName: string): boolean {
  const match = /^@([^:]+):(.+)$/.exec(userId)
  return match?.[2] === serverName
}

function createVerifier(deps: AuthDeps): (token: string) => Promise<string> {
  const now = deps.now ?? Date.now
  const cache = new Map<string, { userId: string; expires: number }>()
  return async (token) => {
    const hit = cache.get(token)
    if (hit && hit.expires > now()) return hit.userId
    const sub = await openIdSub(deps.conn, token)
    if (!sub || !isLocalUser(sub, deps.serverName)) {
      throw new ApiError(401, { error: 'invalid token' })
    }
    for (const [key, entry] of cache) if (entry.expires <= now()) cache.delete(key)
    cache.set(token, { userId: sub, expires: now() + IDENTITY_TTL_MS })
    return sub
  }
}

function createRoles(deps: AuthDeps): (userId: string) => Promise<Role | null> {
  // The creators of a room never change: read them once per room.
  const creators = new Map<string, Promise<Set<string>>>()

  async function loadCreators(spaceId: string): Promise<Set<string>> {
    const create = await stateEvent(deps.conn, deps.asToken, spaceId, 'm.room.create', '')
    // From room version 12 the creators outrank every power level.
    if (!(Number(create?.room_version ?? '1') >= 12)) return new Set()
    // The create content does not name its sender: that needs the whole event.
    const state = await deps.client.fetchRoomState(spaceId, deps.asUserId)
    const event = state.find((e) => e.type === 'm.room.create') as
      | { sender?: string; content?: { additional_creators?: unknown } }
      | undefined
    const extra = event?.content?.additional_creators
    return new Set([
      ...(event?.sender ? [event.sender] : []),
      ...(Array.isArray(extra) ? extra.filter((u): u is string => typeof u === 'string') : []),
    ])
  }

  function creatorsOf(spaceId: string): Promise<Set<string>> {
    let loaded = creators.get(spaceId)
    if (!loaded) {
      loaded = loadCreators(spaceId)
      creators.set(spaceId, loaded)
      loaded.catch(() => creators.delete(spaceId))
    }
    return loaded
  }

  return async (userId) => {
    const spaceId = deps.getSpaceRoomId()
    if (!spaceId) throw new ApiError(503, { error: 'workforce space is not ready' })
    const read = (type: string, stateKey: string) =>
      stateEvent(deps.conn, deps.asToken, spaceId, type, stateKey)
    const [member, power, creatorSet] = await Promise.all([
      read('m.room.member', userId),
      read('m.room.power_levels', ''),
      creatorsOf(spaceId),
    ])
    if (member?.membership !== 'join') return null
    const users = power?.users as Record<string, number> | undefined
    const level = creatorSet.has(userId)
      ? Infinity
      : (users?.[userId] ?? (power?.users_default as number | undefined) ?? 0)
    if (level >= OWNER_LEVEL) return 'owner'
    return level >= ADMIN_LEVEL ? 'admin' : null
  }
}

/**
 * Hono middleware: the bearer token must be a valid OpenID access token of a
 * user of this server, and that user must be an admin or an owner of the
 * workforce space. Sets `caller`.
 */
export function requireRole(deps: AuthDeps): MiddlewareHandler<{ Variables: { caller: Caller } }> {
  const verify = createVerifier(deps)
  const roleOf = createRoles(deps)
  return async (c, next) => {
    const token = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')?.[1]
    if (!token) throw new ApiError(401, { error: 'invalid token' })
    const userId = await verify(token)
    const role = await roleOf(userId)
    if (!role) throw new ApiError(403, { error: 'forbidden' })
    c.set('caller', { userId, role })
    await next()
  }
}
