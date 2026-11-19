/**
 * The agent routes of the browser API: `/agents`, `/agents/:id`, and `/models` (contracts sections 2 and 3).
 * Every `can` flag and every `403` comes from `policy.ts`. Each write runs in the one queue and reads the world
 * again inside it.
 */
import type { MatrixClient } from '@zooid/transport-matrix'
import type { Context, Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { createAdmission } from './admission.js'
import { changeRecord, createRecord, fetchRecords, removeRecord, type AgentRecord } from './agent-records.js'
import type { Caller } from './auth.js'
import { AGENT_NAME_RE, VM_NAME_RE } from './bundle.js'
import { describeFailure, readBody, type ControlPlane } from './control-plane.js'
import { ApiError } from './errors.js'
import type { MatrixConn } from './matrix.js'
import type { Models } from './models.js'
import { checkPerson, listPeople } from './people.js'
import { breaksProjectVmRule, can, canUse, isProject, liveVms, sees, type World } from './policy.js'
import { fetchProjects, type Project } from './project-records.js'
import type { createRoster } from './roster.js'
import { fetchVms, type Vm } from './vms.js'

export type Env = { Variables: { caller: Caller } }

export interface AgentContext {
  controlPlane: ControlPlane
  admission: Pick<ReturnType<typeof createAdmission>, 'admit' | 'remove'>
  roster: Pick<ReturnType<typeof createRoster>, 'rebuild'>
  models: Models
  /** The one queue of every write. It is not reentrant: never call it from inside a work. */
  queue: <T>(work: () => Promise<T>) => Promise<T>
  conn: MatrixConn
  asToken: string
  /** The central appservice user, `@zooid:<server>`. */
  asUserId: string
  /** The central appservice client. */
  client: Pick<MatrixClient, 'fetchRoomState'>
  /** `<zooid home>/workstations`: one directory for each VM bundle. */
  workstationsDir: string
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
export const needsProjectVm = () => new ApiError(409, { error: 'a project agent needs a project vm' })

/** `project_id` of a body: a string, or undefined when it is absent or null. */
export function parseProjectId(raw: unknown): string | undefined {
  if (raw == null) return undefined
  if (typeof raw !== 'string') throw bad('project_id must be a string')
  return raw
}

/** A project ID that the project list has: checked before any Matrix step. */
export function checkProject(world: { projects: readonly Project[] }, id: string): void {
  if (!world.projects.some((p) => p.id === id)) throw bad('unknown project')
}

/**
 * The VM list, every record, and every project of the tenant. A failure of the VM list passes on as it is, as on
 * `GET /vms`.
 */
export async function loadWorld(
  ctx: AgentContext,
  caller: Caller,
): Promise<World & { vms: Vm[]; projects: Project[] }> {
  const listed = await fetchVms(ctx.controlPlane)
  if ('failure' in listed) throw new HTTPException(502, { res: listed.failure })
  const records = await fetchRecords(ctx.controlPlane)
  const projects = await fetchProjects(ctx.controlPlane)
  return { caller, records, live: liveVms(listed.vms), vms: listed.vms, projects }
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
export async function rebuildRoster(
  ctx: AgentContext,
  vm: string,
  records: AgentRecord[],
  projects: readonly Project[],
): Promise<void> {
  try {
    await ctx.roster.rebuild(vm, records, projects)
  } catch (err) {
    const reason = err instanceof ApiError ? `status ${err.status}` : describeFailure(err)
    console.warn(`[fabrium] the roster of ${vm} was not rebuilt: ${reason}`)
  }
}

const NO_CAN = {
  edit: false,
  set_owner: false,
  set_project: false,
  assign: false,
  create_vm: false,
  delete: false,
  delete_needs_vm: false,
}

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** The name of the project, or null when there is none or no project has the ID. */
const projectName = (projects: readonly Project[], id: string | null | undefined): string | null =>
  id == null ? null : (projects.find((p) => p.id === id)?.name ?? null)

function view(ctx: AgentContext, world: World & { projects: readonly Project[] }, r: AgentRecord) {
  const live = r.vm === null ? undefined : world.live.get(r.vm)
  return {
    id: r.id,
    name: r.name,
    agent_id: r.vm === null ? null : `@${r.vm}.${r.name}:${ctx.serverName}`,
    owner: r.owner,
    description: r.description,
    model: r.model,
    tag: r.tag,
    project_id: r.project_id,
    // The text label of phase 1 is not shown.
    project: projectName(world.projects, r.project_id),
    vm:
      r.vm === null
        ? null
        : live
          ? {
              name: r.vm,
              id: live.id,
              state: live.state,
              owner: live.creator ?? null,
              project_id: live.project_id ?? null,
            }
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
  project_id: null,
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

/**
 * The fields that both writes take. A value that is absent or null is left out. `""` clears a label. The text
 * `project` of phase 1 is dropped: it never reaches the control plane.
 */
interface Fields {
  description?: string
  model?: string
  tag?: string
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
      .map((vm) => ({ name: vm.name, state: vm.state, project_id: vm.project_id ?? null }))
    return c.json({ agents: [...agents, ...instance], vms, people: await listPeople(ctx) })
  })

  app.post('/agents', async (c) => {
    const caller = c.get('caller')
    const b = await jsonObject(c)
    if (typeof b.name !== 'string' || !AGENT_NAME_RE.test(b.name)) throw bad('name must match ^[a-z][a-z0-9-]{0,31}$')
    const name = b.name
    const { vm, tag, ...fields } = parseFields(b)
    // null and "" make a personal agent. The control plane reads "" in a POST as an unknown project.
    const projectId = parseProjectId(b.project_id) || undefined
    if (fields.model === undefined) throw bad('model is required')
    const model = fields.model
    return ctx.queue(async () => {
      const world = await loadWorld(ctx, caller)
      if (projectId !== undefined) checkProject(world, projectId)
      if (vm !== undefined) {
        const live = usableVm(world, vm)
        checkNameFree(world, vm, name)
        if (breaksProjectVmRule(projectId !== undefined, live)) throw needsProjectVm()
      }
      await checkModel(ctx, model)
      // The control plane refuses a label of "": a new agent leaves it out.
      const body = {
        ...fields,
        name,
        owner: caller.userId,
        ...(tag ? { tag } : {}),
        ...(projectId === undefined ? {} : { project_id: projectId }),
      }
      let record: AgentRecord
      if (vm === undefined) {
        record = await createRecord(ctx.controlPlane, body)
      } else {
        const { rooms } = await ctx.admission.admit({ workstation: vm, agent: name })
        record = await step('record', () => createRecord(ctx.controlPlane, { ...body, vm, rooms }))
      }
      const records = [...world.records, record]
      if (record.vm !== null) await rebuildRoster(ctx, record.vm, records, world.projects)
      return c.json(view(ctx, { ...world, records }, record), 201)
    })
  })

  // The order of the checks is that of contracts section 2: 404, 403, 400, the vm checks, the rule of the
  // project VM, then the model and the person. The shape of the body is checked first, before the queue.
  app.put('/agents/:id', async (c) => {
    const caller = c.get('caller')
    const b = await jsonObject(c)
    const { vm, ...fields } = parseFields(b)
    const sentProjectId = parseProjectId(b.project_id)
    if (b.owner != null && typeof b.owner !== 'string') throw notMember()
    const sentOwner = (b.owner ?? undefined) as string | undefined
    return ctx.queue(async () => {
      const world = await loadWorld(ctx, caller)
      const agent = findAgent(world, c.req.param('id'))
      // The stored value is not a change, and "" for a personal agent is the stored value (D1, D2).
      const projectId = sentProjectId === (agent.project_id ?? '') ? undefined : sentProjectId
      const owner = sentOwner === agent.owner ? undefined : sentOwner
      const leaves = projectId === ''
      const projectAfter = projectId === undefined ? isProject(agent) : !leaves
      const allowed = can(world, agent)
      if ((Object.keys(fields).length > 0 || vm !== undefined) && !allowed.edit) throw forbidden()
      if (projectId !== undefined && !allowed.set_project) throw forbidden()
      // On a leave, set_project covers the owner.
      if (owner !== undefined && !isProject(agent) && !allowed.set_owner) throw forbidden()
      if (owner !== undefined && projectAfter) throw bad('a project agent has no owner')
      if (projectId) checkProject(world, projectId)
      let vmAfter = agent.vm === null ? undefined : world.live.get(agent.vm)
      if (vm !== undefined) {
        if (agent.vm !== null) throw new ApiError(409, { error: 'vm already set' })
        vmAfter = usableVm(world, vm)
        checkNameFree(world, vm, agent.name)
      }
      if (breaksProjectVmRule(projectAfter, vmAfter)) throw needsProjectVm()
      if (fields.model !== undefined && fields.model !== agent.model) await checkModel(ctx, fields.model)
      // An agent that leaves without an owner gets its stored owner back, who must still be a person.
      if (owner !== undefined || leaves) await checkPerson(ctx, owner ?? agent.owner)
      const change = {
        ...fields,
        ...(projectId === undefined ? {} : { project_id: projectId }),
        ...(owner === undefined ? {} : { owner }),
      }
      let record = agent
      if (vm !== undefined) {
        const { rooms } = await ctx.admission.admit({ workstation: vm, agent: agent.name })
        record = await step('record', () => changeRecord(ctx.controlPlane, agent.id, { ...change, vm, rooms }))
      } else if (Object.keys(change).length > 0) {
        record = await changeRecord(ctx.controlPlane, agent.id, change)
      }
      const records = world.records.map((r) => (r.id === record.id ? record : r))
      if (record.vm !== null) await rebuildRoster(ctx, record.vm, records, world.projects)
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
        await rebuildRoster(ctx, agent.vm, world.records.filter((r) => r.id !== agent.id), world.projects)
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
