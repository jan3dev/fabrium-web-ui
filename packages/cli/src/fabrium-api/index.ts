import { join } from 'node:path'
import { MatrixClient } from '@zooid/transport-matrix'
import { Hono } from 'hono'
import { createAdmission } from './admission.js'
import { fetchRecords } from './agent-records.js'
import { agentRoutes, type AgentContext } from './agents.js'
import { isAdmin, managesVms, requireRole, type Caller } from './auth.js'
import type { FabriumApiConfig } from './config.js'
import { createControlPlane, relay } from './control-plane.js'
import { createVm, parseAutoStopHours, parseCreateRequest, parseCredentials, recreateVm } from './create.js'
import { ApiError, apiErrorHandler } from './errors.js'
import type { MatrixConn } from './matrix.js'
import { createModels } from './models.js'
import { FULL_COMMIT_RE } from './payload.js'
import { liveVms } from './policy.js'
import { fetchProjects } from './project-records.js'
import { createQueue } from './queue.js'
import { createRoster } from './roster.js'
import { fetchVms } from './vms.js'

export interface FabriumApiDeps extends FabriumApiConfig {
  // From the daemon.
  /** Internal homeserver URL and `fetch`. The control plane calls use the same `fetch`. */
  conn: MatrixConn
  /** The token of the central appservice, `@zooid`. */
  asToken: string
  asUserId: string
  serverName: string
  /** Localpart of the workforce space. */
  workforceSpace: string
  /** The agents of the daemon config: every caller sees them, read-only. */
  instanceAgents?: readonly { name: string; userId: string }[]
  getSpaceRoomId(): string | undefined
  // Test seams.
  now?: () => number
  controlPlaneTimeoutMs?: number
  matrixTimeoutMs?: number
  whoamiTimeoutMs?: number
  pollIntervalMs?: number
}

export function fabriumApi(deps: FabriumApiDeps): {
  app: Hono<{ Variables: { caller: Caller } }>
  /** Rebuilds the roster of every VM name from the records. Throws when the records cannot be read. */
  rebuildRosters(): Promise<void>
} {
  const app = new Hono<{ Variables: { caller: Caller } }>()
  const controlPlane = createControlPlane({
    baseUrl: deps.controlPlaneUrl,
    apiKey: deps.controlPlaneKey,
    fetch: deps.conn.fetch,
    timeoutMs: deps.controlPlaneTimeoutMs,
  })
  // A hung Matrix request would block the write queue, so each one ends after 15 s, body included.
  const matrixFetch: typeof fetch = (input, init) =>
    deps.conn.fetch(input, { ...init, signal: AbortSignal.timeout(deps.matrixTimeoutMs ?? 15_000) })
  const conn: MatrixConn = { homeserver: deps.conn.homeserver, fetch: matrixFetch }
  // The central appservice client, `@zooid`.
  const client = new MatrixClient({ homeserver: conn.homeserver, asToken: deps.asToken, fetch: matrixFetch })
  const workstationsDir = join(deps.zooidHome, 'workstations')
  const admission = createAdmission({
    conn,
    client,
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
  // ponytail: one queue for every agent write, and the roster rebuild at start.
  const queue = createQueue()
  const roster = createRoster({
    conn,
    client,
    asToken: deps.asToken,
    asUserId: deps.asUserId,
    serverName: deps.serverName,
    getSpaceRoomId: deps.getSpaceRoomId,
    workstationsDir,
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
      conn,
      client,
      serverName: deps.serverName,
      asToken: deps.asToken,
      asUserId: deps.asUserId,
      getSpaceRoomId: deps.getSpaceRoomId,
      now: deps.now,
    }),
  )

  // Before the VM routes, so a VM route added later is covered too.
  for (const path of ['/vms', '/vms/*', '/instance-types']) {
    app.use(path, async (c, next) => {
      if (!managesVms(c.get('caller').role)) throw new ApiError(403, { error: 'forbidden' })
      await next()
    })
  }

  const agents: AgentContext = {
    controlPlane,
    admission,
    roster,
    models: createModels({ fetch: deps.conn.fetch, now: deps.now }),
    queue,
    conn,
    asToken: deps.asToken,
    asUserId: deps.asUserId,
    client,
    workstationsDir,
    getSpaceRoomId: deps.getSpaceRoomId,
    serverName: deps.serverName,
    instanceAgents: deps.instanceAgents ?? [],
    havenModel: deps.havenModel,
  }
  agentRoutes(app, agents)

  /** The commit that a new VM checks out. Without a full one, no VM can be made. */
  function zooidCommit(): string {
    if (!deps.zooidCommit) throw new ApiError(503, { error: 'ZOOID_COMMIT is not set' })
    if (!FULL_COMMIT_RE.test(deps.zooidCommit)) {
      throw new ApiError(503, { error: 'ZOOID_COMMIT is not a full commit hash' })
    }
    return deps.zooidCommit
  }

  async function jsonBody(c: { req: { json(): Promise<unknown> } }): Promise<unknown> {
    return c.req.json().catch(() => {
      throw new ApiError(400, { error: 'the body must be JSON' })
    })
  }

  app.get('/access', (c) => {
    const { userId, role } = c.get('caller')
    return c.json({ user_id: userId, role })
  })

  app.get('/vms', async (c) => {
    const caller = c.get('caller')
    const result = await fetchVms(controlPlane)
    if ('failure' in result) return result.failure
    const records = await fetchRecords(controlPlane)
    const live = liveVms(result.vms)
    const vms =
      caller.role === 'vm-creator'
        ? result.vms.filter((vm) => vm.creator === caller.userId)
        : result.vms
    // During a replace two VMs have the name: the agents run on the live one.
    const agentsOf = (name: string) =>
      records
        .filter((r) => r.vm === name)
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .map((r) => ({ id: r.id, name: r.name, agent_id: `@${name}.${r.name}:${deps.serverName}` }))
    return c.json(vms.map((vm) => ({ ...vm, agents: live.get(vm.name) === vm ? agentsOf(vm.name) : [] })))
  })

  app.get('/instance-types', async () => relay(await controlPlane.request('GET', '/v1/instance-types')))

  app.post('/vms', async (c) => {
    const commit = zooidCommit()
    const req = parseCreateRequest(await jsonBody(c))
    return createVm({ ...agents, commit, workstationsDir }, c.get('caller'), req)
  })

  app.post('/vms/:id/recreate', async (c) => {
    const commit = zooidCommit()
    const creds = parseCredentials(await jsonBody(c))
    const caller = c.get('caller')
    const id = c.req.param('id')
    return queue(async () => {
      const result = await fetchVms(controlPlane)
      if ('failure' in result) return result.failure
      // Only the VM owner or an admin. Any other VM is a 404, as for the other VM actions.
      const vm = result.vms.find((v) => v.id === id && (isAdmin(caller.role) || v.creator === caller.userId))
      if (!vm) throw new ApiError(404, { error: 'not found' })
      return recreateVm({ ...agents, commit, workstationsDir }, vm, creds)
    })
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

  return {
    app,
    // In the queue, so no write lands mid-rebuild; a failed read throws rather than empty every roster.
    rebuildRosters: () =>
      queue(async () => roster.rebuildAll(await fetchRecords(controlPlane), await fetchProjects(controlPlane))),
  }
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
export function mountFabriumApi(app: Hono, deps: FabriumApiDeps): { rebuildRosters(): Promise<void> } {
  const api = fabriumApi(deps)
  app.route('/_fabrium/v1', api.app)
  return { rebuildRosters: api.rebuildRosters }
}
