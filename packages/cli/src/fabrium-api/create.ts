import { join } from 'node:path'
import type { NewAgent } from './admission.js'
import {
  AGENT_NAME_RE,
  VM_NAME_RE,
  listBundles,
  readBundle,
  type Bundle,
  type BundleFiles,
  type BundleSummary,
} from './bundle.js'
import { describeFailure, relay, type ControlPlane } from './control-plane.js'
import { ApiError } from './errors.js'
import { buildPayload, isStrictUserId, secretProblem } from './payload.js'
import { agentsWithFree, fetchVms, liveWorkstations, type LiveDeps, type Vm } from './vms.js'

export interface CreateRequest {
  /** The VM name, and the workstation name of the agent. */
  name: string
  instanceType?: string
  /** Hours of uptime after which the VM stops itself. */
  autoStopHours?: number
  agent: { mode: 'new'; name: string; persona?: string; project?: string } | { mode: 'existing' }
  havenApiKey: string
  githubToken?: string
}

const MAX_TEXT = 200
// A control character would split a line of the secrets file (secretProblem words the line break).
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

const bad = (error: string) => new ApiError(400, { error })

function optionalText(value: unknown, field: string): string | undefined {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string' || value.length > MAX_TEXT) {
    throw bad(`${field} must be a string of at most ${MAX_TEXT} characters`)
  }
  return value
}

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

/** The create body of contracts section 2. Every failure is a 400 with a message that holds no secret. */
export function parseCreateRequest(raw: unknown): CreateRequest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw bad('the body must be a JSON object')
  }
  const body = raw as Record<string, unknown>
  if (typeof body.name !== 'string' || !VM_NAME_RE.test(body.name)) {
    throw bad('name must match ^[a-z0-9][a-z0-9-]{0,62}$')
  }
  if (body.name === 'zooid') throw bad("name must not be 'zooid'")
  if (body.instance_type != null && typeof body.instance_type !== 'string') {
    throw bad('instance_type must be a string')
  }
  const rawAgent = body.agent
  if (typeof rawAgent !== 'object' || rawAgent === null) throw bad('agent is required')
  const a = rawAgent as Record<string, unknown>
  let agent: CreateRequest['agent']
  if (a.mode === 'existing') {
    // The workstation is `name`; an agent.name that the client sends as well is not used.
    agent = { mode: 'existing' }
  } else if (a.mode === 'new') {
    if (typeof a.name !== 'string' || !AGENT_NAME_RE.test(a.name)) {
      throw bad('agent.name must match ^[a-z][a-z0-9-]{0,31}$')
    }
    agent = {
      mode: 'new',
      name: a.name,
      persona: optionalText(a.persona, 'agent.persona'),
      project: optionalText(a.project, 'agent.project'),
    }
  } else {
    throw bad("agent.mode must be 'new' or 'existing'")
  }
  return {
    name: body.name,
    instanceType: body.instance_type ?? undefined,
    autoStopHours: parseAutoStopHours(body.auto_stop_hours),
    agent,
    havenApiKey: secret(body.haven_api_key, 'haven_api_key', true)!,
    githubToken: secret(body.github_token, 'github_token', false),
  }
}

/** `LiveDeps` is for the read-only check of an existing agent. */
export interface CreateDeps extends LiveDeps {
  havenModel: string
  /** Full commit of the running image. */
  commit: string
  /** The caller: the new agent greets them in a direct message once it works. */
  creator: string
  /** Set for a vm-creator: an existing agent must be one whose first VM this user created. */
  onlyCreator?: string
  /** The agents of the daemon config: a new agent may not take one of their names. */
  agentNames: readonly string[]
  controlPlane: ControlPlane
  admission: { admitNew(agent: NewAgent): Promise<Bundle> }
}

/**
 * A new agent name must be unique: in the daemon config and on every other workstation. The same
 * workstation with the same agent is a retry of an admission, which resumes.
 */
