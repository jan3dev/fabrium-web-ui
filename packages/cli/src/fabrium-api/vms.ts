import type { BundleSummary } from './bundle.js'
import { relay, type ControlPlane } from './control-plane.js'
import { ApiError } from './errors.js'

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

/** An agent is free when it can move to a new VM: an opencode agent without a VM of its name. */
export function agentsWithFree(bundles: BundleSummary[], vms: Vm[]): AgentEntry[] {
  const used = new Set(vms.map((vm) => vm.name))
  return bundles.map((b) => ({
    workstation: b.workstation,
    agent_id: b.agentId,
    preset: b.preset,
    free: b.preset === 'opencode' && !used.has(b.workstation),
  }))
}
