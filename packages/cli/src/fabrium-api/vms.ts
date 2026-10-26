import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MARKER, envVar, type BundleSummary } from './bundle.js'
import { relay, type ControlPlane } from './control-plane.js'
import { ApiError } from './errors.js'
import { whoami, type MatrixConn } from './matrix.js'

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
  const body: unknown = await upstream.json().catch(() => null)
  if (!Array.isArray(body) || !body.every((vm) => typeof vm?.name === 'string')) {
    throw new ApiError(502, { error: 'control plane sent an invalid response' })
  }
  return { vms: body as Vm[] }
}

/**
 * The workstations whose identity is complete. A bundle of add-workstation.sh is: tuwunel loaded its
 * registration when the script ran. A bundle of the VM API is when tuwunel accepts its appservice token as its
 * sender: an admission that stopped before the registration loaded leaves a bundle that no VM can use.
 * Read-only. It never admits, because that would write the roster again without the persona and the project.
 */
export async function liveWorkstations(
  conn: MatrixConn,
  root: string,
  bundles: BundleSummary[],
): Promise<Set<string>> {
  const live = await Promise.all(
    bundles.map(async ({ workstation }) => {
      const dir = join(root, workstation)
      if (!(await access(join(dir, MARKER)).then(() => true, () => false))) return workstation
      const env = await readFile(join(dir, '.env'), 'utf8').catch(() => '')
      const token = envVar(env, 'MATRIX_AS_TOKEN')
      const sender = `@${envVar(env, 'WORKSTATION') ?? workstation}:${envVar(env, 'SERVER_NAME')}`
      return token && (await whoami(conn, token)) === sender ? workstation : undefined
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
