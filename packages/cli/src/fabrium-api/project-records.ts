/** The project routes of the control plane and `PUT /v1/vms/{id}/owner` (contracts section 1). */
import { call } from './agent-records.js'
import type { ControlPlane } from './control-plane.js'
import { ApiError } from './errors.js'
import { isVm, type Vm } from './vms.js'

export interface Project {
  id: string
  name: string
  created_at: string
  updated_at: string
}

const invalid = () => new ApiError(502, { error: 'control plane sent an invalid response' })
const projectPath = (id: string) => `/v1/projects/${encodeURIComponent(id)}`

function project(value: unknown): Project {
  const p = value as Partial<Record<keyof Project, unknown>> | null
  if (typeof p !== 'object' || p === null || typeof p.id !== 'string' || typeof p.name !== 'string') throw invalid()
  return p as Project
}

export async function fetchProjects(cp: ControlPlane): Promise<Project[]> {
  const list = await call(cp, 'GET', '/v1/projects')
  if (!Array.isArray(list)) throw invalid()
  return list.map(project)
}

export async function createProject(cp: ControlPlane, name: string): Promise<Project> {
  return project(await call(cp, 'POST', '/v1/projects', { name }))
}

export async function renameProject(cp: ControlPlane, id: string, name: string): Promise<Project> {
  return project(await call(cp, 'PUT', projectPath(id), { name }))
}

/** A 404 and a 409 pass on as ApiError. A 404 is not "done". */
export async function removeProject(cp: ControlPlane, id: string): Promise<void> {
  await call(cp, 'DELETE', projectPath(id))
}

export async function setVmOwner(
  cp: ControlPlane,
  vmId: string,
  body: { project_id?: string; creator?: string },
): Promise<Vm> {
  const vm = await call(cp, 'PUT', `/v1/vms/${encodeURIComponent(vmId)}/owner`, body)
  if (!isVm(vm as Partial<Vm> | null)) throw invalid()
  return vm as Vm
}
