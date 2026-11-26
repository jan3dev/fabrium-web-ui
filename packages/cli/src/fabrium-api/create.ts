import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { changeRecord } from './agent-records.js'
import {
  checkProject,
  loadWorld,
  needsProjectVm,
  parseProjectId,
  rebuildRoster,
  step,
  type AgentContext,
} from './agents.js'
import type { Caller } from './auth.js'
import { MARKER, VM_NAME_RE, readBundleEnv } from './bundle.js'
import { describeFailure, relay } from './control-plane.js'
import { ApiError } from './errors.js'
import { buildPayload, isStrictUserId, secretProblem } from './payload.js'
import { checkPerson } from './people.js'
import { hasProjectAgent, isProject, sees } from './policy.js'
import { relayVm, vmView, type VmDecorator } from './vm-projects.js'
import type { Vm } from './vms.js'

/** The body of `POST /vms` (contracts section 2). */
export interface CreateRequest {
  /** The record `id` of the agent that the VM is created for. */
  agent: string
  name: string
  instanceType?: string
  /** Hours of uptime after which the VM stops itself. */
  autoStopHours?: number
  havenApiKey: string
  githubToken?: string
  /** The project of a project VM. Absent: a personal VM of the caller. */
  projectId?: string
}

// A control character would split a line of the secrets file (secretProblem words the line break).
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

const bad = (error: string) => new ApiError(400, { error })

/** An optional auto-stop setting: an integer from 1 to 168. */
export function parseAutoStopHours(value: unknown): number | undefined {
  if (value == null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 168) {
    throw bad('auto_stop_hours must be an integer from 1 to 168')
  }
  return value
}

/** A secret, trimmed. The message never holds its value. */
function secret(value: unknown, field: string, required: boolean): string | undefined {
  if (value == null || (typeof value === 'string' && value.trim() === '')) {
    if (required) throw bad(`${field} is required`)
    return undefined
  }
  if (typeof value !== 'string') throw bad(`${field} must be a string`)
  const trimmed = value.trim()
  // What the VM script refuses: the API must not accept it, or the VM stops at its first boot.
  const problem = secretProblem(trimmed, field)
  if (problem) throw bad(problem)
  if (CONTROL_CHARS.test(trimmed)) throw bad(`${field} must not contain control characters`)
  return trimmed
}

function jsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw bad('the body must be a JSON object')
  }
  return raw as Record<string, unknown>
}

/** The two credentials of a VM. Every failure is a 400 with a message that holds no secret. */
export function parseCredentials(raw: unknown): { havenApiKey: string; githubToken?: string } {
  const body = jsonObject(raw)
  return {
    havenApiKey: secret(body.haven_api_key, 'haven_api_key', true)!,
    githubToken: secret(body.github_token, 'github_token', false),
  }
}

/** The create body of contracts section 2. Every failure is a 400 with a message that holds no secret. */
export function parseCreateRequest(raw: unknown): CreateRequest {
  const body = jsonObject(raw)
  if (typeof body.agent !== 'string' || body.agent === '') throw bad('agent is required')
  if (typeof body.name !== 'string' || !VM_NAME_RE.test(body.name)) {
    throw bad('name must match ^[a-z0-9][a-z0-9-]{0,62}$')
  }
  if (body.name === 'zooid') throw bad("name must not be 'zooid'")
  if (body.instance_type != null && typeof body.instance_type !== 'string') {
    throw bad('instance_type must be a string')
  }
  return {
    agent: body.agent,
    name: body.name,
    instanceType: body.instance_type ?? undefined,
    autoStopHours: parseAutoStopHours(body.auto_stop_hours),
    ...parseCredentials(body),
    // null and "" make a personal VM. The control plane reads "" in a POST as an unknown project.
    projectId: parseProjectId(body.project_id) || undefined,
  }
}

export interface CreateDeps extends AgentContext {
  /** Full commit of the running image. */
  commit: string
  workstationsDir: string
}

/**
 * `POST /vms` for an agent without a live VM: admit it on the VM name, write the record of a profile, rebuild
 * the roster, and ask the control plane for the VM. A control plane failure leaves the agent with its VM name
 * and no live VM: Create VM is still there for it, with the name fixed.
 */
