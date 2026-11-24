import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { changeRecord, createRecord, fetchRecords, removeRecord } from './agent-records.js'
import { createControlPlane, type ControlPlane } from './control-plane.js'
import {
  CONTROL_PLANE_KEY,
  CONTROL_PLANE_URL,
  createTestApi,
  fakeAgentStore,
  jsonResponse,
} from './test-api.js'

const ANA = '@ana:example.org'

let api: ReturnType<typeof createTestApi>
let store: ReturnType<typeof fakeAgentStore>
let cp: ControlPlane
beforeEach(() => {
  api = createTestApi()
  store = fakeAgentStore(api.controlPlane)
  cp = createControlPlane({ baseUrl: CONTROL_PLANE_URL, apiKey: CONTROL_PLANE_KEY, fetch: api.deps.conn.fetch })
})
afterEach(() => {
  api.cleanup()
  vi.restoreAllMocks()
})

it('lists the records', async () => {
  const made = await createRecord(cp, { name: 'reviewer', owner: ANA, model: 'glm-5-3' })
  expect(made).toMatchObject({ name: 'reviewer', owner: ANA, description: '', vm: null, rooms: [] })
  expect(await fetchRecords(cp)).toEqual([made])
  expect(api.controlPlane.requests.at(-1)).toMatchObject({
    method: 'GET',
    path: '/v1/agents',
    authorization: `Bearer ${CONTROL_PLANE_KEY}`,
  })
})

it('passes a 409 on with its body', async () => {
  const onLima = { name: 'reviewer', owner: ANA, model: 'glm-5-3', vm: 'lima', rooms: ['#general:example.org'] }
  const first = await createRecord(cp, onLima)
  await expect(createRecord(cp, onLima)).rejects.toMatchObject({ status: 409, body: { error: 'name in use' } })
  await expect(changeRecord(cp, first.id, { vm: 'kilo', rooms: [] })).rejects.toMatchObject({
    status: 409,
    body: { error: 'vm already set' },
  })
  expect(store.records).toHaveLength(1)
})

it('turns a 500 and an unreadable body into a 502', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const invalid = { status: 502, body: { error: 'control plane sent an invalid response' } }
  api.controlPlane.on('GET', '/v1/agents', jsonResponse(500, { error: 'database is locked' }))
  await expect(fetchRecords(cp)).rejects.toMatchObject(invalid)
  api.controlPlane.on('GET', '/v1/agents', new Response('<html>', { status: 200 }))
  await expect(fetchRecords(cp)).rejects.toMatchObject(invalid)
  // The log names the status, never the body of the answer.
  expect(JSON.stringify(warn.mock.calls)).not.toContain('database is locked')
})

it('refuses a record whose name or vm can not be a Matrix ID or a path', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const record = { id: 'x', name: 'reviewer', owner: ANA, description: '', model: 'm', tag: null, project: null, vm: null, rooms: [] }
  for (const bad of [{ name: '../x' }, { vm: '../x' }, { vm: '' }, { rooms: [1] }]) {
    api.controlPlane.on('GET', '/v1/agents', jsonResponse(200, [{ ...record, ...bad }]))
    await expect(fetchRecords(cp), JSON.stringify(bad)).rejects.toMatchObject({ status: 502 })
  }
})

it('a delete of a missing record is done', async () => {
  const made = await createRecord(cp, { name: 'reviewer', owner: ANA, model: 'glm-5-3' })
  await removeRecord(cp, made.id)
  expect(store.records).toEqual([])
  await expect(removeRecord(cp, made.id)).resolves.toBeUndefined()
  expect(api.controlPlane.requests.at(-1)).toMatchObject({ method: 'DELETE', path: `/v1/agents/${made.id}` })
})

it('keeps project_id, and reads an absent one as null', async () => {
  const record = { id: 'x', name: 'reviewer', owner: ANA, description: '', model: 'm', tag: null, project: null, vm: null, rooms: [] }
  api.controlPlane.on('GET', '/v1/agents', jsonResponse(200, [record, { ...record, id: 'y', project_id: 'pr1' }]))
  expect((await fetchRecords(cp)).map((r) => r.project_id)).toEqual([null, 'pr1'])
})

it('answers 502 for a project_id that is not a string or null', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const record = { id: 'x', name: 'reviewer', owner: ANA, description: '', model: 'm', tag: null, project: null, vm: null, rooms: [] }
  for (const projectId of [5, {}, ['pr1']]) {
    api.controlPlane.on('GET', '/v1/agents', jsonResponse(200, [{ ...record, project_id: projectId }]))
    await expect(fetchRecords(cp), JSON.stringify(projectId)).rejects.toMatchObject({ status: 502 })
  }
})
