import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentRecord } from './agent-records.js'
import { createControlPlane, type ControlPlane } from './control-plane.js'
import {
  createProject,
  fetchProjects,
  removeProject,
  renameProject,
  setVmOwner,
  type Project,
} from './project-records.js'
import {
  CONTROL_PLANE_KEY,
  CONTROL_PLANE_URL,
  createTestApi,
  fakeProjectStore,
  jsonResponse,
} from './test-api.js'
import { fetchVms } from './vms.js'

const VM = { id: 'i-0123456789abcdef0', name: 'lima', state: 'running', creator: '@luis:example.org', registered: true }

let api: ReturnType<typeof createTestApi>
let cp: ControlPlane
let projects: Project[]
let world: { records: AgentRecord[]; vms: Record<string, unknown>[] }
beforeEach(() => {
  api = createTestApi()
  cp = createControlPlane({ baseUrl: CONTROL_PLANE_URL, apiKey: CONTROL_PLANE_KEY, fetch: api.deps.conn.fetch })
  projects = []
  world = { records: [], vms: [{ ...VM }] }
  fakeProjectStore(api.controlPlane, projects, world)
})
afterEach(() => {
  api.cleanup()
  vi.restoreAllMocks()
})

const record = (projectId: string | null): AgentRecord => ({
  id: 'a1',
  name: 'reviewer',
  owner: '@ana:example.org',
  description: '',
  model: 'glm-5-3',
  tag: null,
  project: null,
  project_id: projectId,
  vm: null,
  rooms: [],
})

it('lists the projects with the tenant key', async () => {
  expect(await fetchProjects(cp)).toEqual([])
  const made = await createProject(cp, 'Payments')
  expect(await fetchProjects(cp)).toEqual([made])
  expect(api.controlPlane.requests.at(-1)).toMatchObject({
    method: 'GET',
    path: '/v1/projects',
    authorization: `Bearer ${CONTROL_PLANE_KEY}`,
  })
})

it('creates and renames with {"name"}', async () => {
  const made = await createProject(cp, 'Payments')
  expect(made).toMatchObject({ id: expect.stringMatching(/^[0-9a-f]{32}$/), name: 'Payments' })
  const renamed = await renameProject(cp, made.id, 'Billing')
  expect(renamed).toMatchObject({ id: made.id, name: 'Billing' })
  expect(api.controlPlane.requests.map((r) => [r.method, r.path, r.body])).toEqual([
    ['POST', '/v1/projects', { name: 'Payments' }],
    ['PUT', `/v1/projects/${made.id}`, { name: 'Billing' }],
  ])
})

it('passes the 400 and 409 answers on', async () => {
  await expect(createProject(cp, ' Payments')).rejects.toMatchObject({
    status: 400,
    body: { error: 'invalid project name' },
  })
  await createProject(cp, 'Payments')
  await expect(createProject(cp, 'Payments')).rejects.toMatchObject({ status: 409, body: { error: 'name in use' } })
})

it('a delete passes a 404 and a 409 on', async () => {
  await expect(removeProject(cp, 'nope')).rejects.toMatchObject({ status: 404, body: { error: 'not found' } })
  const made = await createProject(cp, 'Payments')
  world.records.push(record(made.id))
  await expect(removeProject(cp, made.id)).rejects.toMatchObject({ status: 409, body: { error: 'project in use' } })
  world.records.length = 0
  await expect(removeProject(cp, made.id)).resolves.toBeUndefined()
  expect(projects).toEqual([])
})

it('turns a 500 and a project without a string id or name into a 502', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const invalid = { status: 502, body: { error: 'control plane sent an invalid response' } }
  api.controlPlane.on('GET', '/v1/projects', jsonResponse(500, { error: 'database is locked' }))
  await expect(fetchProjects(cp)).rejects.toMatchObject(invalid)
  for (const bad of [{ name: 'Payments' }, { id: 'x', name: 5 }, null]) {
    api.controlPlane.on('GET', '/v1/projects', jsonResponse(200, [bad]))
    await expect(fetchProjects(cp), JSON.stringify(bad)).rejects.toMatchObject(invalid)
  }
  api.controlPlane.on('GET', '/v1/projects', jsonResponse(200, { projects: [] }))
  await expect(fetchProjects(cp)).rejects.toMatchObject(invalid)
  api.controlPlane.on('POST', '/v1/projects', jsonResponse(201, { id: 5, name: 'Payments' }))
  await expect(createProject(cp, 'Payments')).rejects.toMatchObject(invalid)
  expect(JSON.stringify(warn.mock.calls)).not.toContain('database is locked')
})

it('sets the owner of a VM and returns the VM', async () => {
  const made = await createProject(cp, 'Payments')
  const vm = await setVmOwner(cp, VM.id, { project_id: made.id })
  expect(vm).toMatchObject({ id: VM.id, name: 'lima', project_id: made.id })
  expect(api.controlPlane.requests.at(-1)).toMatchObject({
    method: 'PUT',
    path: `/v1/vms/${VM.id}/owner`,
    body: { project_id: made.id },
  })
  expect(await setVmOwner(cp, VM.id, { project_id: '', creator: '@bob:example.org' })).toMatchObject({
    project_id: null,
    creator: '@bob:example.org',
  })
  await expect(setVmOwner(cp, VM.id, { project_id: 'nope' })).rejects.toMatchObject({
    status: 400,
    body: { error: 'unknown project' },
  })
  await expect(setVmOwner(cp, 'i-nope', { creator: '@bob:example.org' })).rejects.toMatchObject({ status: 404 })
  world.vms[0]!.registered = false
  await expect(setVmOwner(cp, VM.id, { creator: '@bob:example.org' })).rejects.toMatchObject({
    status: 409,
    body: { error: 'vm has no registry row' },
  })
})

it('the fake: a name equal in ASCII case is 409, a case-only rename of the same project is 200', async () => {
  const made = await createProject(cp, 'Payments')
  await expect(createProject(cp, 'PAYMENTS')).rejects.toMatchObject({ status: 409 })
  expect(await renameProject(cp, made.id, 'payments')).toMatchObject({ id: made.id, name: 'payments' })
  const other = await createProject(cp, 'billing')
  await expect(renameProject(cp, other.id, 'PAYMENTS')).rejects.toMatchObject({ status: 409 })
  // Sorted by name without regard to ASCII case.
  expect((await fetchProjects(cp)).map((p) => p.name)).toEqual(['billing', 'payments'])
})

it('the fake: a delete is 409 while a record or a VM has the project', async () => {
  const made = await createProject(cp, 'Payments')
  world.vms[0]!.project_id = made.id
  await expect(removeProject(cp, made.id)).rejects.toMatchObject({ status: 409 })
  world.vms[0]!.project_id = null
  world.records.push(record(made.id))
  await expect(removeProject(cp, made.id)).rejects.toMatchObject({ status: 409 })
})

it('a VM without project_id is personal, and a numeric project_id makes the list a 502', async () => {
  api.controlPlane.on('GET', '/v1/vms', jsonResponse(200, [VM, { ...VM, id: 'i-1', project_id: null }]))
  expect(await fetchVms(cp)).toEqual({ vms: [VM, { ...VM, id: 'i-1', project_id: null }] })
  api.controlPlane.on('GET', '/v1/vms', jsonResponse(200, [{ ...VM, project_id: 5 }]))
  await expect(fetchVms(cp)).rejects.toMatchObject({ status: 502 })
})