export function createVm(deps: CreateDeps, caller: Caller, req: CreateRequest): Promise<Response> {
  return deps.queue(async () => {
    const world = await loadWorld(deps, caller)
    const agent = world.records.find((r) => r.id === req.agent)
    if (!agent || !sees(world, agent)) throw new ApiError(404, { error: 'agent not found' })
    if (req.projectId !== undefined) checkProject(world, req.projectId)
    if (agent.vm !== null && world.live.has(agent.vm)) throw new ApiError(409, { error: 'the agent has a vm' })
    if (agent.vm !== null && agent.vm !== req.name) throw bad('name must be the vm of the agent')
    if (agent.vm === null) {
      // A bundle with the marker and no record is an admission that did not finish: any agent completes it.
      const dir = join(deps.workstationsDir, req.name)
      const foreign = existsSync(dir) && !existsSync(join(dir, MARKER))
      if (foreign || world.live.has(req.name) || world.records.some((r) => r.vm === req.name)) {
        throw new ApiError(409, { error: 'name in use' })
      }
    }
    // The rule of the project VM: a personal VM for no project agent of the name.
    if (req.projectId === undefined && (isProject(agent) || hasProjectAgent(world.records, req.name))) {
      throw needsProjectVm()
    }
    // The caller is the stored creator, also of a project VM (contracts section 2, "Person").
    await checkPerson(deps, caller.userId)
    // Safe to repeat. An agent with a VM name joins the rooms of its record, not today's FABRIUM_VM_ROOMS.
    const admitted = await deps.admission.admit({
      workstation: req.name,
      agent: agent.name,
      rooms: agent.vm === null ? undefined : agent.rooms,
    })
    let records = world.records
    if (agent.vm === null) {
      const record = await step('record', () =>
        changeRecord(deps.controlPlane, agent.id, { vm: req.name, rooms: admitted.rooms }),
      )
      records = records.map((r) => (r.id === record.id ? record : r))
    }
    await rebuildRoster(deps, req.name, records, world.projects)

    // The greeting is a courtesy: a caller ID outside the strict grammar skips it instead of failing.
    const creator = isStrictUserId(caller.userId) ? caller.userId : undefined
    if (creator === undefined) {
      console.warn(`[fabrium] ${req.name}: no greeting, the caller's user ID is outside the strict grammar`)
    }
    const payload = buildPayload({
      env: admitted.env,
      havenApiKey: req.havenApiKey,
      githubToken: req.githubToken,
      commit: deps.commit,
      creator,
      agent: agent.name,
    })
    // Recorded before the call, and kept after a 5xx or no answer: the launch can go on.
    const launch = deps.launches.add(req.name, req.projectId ?? null)
    const upstream = await deps.controlPlane.request('POST', '/v1/vms', {
      name: req.name,
      ...(req.instanceType ? { instance_type: req.instanceType } : {}),
      ...(req.autoStopHours === undefined ? {} : { auto_stop_hours: req.autoStopHours }),
      // Unconditional: a caller ID outside the strict grammar still owns the VM. The control plane checks it.
      creator: caller.userId,
      ...(req.projectId === undefined ? {} : { project_id: req.projectId }),
      bootstrap: payload,
    })
    if (!upstream.ok) {
      if (upstream.status < 500) deps.launches.drop(launch)
      return relay(upstream)
    }
    // The create went through: with its answer lost, the VM exists or may, so report no failure.
    let vm: unknown
    try {
      vm = JSON.parse(await upstream.text())
    } catch (err) {
      console.warn(`[fabrium] create answered ${upstream.status}, but the body is unreadable: ${describeFailure(err)}`)
    }
    if (typeof vm !== 'object' || vm === null || Array.isArray(vm)) {
      throw new ApiError(502, {
        error:
          'the control plane answered, but the answer could not be read. The VM may exist: check the VM list',
      })
    }
    // The project of the answer: a project deleted during the launch gives a personal VM.
    return new Response(JSON.stringify({ ...vmView(caller, world.projects, vm as Vm), agent_id: admitted.agentId }), {
      status: upstream.status,
      headers: { 'content-type': 'application/json' },
    })
  })
}

/**
 * `POST /vms/:id/recreate`: the same bundle `.env` with new credentials. No creator and no agent, so the new
 * VM does not greet again. The answer of the control plane passes on with the fields of the VM view.
 */
export async function recreateVm(
  deps: CreateDeps,
  vm: Vm,
  creds: { havenApiKey: string; githubToken?: string },
  decorate: VmDecorator,
): Promise<Response> {
  // The name comes from the control plane list: check it before it reaches a path.
  const env = VM_NAME_RE.test(vm.name) ? await readBundleEnv(join(deps.workstationsDir, vm.name)) : null
  if (env === null) throw new ApiError(409, { error: 'the vm has no bundle' })
  const payload = buildPayload({ env, ...creds, commit: deps.commit })
  // The new VM gets the project of the registry row. Kept after a 5xx or no answer, as for a create.
  const launch = deps.launches.add(vm.name, vm.project_id ?? null)
  const path = `/v1/vms/${encodeURIComponent(vm.id)}/recreate`
  const upstream = await deps.controlPlane.request('POST', path, { bootstrap: payload })
  if (!upstream.ok && upstream.status < 500) deps.launches.drop(launch)
  return relayVm(upstream, decorate)
}
