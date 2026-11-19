/** The VM view of contracts section 2: the project of a VM, its name, and `can.set_project`. */
import { projectName } from './agents.js'
import type { Caller } from './auth.js'
import { relay } from './control-plane.js'
import { vmCanSetProject } from './policy.js'
import type { Project } from './project-records.js'
import type { Vm } from './vms.js'

export type VmDecorator = (vm: Vm) => Record<string, unknown>

/** The VM with `project_id` (null when absent), `project` (the name or null), and `can: { set_project }`. */
export function vmView(caller: Caller, projects: readonly Project[], vm: Vm): Record<string, unknown> {
  return {
    ...vm,
    project_id: vm.project_id ?? null,
    project: projectName(projects, vm.project_id),
    can: { set_project: vmCanSetProject(caller, vm) },
  }
}

/** A successful JSON object with a string `id` is decorated. Any other body, and a body-less 202, pass on as they are. */
export async function relayVm(upstream: Response, decorate: VmDecorator): Promise<Response> {
  const res = await relay(upstream)
  if (!res.ok) return res
  const vm: unknown = await res
    .clone()
    .json()
    .catch(() => undefined)
  if (typeof vm !== 'object' || vm === null || typeof (vm as Partial<Vm>).id !== 'string') return res
  return new Response(JSON.stringify(decorate(vm as Vm)), {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  })
}
