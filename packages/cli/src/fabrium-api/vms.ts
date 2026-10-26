import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MARKER, envVar, type BundleSummary } from './bundle.js'
import { readBody, relay, type ControlPlane } from './control-plane.js'
import { ApiError } from './errors.js'
import { stateEvent, whoami, type MatrixConn } from './matrix.js'

/** A VM of the control plane (contracts section 1). zooid reads only the name. */
export interface Vm {
  name: string
  [key: string]: unknown
}

export interface AgentEntry {
  workstation: string
  agent_id: string
  preset: string | null
  free: boolean
}

/** The VM list of the tenant, or the failure of the control plane, ready to pass on. */
export async function fetchVms(
  controlPlane: ControlPlane,
): Promise<{ vms: Vm[] } | { failure: Response }> {
  const upstream = await controlPlane.request('GET', '/v1/vms')
  if (!upstream.ok) return { failure: await relay(upstream) }
  const text = await readBody(upstream)
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = undefined
  }
  if (!Array.isArray(body) || !body.every((vm) => typeof vm?.name === 'string')) {
    throw new ApiError(502, { error: 'control plane sent an invalid response' })
  }
  return { vms: body as Vm[] }
}

/** What `liveWorkstations` reads from the homeserver and from disk. */
export interface LiveDeps {
  conn: MatrixConn
  /** The central appservice token, `@zooid`: it reads the workforce space. */
  asToken: string
  getSpaceRoomId(): string | undefined
  workstationsDir: string
}

/**
 * True when the last steps of an admission are done: the agent is in the workforce space, and the roster entry
 * of the workstation lists it. A read that fails proves nothing, so it counts as not done.
 */
async function admissionFinished(
  { conn, asToken, getSpaceRoomId }: LiveDeps,
  ws: string,
  agentId: string,
): Promise<boolean> {
  const spaceId = getSpaceRoomId()
  if (!spaceId) return false
  try {
    const [member, roster] = await Promise.all([
      stateEvent(conn, asToken, spaceId, 'm.room.member', agentId),
      stateEvent(conn, asToken, spaceId, 'dev.zooid.workforce', ws),
    ])
    const agents = roster?.agents
    return (
      member?.membership === 'join' &&
      Array.isArray(agents) &&
      agents.some((a) => a?.user_id === agentId)
    )
  } catch {
    return false
  }
}

/**
 * The workstations whose identity is complete. A bundle of add-workstation.sh is: an operator ran the script
 * and saw it fail or finish. A bundle of the VM API is when tuwunel accepts its appservice token as its sender
 * and its admission reached the last step (see `admissionFinished`). An admission can fail at any step, and
 * the bundle then stays on disk with its marker.
 * Read-only. It never admits, because that would write the roster again without the persona and the project.
 */
export async function liveWorkstations(
  deps: LiveDeps,
  bundles: BundleSummary[],
): Promise<Set<string>> {
  const live = await Promise.all(
    bundles.map(async ({ workstation, agentId }) => {
      const dir = join(deps.workstationsDir, workstation)
      if (!(await access(join(dir, MARKER)).then(() => true, () => false))) return workstation
      const env = await readFile(join(dir, '.env'), 'utf8').catch(() => '')
      const token = envVar(env, 'MATRIX_AS_TOKEN')
      const ws = envVar(env, 'WORKSTATION') ?? workstation
      const sender = `@${ws}:${envVar(env, 'SERVER_NAME')}`
      const loaded = token && (await whoami(deps.conn, token)) === sender
      return loaded && (await admissionFinished(deps, ws, agentId)) ? workstation : undefined
    }),
  )
  return new Set(live.filter((workstation): workstation is string => workstation !== undefined))
}

/**
 * An agent is free when it can move to a new VM: an opencode agent without a VM of its name. With `live`,
 * also only when its identity is complete (see `liveWorkstations`).
 */
export function agentsWithFree(
  bundles: BundleSummary[],
  vms: Vm[],
  live?: ReadonlySet<string>,
): AgentEntry[] {
  const used = new Set(vms.map((vm) => vm.name))
  return bundles.map((b) => ({
    workstation: b.workstation,
    agent_id: b.agentId,
    preset: b.preset,
    free:
      b.preset === 'opencode' && !used.has(b.workstation) && (live?.has(b.workstation) ?? true),
  }))
}
