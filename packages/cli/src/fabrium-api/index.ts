import { join } from 'node:path'
import type { MatrixClient } from '@zooid/transport-matrix'
import { Hono } from 'hono'
import { createAdmission } from './admission.js'
import { requireRole, type Caller } from './auth.js'
import { listBundles } from './bundle.js'
import type { FabriumApiConfig } from './config.js'
import { createControlPlane, relay } from './control-plane.js'
import { createVm, parseCreateRequest } from './create.js'
import { ApiError, apiErrorHandler } from './errors.js'
import type { MatrixConn } from './matrix.js'
import { FULL_COMMIT_RE } from './payload.js'
import { agentsWithFree, fetchVms, liveWorkstations } from './vms.js'

export interface FabriumApiDeps extends FabriumApiConfig {
  // From the daemon.
  /** Internal homeserver URL and `fetch`. The control plane calls use the same `fetch`. */
  conn: MatrixConn
  /** Central appservice client, `@zooid`. */
  client: MatrixClient
  asToken: string
  asUserId: string
  serverName: string
  /** Localpart of the workforce space. */
  workforceSpace: string
  getSpaceRoomId(): string | undefined
  // Test seams.
  now?: () => number
  controlPlaneTimeoutMs?: number
  whoamiTimeoutMs?: number
  pollIntervalMs?: number
}

export function fabriumApi(deps: FabriumApiDeps): Hono<{ Variables: { caller: Caller } }> {
  const app = new Hono<{ Variables: { caller: Caller } }>()
  const controlPlane = createControlPlane({
    baseUrl: deps.controlPlaneUrl,
    apiKey: deps.controlPlaneKey,
    fetch: deps.conn.fetch,
    timeoutMs: deps.controlPlaneTimeoutMs,
  })
  const workstationsDir = join(deps.zooidHome, 'workstations')
  const admission = createAdmission({
    conn: deps.conn,
    client: deps.client,
    asToken: deps.asToken,
    asUserId: deps.asUserId,
    serverName: deps.serverName,
    homeserverUrl: deps.homeserverUrl,
    workforceSpace: deps.workforceSpace,
    getSpaceRoomId: deps.getSpaceRoomId,
    rooms: deps.vmRooms,
    workstationsDir,
    registrationsDir: join(deps.zooidHome, 'data', 'matrix', 'config', 'registrations'),
    whoamiTimeoutMs: deps.whoamiTimeoutMs,
    pollIntervalMs: deps.pollIntervalMs,
  })

  app.onError(apiErrorHandler)
  app.use(
    '*',
    requireRole({
      conn: deps.conn,
      client: deps.client,
      serverName: deps.serverName,
      asToken: deps.asToken,
      asUserId: deps.asUserId,
      getSpaceRoomId: deps.getSpaceRoomId,
      now: deps.now,
    }),
  )

  app.get('/access', (c) => {
    const { userId, role } = c.get('caller')
    return c.json({ user_id: userId, role })
  })

  app.get('/vms', async (c) => {
    const result = await fetchVms(controlPlane)
    if ('failure' in result) return result.failure
    const agentIds = new Map(
      (await listBundles(workstationsDir)).map((b) => [b.workstation, b.agentId]),
    )
    return c.json(result.vms.map((vm) => ({ ...vm, agent_id: agentIds.get(vm.name) ?? null })))
  })

  app.get('/instance-types', async () => relay(await controlPlane.request('GET', '/v1/instance-types')))

  app.get('/agents', async (c) => {
    const result = await fetchVms(controlPlane)
    if ('failure' in result) return result.failure
    const bundles = await listBundles(workstationsDir)
    const live = await liveWorkstations(deps.conn, workstationsDir, bundles)
    return c.json(agentsWithFree(bundles, result.vms, live))
  })

  app.post('/vms', async (c) => {
    if (!deps.havenModel) throw new ApiError(503, { error: 'FABRIUM_HAVEN_MODEL is not set' })
    if (!deps.zooidCommit) throw new ApiError(503, { error: 'ZOOID_COMMIT is not set' })
    if (!FULL_COMMIT_RE.test(deps.zooidCommit)) {
      throw new ApiError(503, { error: 'ZOOID_COMMIT is not a full commit hash' })
    }
    const raw: unknown = await c.req.json().catch(() => {
      throw new ApiError(400, { error: 'the body must be JSON' })
    })
    return createVm(
      {
        havenModel: deps.havenModel,
        commit: deps.zooidCommit,
        creator: c.get('caller').userId,
        controlPlane,
        admission,
        conn: deps.conn,
        workstationsDir,
      },
      parseCreateRequest(raw),
    )
  })

  for (const action of ['start', 'stop', 'reboot']) {
    app.post(`/vms/:id/${action}`, async (c) =>
      relay(
        await controlPlane.request(
          'POST',
          `/v1/vms/${encodeURIComponent(c.req.param('id'))}/${action}`,
        ),
      ),
    )
  }

  app.delete('/vms/:id', async (c) =>
    relay(await controlPlane.request('DELETE', `/v1/vms/${encodeURIComponent(c.req.param('id'))}`)),
  )

  return app
}

/** Mount the browser API of the VM management under `/_fabrium/v1`. Call it before `serve()`. */
export function mountFabriumApi(app: Hono, deps: FabriumApiDeps): void {
  app.route('/_fabrium/v1', fabriumApi(deps))
}
