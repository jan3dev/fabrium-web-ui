import { join } from 'node:path'
import type { MatrixClient } from '@zooid/transport-matrix'
import { Hono } from 'hono'
import { createAdmission } from './admission.js'
import { requireRole, type Caller } from './auth.js'
import { listBundles } from './bundle.js'
import type { FabriumApiConfig } from './config.js'
import { createControlPlane, relay } from './control-plane.js'
import { createVm, parseAutoStopHours, parseCreateRequest } from './create.js'
import { ApiError, apiErrorHandler } from './errors.js'
import type { MatrixConn } from './matrix.js'
import { FULL_COMMIT_RE } from './payload.js'
import { agentsWithFree, fetchVms, liveWorkstations, type LiveDeps } from './vms.js'

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
  /** The agents of the daemon config: a new VM agent may not take one of their names. */
  agentNames?: readonly string[]
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
  const live: LiveDeps = {
    conn: deps.conn,
    asToken: deps.asToken,
    getSpaceRoomId: deps.getSpaceRoomId,
    workstationsDir,
  }
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

  /**
   * A vm-creator acts only on the VMs they created. Any other VM is a 404, as a VM of another tenant
   * is. Returns the control plane failure to pass on, if the list fails.
   */
  async function checkOwner(caller: Caller, id: string): Promise<Response | undefined> {
    if (caller.role !== 'vm-creator') return undefined
    const result = await fetchVms(controlPlane)
    if ('failure' in result) return result.failure
    if (!result.vms.some((vm) => vm.id === id && vm.creator === caller.userId)) {
      throw new ApiError(404, { error: 'not found' })
    }
    return undefined
  }

  const vmPath = (id: string, action = '') => `/v1/vms/${encodeURIComponent(id)}${action}`

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
    const caller = c.get('caller')
    const result = await fetchVms(controlPlane)
    if ('failure' in result) return result.failure
    const agentIds = new Map(
      (await listBundles(workstationsDir)).map((b) => [b.workstation, b.agentId]),
    )
    const vms =
      caller.role === 'vm-creator'
        ? result.vms.filter((vm) => vm.creator === caller.userId)
        : result.vms
    return c.json(vms.map((vm) => ({ ...vm, agent_id: agentIds.get(vm.name) ?? null })))
  })

  app.get('/instance-types', async () => relay(await controlPlane.request('GET', '/v1/instance-types')))

  app.get('/agents', async (c) => {
    const result = await fetchVms(controlPlane)
    if ('failure' in result) return result.failure
    const caller = c.get('caller')
    const all = await listBundles(workstationsDir)
    const bundles =
      caller.role === 'vm-creator' ? all.filter((b) => b.creator === caller.userId) : all
    return c.json(agentsWithFree(bundles, result.vms, await liveWorkstations(live, bundles)))
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
    const caller = c.get('caller')
    return createVm(
      {
        havenModel: deps.havenModel,
        commit: deps.zooidCommit,
        creator: caller.userId,
        onlyCreator: caller.role === 'vm-creator' ? caller.userId : undefined,
        agentNames: deps.agentNames ?? [],
        controlPlane,
        admission,
        ...live,
      },
      parseCreateRequest(raw),
    )
  })

  app.post('/vms/:id/start', async (c) => {
    const id = c.req.param('id')
    // The body is optional: without it the control plane keeps the current auto-stop value.
    const hours = parseAutoStopHours((await bodyObject(c.req.text()))?.auto_stop_hours)
    const failure = await checkOwner(c.get('caller'), id)
    if (failure) return failure
    const body = hours === undefined ? undefined : { auto_stop_hours: hours }
    return relay(await controlPlane.request('POST', vmPath(id, '/start'), body))
  })

  for (const action of ['stop', 'reboot']) {
    app.post(`/vms/:id/${action}`, async (c) => {
      const id = c.req.param('id')
      const failure = await checkOwner(c.get('caller'), id)
      if (failure) return failure
      return relay(await controlPlane.request('POST', vmPath(id, `/${action}`)))
    })
  }

  app.delete('/vms/:id', async (c) => {
    const id = c.req.param('id')
    const failure = await checkOwner(c.get('caller'), id)
    if (failure) return failure
    return relay(await controlPlane.request('DELETE', vmPath(id)))
  })

  app.put('/vms/:id/auto-stop', async (c) => {
    const id = c.req.param('id')
    const hours = parseAutoStopHours((await bodyObject(c.req.text()))?.auto_stop_hours)
    if (hours === undefined) throw new ApiError(400, { error: 'auto_stop_hours is required' })
    const failure = await checkOwner(c.get('caller'), id)
    if (failure) return failure
    return relay(await controlPlane.request('PUT', vmPath(id, '/auto-stop'), { auto_stop_hours: hours }))
  })

  return app
}

/** A JSON object body, or undefined for an empty body. */
async function bodyObject(text: Promise<string>): Promise<Record<string, unknown> | undefined> {
  const raw = await text
  if (raw.trim() === '') return undefined
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new ApiError(400, { error: 'the body must be JSON' })
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError(400, { error: 'the body must be a JSON object' })
  }
  return value as Record<string, unknown>
}

/** Mount the browser API of the VM management under `/_fabrium/v1`. Call it before `serve()`. */
export function mountFabriumApi(app: Hono, deps: FabriumApiDeps): void {
  app.route('/_fabrium/v1', fabriumApi(deps))
}
