import { join } from 'node:path'
import type { MatrixClient } from '@zooid/transport-matrix'
import { Hono } from 'hono'
import { requireRole, type Caller } from './auth.js'
import { listBundles } from './bundle.js'
import { createControlPlane, relay } from './control-plane.js'
import { apiErrorHandler } from './errors.js'
import type { MatrixConn } from './matrix.js'
import { agentsWithFree, fetchVms } from './vms.js'

export interface FabriumApiDeps {
  // From the environment (config.ts).
  controlPlaneUrl: string
  /** The tenant API key. It never leaves the daemon. */
  controlPlaneKey: string
  havenModel?: string
  /** Rooms of a new agent: `#alias`, `#alias:server`, or `!id:server`. */
  vmRooms: string[]
  /** Full commit of the running image. */
  zooidCommit?: string
  /** Public URL of the homeserver, for the bundle of a VM. */
  homeserverUrl: string
  zooidHome: string
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
    return c.json(agentsWithFree(await listBundles(workstationsDir), result.vms))
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
