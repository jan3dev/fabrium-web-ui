import { join } from 'node:path'
import type { NewAgent } from './admission.js'
import {
  AGENT_NAME_RE,
  VM_NAME_RE,
  listBundles,
  readBundle,
  type Bundle,
  type BundleFiles,
} from './bundle.js'
import { describeFailure, relay, type ControlPlane } from './control-plane.js'
import { ApiError } from './errors.js'
import { buildPayload, secretProblem } from './payload.js'
import { agentsWithFree, fetchVms, liveWorkstations, type LiveDeps } from './vms.js'

export interface CreateRequest {
  /** The VM name, and the workstation name of the agent. */
  name: string
  instanceType?: string
  agent: { mode: 'new'; name: string; persona?: string; project?: string } | { mode: 'existing' }
  havenApiKey: string
  githubToken?: string
}

const MAX_TEXT = 200
// A control character would split a line of the secrets file. A key never has one.
// (A line break is also covered by secretProblem, with the wording of the VM script.)
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

const bad = (error: string) => new ApiError(400, { error })

function optionalText(value: unknown, field: string): string | undefined {
  if (value == null || value === '') return undefined
  if (typeof value !== 'string' || value.length > MAX_TEXT) {
    throw bad(`${field} must be a string of at most ${MAX_TEXT} characters`)
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
  controlPlane: ControlPlane
  admission: { admitNew(agent: NewAgent): Promise<Bundle> }
}

/**
 * Grant or load the identity, build the payload, and ask the control plane for
 * the VM. A control plane failure leaves the identity free for the next try.
 */
export async function createVm(deps: CreateDeps, req: CreateRequest): Promise<Response> {
  let files: BundleFiles
  let agentId: string
  if (req.agent.mode === 'new') {
    // A VM of this name runs the workstation's agent: the admission would take it for a resume and rewrite
    // its roster entry before the control plane refuses the name.
    const listed = await fetchVms(deps.controlPlane)
    if ('failure' in listed) return listed.failure
    if (listed.vms.some((vm) => vm.name === req.name)) throw new ApiError(409, { error: 'name in use' })
    const bundle = await deps.admission.admitNew({
      workstation: req.name,
      agent: req.agent.name,
      persona: req.agent.persona,
      project: req.agent.project,
    })
    files = bundle
    agentId = bundle.agentId
  } else {
    const listed = await fetchVms(deps.controlPlane)
    if ('failure' in listed) return listed.failure
    const bundles = await listBundles(deps.workstationsDir)
    const entry = agentsWithFree(bundles, listed.vms).find((e) => e.workstation === req.name)
    if (!entry?.free) throw bad(`${req.name} is not a free agent`)
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

  const payload = buildPayload({
    env: files.env,
    yaml: files.yaml,
    havenApiKey: req.havenApiKey,
    havenModel: deps.havenModel,
    githubToken: req.githubToken,
    commit: deps.commit,
  })
  const upstream = await deps.controlPlane.request('POST', '/v1/vms', {
    name: req.name,
    ...(req.instanceType ? { instance_type: req.instanceType } : {}),
    bootstrap: payload,
  })
  if (!upstream.ok) return relay(upstream)
  // The control plane went through with the create. If its answer is lost, the VM exists or may exist: say so,
  // and do not report a failed create. The VM list shows the VM.
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