function checkAgentName(
  deps: CreateDeps,
  bundles: BundleSummary[],
  workstation: string,
  agent: string,
  vms: Vm[],
): void {
  if (deps.agentNames.includes(agent)) {
    throw new ApiError(409, { error: `agent name ${agent} is in use` })
  }
  const other = bundles.find((b) => b.agent === agent && b.workstation !== workstation)
  if (!other) return
  const free = agentsWithFree(bundles, vms).some((e) => e.workstation === other.workstation && e.free)
  const hint = free ? '; pick it as an existing agent' : ''
  throw new ApiError(409, { error: `agent name ${agent} is in use${hint}` })
}

/**
 * Grant or load the identity, build the payload, and ask the control plane for
 * the VM. A control plane failure leaves the identity free for the next try.
 */
export async function createVm(deps: CreateDeps, req: CreateRequest): Promise<Response> {
  let files: BundleFiles
  let agentId: string
  if (req.agent.mode === 'new') {
    // Else the admission takes the running VM's agent for a resume and rewrites its roster entry.
    const listed = await fetchVms(deps.controlPlane)
    if ('failure' in listed) return listed.failure
    if (listed.vms.some((vm) => vm.name === req.name)) throw new ApiError(409, { error: 'name in use' })
    const bundles = await listBundles(deps.workstationsDir)
    // A resume hands over the bundle's tokens: a vm-creator resumes only a bundle of their own.
    const held = bundles.find((b) => b.workstation === req.name)
    if (deps.onlyCreator !== undefined && held && held.creator !== deps.onlyCreator) {
      throw new ApiError(409, { error: 'name in use' })
    }
    checkAgentName(deps, bundles, req.name, req.agent.name, listed.vms)
    const bundle = await deps.admission.admitNew({
      workstation: req.name,
      agent: req.agent.name,
      persona: req.agent.persona,
      project: req.agent.project,
      creator: deps.creator,
    })
    files = bundle
    agentId = bundle.agentId
  } else {
    const listed = await fetchVms(deps.controlPlane)
    if ('failure' in listed) return listed.failure
    const bundles = await listBundles(deps.workstationsDir)
    const entry = agentsWithFree(bundles, listed.vms).find((e) => e.workstation === req.name)
    if (!entry?.free) throw bad(`${req.name} is not a free agent`)
    const owner = bundles.find((b) => b.workstation === req.name)?.creator
    if (deps.onlyCreator !== undefined && owner !== deps.onlyCreator) {
      throw bad(`${req.name} is not a free agent`)
    }
    // A read-only check. Running the admission again would write the roster without the persona and the project.
    const asked = bundles.filter((b) => b.workstation === req.name)
    const live = await liveWorkstations(deps, asked)
    if (!live.has(req.name)) {
      throw new ApiError(409, {
        error: `${req.name} is only partly admitted: send the new-agent request again`,
      })
    }
    const bundle = await readBundle(join(deps.workstationsDir, req.name))
    if (!bundle) throw bad(`${req.name} is not a free agent`)
    files = bundle
    agentId = entry.agent_id
  }

  // The greeting is a courtesy: a caller ID outside the strict grammar skips it instead of failing.
  const creator = isStrictUserId(deps.creator) ? deps.creator : undefined
  if (creator === undefined) {
    console.warn(`[fabrium] ${req.name}: no greeting, the caller's user ID is outside the strict grammar`)
  }
  const payload = buildPayload({
    env: files.env,
    yaml: files.yaml,
    havenApiKey: req.havenApiKey,
    havenModel: deps.havenModel,
    githubToken: req.githubToken,
    commit: deps.commit,
    creator,
  })
  const upstream = await deps.controlPlane.request('POST', '/v1/vms', {
    name: req.name,
    ...(req.instanceType ? { instance_type: req.instanceType } : {}),
    ...(req.autoStopHours === undefined ? {} : { auto_stop_hours: req.autoStopHours }),
    // Unconditional: a caller ID outside the strict grammar still owns the VM. The control plane checks it.
    creator: deps.creator,
    bootstrap: payload,
  })
  if (!upstream.ok) return relay(upstream)
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
  return new Response(JSON.stringify({ ...vm, agent_id: agentId }), {
    status: upstream.status,
    headers: { 'content-type': 'application/json' },
  })
}
