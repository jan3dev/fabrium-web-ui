/**
 * The agent routes of the browser API: `/agents`, `/agents/:id`, and `/models` (contracts sections 2 and 3).
 * Every `can` flag and every `403` comes from `policy.ts`. Each write runs in the one queue and reads the world
 * again inside it.
 */
import type { Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { createAdmission } from './admission.js'
import { changeRecord, createRecord, fetchRecords, removeRecord, type AgentRecord } from './agent-records.js'
import type { Caller } from './auth.js'
import { AGENT_NAME_RE, VM_NAME_RE } from './bundle.js'
import { describeFailure, readBody, type ControlPlane } from './control-plane.js'
import { ApiError } from './errors.js'
import { stateEvent, type MatrixConn } from './matrix.js'
import type { Models } from './models.js'
import { can, canUse, liveVms, sees, type World } from './policy.js'
import type { createRoster } from './roster.js'
import { fetchVms, type Vm } from './vms.js'

type Env = { Variables: { caller: Caller } }

export interface AgentContext {
  controlPlane: ControlPlane
  admission: Pick<ReturnType<typeof createAdmission>, 'admit' | 'remove'>
  roster: Pick<ReturnType<typeof createRoster>, 'rebuild'>
  models: Models
  /** The one queue of every write. It is not reentrant: never call it from inside a work. */
  queue: <T>(work: () => Promise<T>) => Promise<T>
  conn: MatrixConn
  asToken: string
  getSpaceRoomId(): string | undefined
  serverName: string
  /** The agents of the daemon config: every caller sees them, read-only. */
  instanceAgents: readonly { name: string; userId: string }[]
  /** FABRIUM_HAVEN_MODEL: the default of `GET /models`. */
  havenModel?: string
}

const MAX_DESCRIPTION_BYTES = 16384
const MAX_LABEL = 200
const MODEL_RE = /^[\x21-\x7e]{1,100}$/
// The control characters of the control plane (Rust `char::is_control`).
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/

const bad = (error: string) => new ApiError(400, { error })
const forbidden = () => new ApiError(403, { error: 'forbidden' })
const notMember = () => new ApiError(400, { error: 'owner must be a member of the workspace' })

/** The VM list and every record of the tenant. A failure of the VM list passes on as it is, as on `GET /vms`. */
export async function loadWorld(ctx: AgentContext, caller: Caller): Promise<World & { vms: Vm[] }> {
  const listed = await fetchVms(ctx.controlPlane)
  if ('failure' in listed) throw new HTTPException(502, { res: listed.failure })
  const records = await fetchRecords(ctx.controlPlane)
  return { caller, records, live: liveVms(listed.vms), vms: listed.vms }
}

/** A refusal passes on as it is. Any other failure is a 502 that names the step (contracts section 3). */
export async function step<T>(name: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (err) {
    if (!(err instanceof ApiError) || err.status < 500) throw err
    throw new ApiError(502, { error: err.body.error, step: name })
  }
}

/** A roster failure does not fail the request: the next write to the VM, or the next start, rebuilds it. */
export async function rebuildRoster(ctx: AgentContext, vm: string, records: AgentRecord[]): Promise<void> {
  try {
    await ctx.roster.rebuild(vm, records)
  } catch (err) {
    const reason = err instanceof ApiError ? `status ${err.status}` : describeFailure(err)
    console.warn(`[fabrium] the roster of ${vm} was not rebuilt: ${reason}`)
  }
}

const NO_CAN = {
  edit: false,
  set_owner: false,
  assign: false,
  create_vm: false,
  delete: false,
  delete_needs_vm: false,
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

function view(ctx: AgentContext, world: World, r: AgentRecord) {
  const live = r.vm === null ? undefined : world.live.get(r.vm)
  return {
    id: r.id,
    name: r.name,
    agent_id: r.vm === null ? null : `@${r.vm}.${r.name}:${ctx.serverName}`,
    owner: r.owner,
    description: r.description,
    model: r.model,
    tag: r.tag,
    project: r.project,
    vm:
      r.vm === null
        ? null
        : live
          ? { name: r.vm, id: live.id, state: live.state, owner: live.creator ?? null }
          : { name: r.vm },
    source: 'control-plane',
    can: can(world, r),
  }
}

const instanceView = (a: { name: string; userId: string }) => ({
  id: `instance:${a.name}`,
  name: a.name,
  agent_id: a.userId,
  owner: null,
  description: null,
  model: null,
  tag: null,
  project: null,
  vm: null,
  source: 'instance',
  can: NO_CAN,
})

/** The record, when the caller sees it. Another one, and an instance agent, is a 404. */
function findAgent(world: World, id: string): AgentRecord {
  const agent = world.records.find((r) => r.id === id)
  if (!agent || !sees(world, agent)) throw new ApiError(404, { error: 'not found' })
  return agent
}

/** The live VM of the name, when the caller can put an agent on it. */
function usableVm(world: World, name: string): Vm {
  const vm = world.live.get(name)
  if (!vm) throw new ApiError(404, { error: 'vm not found' })
  if (!canUse(world, vm)) throw forbidden()
  return vm
}

// `admit` also succeeds for a taken name (registerBot takes M_USER_IN_USE as done): check the records first.
function checkNameFree(world: World, vm: string, name: string): void {
  if (world.records.some((r) => r.vm === vm && r.name === name)) {
    throw new ApiError(409, { error: 'name in use' })
  }
}

async function checkModel(ctx: AgentContext, model: string): Promise<void> {
  if (!(await ctx.models.list()).includes(model)) {
    throw bad('model is not on the Haven model list')
  }
}

/** A user of this server who is a joined member of the workforce space. */
async function checkMember(ctx: AgentContext, owner: string): Promise<void> {
  const match = /^@[^:]+:(.+)$/.exec(owner)
  if (match?.[1] !== ctx.serverName || owner.length > 255 || !/^[\x21-\x7e]+$/.test(owner)) throw notMember()
  const spaceId = ctx.getSpaceRoomId()
  if (!spaceId) throw new ApiError(503, { error: 'workforce space is not ready' })
  const member = await stateEvent(ctx.conn, ctx.asToken, spaceId, 'm.room.member', owner)
  if (member?.membership !== 'join') throw notMember()
}

/** `DELETE /v1/vms/{id}`. A VM that is gone already is done. The error holds the status, never the body. */
async function deleteVm(ctx: AgentContext, id: string): Promise<void> {
  const upstream = await ctx.controlPlane.request('DELETE', `/v1/vms/${encodeURIComponent(id)}`)
  await readBody(upstream)
  if (!upstream.ok && upstream.status !== 404) {
    throw new ApiError(502, { error: `control plane answered ${upstream.status}` })
  }
}

async function jsonObject(c: Context<Env>): Promise<Record<string, unknown>> {
  const raw: unknown = await c.req.json().catch(() => {
    throw bad('the body must be JSON')
  })
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw bad('the body must be a JSON object')
  return raw as Record<string, unknown>
}

/** The fields that both writes take. A value that is absent or null is left out. `""` clears a label. */
interface Fields {
  description?: string
  model?: string
  tag?: string
  project?: string
  vm?: string
}

function label(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return ''
  if (typeof value !== 'string' || [...value].length > MAX_LABEL || CONTROL_CHARS.test(value)) {
    throw bad(`${field} must be 1 to ${MAX_LABEL} characters without control characters`)
  }
  return value
}

/** The checks of the control plane, with a fixed message for each field: never a value in a message. */
function parseFields(b: Record<string, unknown>): Fields {
  const fields: Fields = {}
  if (b.description != null) {
    if (typeof b.description !== 'string' || Buffer.byteLength(b.description) > MAX_DESCRIPTION_BYTES) {
      throw bad(`description must be a string of at most ${MAX_DESCRIPTION_BYTES} bytes`)
    }
    fields.description = b.description
  }
  if (b.model != null) {
    if (typeof b.model !== 'string' || !MODEL_RE.test(b.model)) throw bad('model must be a Haven model ID')
    fields.model = b.model
  }
  const tag = label(b.tag, 'tag')
  if (tag !== undefined) fields.tag = tag
  const project = label(b.project, 'project')
  if (project !== undefined) fields.project = project
  if (b.vm != null) {
    // A VM name goes into a path and a Matrix ID.
    if (typeof b.vm !== 'string' || !VM_NAME_RE.test(b.vm)) throw bad('vm must match ^[a-z0-9][a-z0-9-]{0,62}$')
    fields.vm = b.vm
  }
  return fields
}

export function agentRoutes(app: Hono<Env>, ctx: AgentContext): void {
  app.get('/agents', async (c) => {
    const world = await loadWorld(ctx, c.get('caller'))
    const agents = world.records
      .filter((r) => sees(world, r))
      .sort((a, b) => order(a.name, b.name) || order(a.id, b.id))
      .map((r) => view(ctx, world, r))
    const instance = [...ctx.instanceAgents].sort((a, b) => order(a.name, b.name)).map(instanceView)
    const vms = [...world.live.values()]
      .filter((vm) => canUse(world, vm))
      .sort((a, b) => order(a.name, b.name))
      .map((vm) => ({ name: vm.name, state: vm.state }))
    return c.json({ agents: [...agents, ...instance], vms })
  })

  app.post('/agents', async (c) => {
    const caller = c.get('caller')
    const b = await jsonObject(c)
    if (typeof b.name !== 'string' || !AGENT_NAME_RE.test(b.name)) throw bad('name must match ^[a-z][a-z0-9-]{0,31}$')
    const name = b.name
    const { vm, tag, project, ...fields } = parseFields(b)
    if (fields.model === undefined) throw bad('model is required')
    const model = fields.model
    return ctx.queue(async () => {
      const world = await loadWorld(ctx, caller)
      if (vm !== undefined) {
        usableVm(world, vm)
        checkNameFree(world, vm, name)
      }
      await checkModel(ctx, model)
      // The control plane refuses a label of "": a new agent leaves it out.
      const body = { ...fields, name, owner: caller.userId, ...(tag ? { tag } : {}), ...(project ? { project } : {}) }
      let record: AgentRecord
      if (vm === undefined) {
        record = await createRecord(ctx.controlPlane, body)
      } else {
        const { rooms } = await ctx.admission.admit({ workstation: vm, agent: name })
        record = await step('record', () => createRecord(ctx.controlPlane, { ...body, vm, rooms }))
      }
      const records = [...world.records, record]
      if (record.vm !== null) await rebuildRoster(ctx, record.vm, records)
      return c.json(view(ctx, { ...world, records }, record), 201)
    })
  })

  app.put('/agents/:id', async (c) => {
    const caller = c.get('caller')
    const b = await jsonObject(c)
    const { vm, ...fields } = parseFields(b)
    if (b.owner != null && typeof b.owner !== 'string') throw notMember()
    const owner = (b.owner ?? undefined) as string | undefined
    return ctx.queue(async () => {
      const world = await loadWorld(ctx, caller)
      const agent = findAgent(world, c.req.param('id'))
      const allowed = can(world, agent)
      if (Object.keys(fields).length > 0 && !allowed.edit) throw forbidden()
      if (owner !== undefined && !allowed.set_owner) throw forbidden()
      if (vm !== undefined) {
        if (!allowed.edit) throw forbidden()
        if (agent.vm !== null) throw new ApiError(409, { error: 'vm already set' })
        usableVm(world, vm)
        checkNameFree(world, vm, agent.name)
      }
      if (fields.model !== undefined && fields.model !== agent.model) await checkModel(ctx, fields.model)
      if (owner !== undefined) await checkMember(ctx, owner)
      const change = { ...fields, ...(owner === undefined ? {} : { owner }) }
      let record = agent
      if (vm !== undefined) {
        const { rooms } = await ctx.admission.admit({ workstation: vm, agent: agent.name })
        record = await step('record', () => changeRecord(ctx.controlPlane, agent.id, { ...change, vm, rooms }))
      } else if (Object.keys(change).length > 0) {
        record = await changeRecord(ctx.controlPlane, agent.id, change)
      }
      const records = world.records.map((r) => (r.id === record.id ? record : r))
      if (record.vm !== null) await rebuildRoster(ctx, record.vm, records)
      return c.json(view(ctx, { ...world, records }, record))
    })
  })

  app.delete('/agents/:id', async (c) => {
    const caller = c.get('caller')
    const withVm = c.req.query('vm') === '1'
    return ctx.queue(async () => {
      const world = await loadWorld(ctx, caller)
      const agent = findAgent(world, c.req.param('id'))
      const allowed = can(world, agent)
      if (!allowed.delete) throw forbidden()
      if (allowed.delete_needs_vm && !withVm) throw new ApiError(409, { error: 'last agent of the vm' })
      // A profile has no Matrix user and no VM name: only the record goes.
      if (agent.vm !== null) {
        const placement = { workstation: agent.vm, agent: agent.name, rooms: agent.rooms }
        // The last record of the VM name, with or without a live VM: the credential of the name goes too.
        const last = !world.records.some((r) => r.id !== agent.id && r.vm === agent.vm)
        const live = world.live.get(agent.vm)
        await ctx.admission.remove({ ...placement, last: false })
        if (last) {
          if (live) await step('vm', () => deleteVm(ctx, live.id))
          await ctx.admission.remove({ ...placement, last: true })
        }
      }
      await step('record', () => removeRecord(ctx.controlPlane, agent.id))
      if (agent.vm !== null) {
        await rebuildRoster(ctx, agent.vm, world.records.filter((r) => r.id !== agent.id))
      }
      return c.body(null, 204)
    })
  })

  app.get('/models', async (c) => {
    const models = await ctx.models.list()
    const fallback = ctx.havenModel !== undefined && models.includes(ctx.havenModel) ? ctx.havenModel : null
    return c.json({ models: models.map((id) => ({ id })), default: fallback })
  })
}
