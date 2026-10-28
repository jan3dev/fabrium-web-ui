import { ApiError } from './errors.js'

/**
 * The few Matrix calls that `MatrixClient` does not have. `homeserver` is the
 * internal URL of the daemon (`transports.matrix.homeserver`).
 */
export interface MatrixConn {
  homeserver: string
  fetch: typeof fetch
}

const enc = encodeURIComponent
const unreachable = () => new ApiError(502, { error: 'homeserver unreachable' })

async function get(c: MatrixConn, path: string, token?: string): Promise<Response> {
  try {
    return await c.fetch(
      `${c.homeserver.replace(/\/$/, '')}${path}`,
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    )
  } catch {
    // The URL can hold an OpenID token: do not pass the cause on.
    throw unreachable()
  }
}

async function jsonOf(r: Response): Promise<Record<string, unknown> | null> {
  return (await r.json().catch(() => null)) as Record<string, unknown> | null
}

/**
 * The user of an OpenID access token, or null when the homeserver does not know
 * it. tuwunel serves this endpoint with federation off (`register_server_misc_routes`).
 */
export async function openIdSub(c: MatrixConn, accessToken: string): Promise<string | null> {
  const r = await get(c, `/_matrix/federation/v1/openid/userinfo?access_token=${enc(accessToken)}`)
  if (r.status >= 500) throw unreachable()
  if (!r.ok) return null
  const sub = (await jsonOf(r))?.sub
  return typeof sub === 'string' ? sub : null
}

/** The user that the homeserver sees behind an appservice token, or null when it does not accept it. */
export async function whoami(c: MatrixConn, token: string): Promise<string | null> {
  const r = await get(c, '/_matrix/client/v3/account/whoami', token)
  const id = r.ok ? (await jsonOf(r))?.user_id : null
  return typeof id === 'string' ? id : null
}

/** The content of one state event, or null when the room has none. */
export async function stateEvent(
  c: MatrixConn,
  token: string,
  roomId: string,
  type: string,
  stateKey: string,
): Promise<Record<string, unknown> | null> {
  const r = await get(
    c,
    `/_matrix/client/v3/rooms/${enc(roomId)}/state/${enc(type)}/${enc(stateKey)}`,
    token,
  )
  if (r.status === 404) return null
  if (!r.ok) throw new ApiError(502, { error: `homeserver answered ${r.status}` })
  return jsonOf(r)
}

/** False when the user exists or the name is reserved or forbidden; the token must be an appservice token. */
export async function usernameAvailable(
  c: MatrixConn,
  token: string,
  localpart: string,
): Promise<boolean> {
  const r = await get(c, `/_matrix/client/v3/register/available?username=${enc(localpart)}`, token)
  if (r.ok) return true
  // 400: M_USER_IN_USE or M_EXCLUSIVE. 403: the server config forbids the name.
  if (r.status === 400 || r.status === 403) return false
  throw new ApiError(502, {
    error: `cannot check that @${localpart} is free (homeserver answered ${r.status})`,
  })
}
