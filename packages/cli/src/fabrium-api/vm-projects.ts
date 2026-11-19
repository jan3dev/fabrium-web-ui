/**
 * The VM view of contracts section 2 (the project of a VM, its name, and `can.set_project`), and
 * `PUT /vms/:id/owner`.
 */
import { checkProject, loadWorld, parseProjectId, projectName, type AgentContext } from './agents.js'
import { isAdmin, type Caller } from './auth.js'
import { relay } from './control-plane.js'
import { ApiError } from './errors.js'
import { checkPerson } from './people.js'
import { hasProjectAgent, isProject, managesVm, vmCanSetProject } from './policy.js'
import { setVmOwner, type Project } from './project-records.js'
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

const bad = (error: string) => new ApiError(400, { error })
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

/**
 * `PUT /vms/:id/owner`, inside the queue. The order of the checks is that of `PUT /agents/:id`: 404, 403, 400,
 * the rule of the project VM, then the person. The control plane gets `{project_id}`, `{project_id: "", creator}`,
 * or `{creator}`. No agent changes, so no roster is rebuilt.
 */
export async function changeVmOwner(ctx: AgentContext, caller: Caller, id: string, raw: unknown): Promise<Response> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw bad('invalid request body')
  const b = raw as Record<string, unknown>
  if (Object.keys(b).some((k) => k !== 'project_id' && k !== 'owner')) throw bad('invalid request body')
  const sentProjectId = parseProjectId(b.project_id)
  if (b.owner != null && typeof b.owner !== 'string') throw bad('owner must be a member of the workspace')
  const sentOwner = (b.owner ?? undefined) as string | undefined
  if (sentProjectId === undefined && sentOwner === undefined) throw bad('invalid request body')

  const world = await loadWorld(ctx, caller)
  const vm = world.vms.find((v) => v.id === id)
  if (!vm || !managesVm(caller, vm)) throw new ApiError(404, { error: 'not found' })
  // The stored value is not a change, and "" for a personal VM is the stored value (D1, D2).
  const projectId = sentProjectId === (vm.project_id ?? '') ? undefined : sentProjectId
  const owner = sentOwner === vm.creator ? undefined : sentOwner
  const leaves = projectId === ''
  const projectAfter = projectId === undefined ? isProject(vm) : !leaves
  if (projectId !== undefined && !vmCanSetProject(caller, vm)) throw new ApiError(403, { error: 'forbidden' })
  // On a leave, can.set_project covers the owner. A personal VM gets another owner only from an admin.
  if (owner !== undefined && !isProject(vm) && !isAdmin(caller.role)) throw new ApiError(403, { error: 'forbidden' })
  if (owner !== undefined && projectAfter) throw bad('a project vm has no owner')
  if (projectId) checkProject(world, projectId)
  if (leaves && hasProjectAgent(world.records, vm.name)) {
    throw new ApiError(409, { error: 'the vm has project agents' })
  }
  // A VM that leaves without an owner gets its stored creator back, who must still be a person (D4: null is not).
  if (owner !== undefined || leaves) await checkPerson(ctx, owner ?? vm.creator ?? '')
  if (projectId === undefined && owner === undefined) return json(vmView(caller, world.projects, vm))
  const changed = await setVmOwner(ctx.controlPlane, vm.id, {
    ...(projectId === undefined ? {} : { project_id: projectId }),
    ...(owner === undefined ? {} : { creator: owner }),
  })
  return json(vmView(caller, world.projects, changed))
}
