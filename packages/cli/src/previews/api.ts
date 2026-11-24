// Central side: the web UI's preview API under /_fabrium/v1/previews (PREVIEWS_SPEC.md §5.4).
// Any joined member of the preview's room may read; only humans open, restart, or stop.
import { Hono, type Context } from 'hono'
import { bearerToken, createVerifier } from '../fabrium-api/auth.js'
import { ApiError, apiErrorHandler } from '../fabrium-api/errors.js'
import type { MatrixConn } from '../fabrium-api/matrix.js'
import type { PreviewHub } from './hub.js'
import type { PreviewState } from './protocol.js'

export interface PreviewApiDeps {
  hub: PreviewHub
  conn: MatrixConn
  serverName: string
  /** Agents, workstation users and this daemon's own users: the transport's live roster check. */
  isNotHuman(userId: string): boolean
  now?: () => number
}

export function previewApi(deps: PreviewApiDeps): Hono {
  const app = new Hono()
  const verify = createVerifier(deps)
  async function caller(c: Context): Promise<string> {
    const token = bearerToken(c.req.header('authorization'))
    if (!token) throw new ApiError(401, { error: 'invalid token' })
    return verify(token)
  }

  /** The preview, when the caller may see it; 404 otherwise, so the API is no oracle. */
  async function visible(c: Context): Promise<{ userId: string; preview: PreviewState }> {
    const userId = await caller(c)
    const preview = deps.hub.get(c.req.param('agent')!, c.req.param('name')!)
    if (!preview || !(await deps.hub.isMember(userId, preview))) throw new ApiError(404, { error: 'no such preview' })
    return { userId, preview }
  }

  async function human(c: Context): Promise<{ userId: string; preview: PreviewState }> {
    const seen = await visible(c)
    if (deps.isNotHuman(seen.userId)) throw new ApiError(403, { error: 'agents use the preview tools' })
    return seen
  }

  /** Of `list(room)`, what the caller may see: the items in rooms they have joined. */
  async function seen<T extends Parameters<PreviewHub['isMember']>[1]>(c: Context, list: (room: string) => T[]) {
    const userId = await caller(c)
    const items = list(c.req.query('room') ?? '')
    const member = await Promise.all(items.map((p) => deps.hub.isMember(userId, p)))
    return c.json(items.filter((_, i) => member[i]))
  }

  app.onError(apiErrorHandler)

  app.get('/', (c) => seen(c, (room) => deps.hub.list(room)))

  /** Where the room's agents work now: the agent cursor (plan P6, DESIGN_MODES_SPEC.md §6.8). */
  app.get('/focus', (c) => seen(c, (room) => deps.hub.focusIn(room)))

  app.get('/:agent/:name', async (c) => {
    const { preview } = await visible(c)
    const offset = Number(c.req.query('log_offset') ?? 0)
    const log = deps.hub.log(preview.agent_id, preview.name, Number.isFinite(offset) ? offset : 0)
    const focus = deps.hub.previewFocus(preview.agent_id, preview.name)
    return c.json({ ...preview, log, ...(focus ? { focus } : {}) })
  })

  app.post('/:agent/:name/session', async (c) => {
    const { userId, preview } = await human(c)
    // The page that asks is the only one that may frame the preview.
    // It lands in the preview's CSP header and the bridge's postMessage target: a canonical origin only.
    const origin = c.req.header('origin') ?? ''
    if (!/^https?:/.test(origin) || URL.parse(origin)?.origin !== origin) throw new ApiError(400, { error: 'missing Origin' })
    return c.json(deps.hub.createSession(preview.agent_id, preview.name, userId, origin))
  })

  for (const action of ['restart', 'stop'] as const) {
    app.post(`/:agent/:name/${action}`, async (c) => {
      const { preview } = await human(c)
      if (!deps.hub.command(preview.agent_id, preview.name, action)) {
        throw new ApiError(409, { error: 'the workstation is offline' })
      }
      return c.body(null, 204)
    })
  }

  return app
}
