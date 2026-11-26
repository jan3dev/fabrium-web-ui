import { readBody, relay, type ControlPlane } from './control-plane.js'
import { ApiError } from './errors.js'

/** A VM of the control plane (VM contracts, section 1). */
export interface Vm {
  id: string
  name: string
  state: string
  creator?: string | null
  /** The project of the VM. Absent or null: a personal VM. */
  project_id?: string | null
  launched_at: string
  [key: string]: unknown
}

export const isVm = (vm: Partial<Vm> | null): boolean =>
  typeof vm?.id === 'string' &&
  typeof vm.name === 'string' &&
  typeof vm.state === 'string' &&
  (vm.project_id == null || typeof vm.project_id === 'string')

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
  if (!Array.isArray(body) || !body.every(isVm)) {
    throw new ApiError(502, { error: 'control plane sent an invalid response' })
  }
  return { vms: body as Vm[] }
}
