import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentRecord } from './agent-records.js'
import type { Project } from './project-records.js'
import { ADMIN, MEMBER, createTestApi, fakeAgentStore, fakeProjectStore, jsonResponse } from './test-api.js'

const ANN = ADMIN // admin
const LUIS = '@luis:example.org' // vm-creator
const VERA = '@vera:example.org' // vm-creator
const ANA = '@ana:example.org' // agents-manager
const BOB = MEMBER // a person without a role
const ZOOID = '@zooid:example.org'

const PR1 = '1'.repeat(32)
const PR2 = '2'.repeat(32)
const project = (id: string, name: string): Project => ({
  id,
  name,
  created_at: '2026-11-19T19:00:00Z',
  updated_at: '2026-11-19T19:00:00Z',
})
const vm = (id: string, name: string, creator: string | null, projectId: string | null) => ({
  id,
  name,
  state: 'running',
  launched_at: '2026-11-18T19:00:00Z',
  creator,
  project_id: projectId,
  registered: true,
})

let api: ReturnType<typeof createTestApi>
let store: { records: AgentRecord[] }
let vms: Record<string, unknown>[]
const tokens: Record<string, string> = {}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  api = createTestApi()
  const projects = [project(PR1, 'Payments'), project(PR2, 'Billing')]
  store = fakeAgentStore(api.controlPlane, projects)
  // lima is personal, of @luis. hub and dock are project VMs; dock has no creator.
  vms = [
    vm('i-0000000000000lima', 'lima', LUIS, null),
    vm('i-00000000000000hub', 'hub', LUIS, PR1),
    vm('i-0000000000000dock', 'dock', null, PR1),
  ]
  fakeProjectStore(api.controlPlane, projects, { records: store.records, vms })
  api.controlPlane.on('GET', '/v1/vms', () => jsonResponse(200, vms))
  for (const [user, level] of [[LUIS, 70], [VERA, 70], [ANA, 40]] as const) api.fake.joinSpace(user, level)
  for (const user of [ANN, LUIS, VERA, ANA]) tokens[user] = api.fake.openIdToken(user)
})
afterEach(() => {
  api.cleanup()
  vi.restoreAllMocks()
})

const idOf = (name: string) => vms.find((v) => v.name === name)!.id as string
const put = (user: string, name: string, json: unknown) =>
  api.request('PUT', `/vms/${idOf(name)}/owner`, { token: tokens[user], json })
const writes = () => api.controlPlane.requests.filter((r) => r.method !== 'GET')
const agentOnHub = (projectId: string | null) =>
  store.records.push({
    id: 'q1',
    name: 'planner',
    owner: ANA,
    description: '',
    model: 'glm-5-3',
    tag: null,
    project: null,
    project_id: projectId,
    vm: 'hub',
    rooms: [],
  })

const forbidden = { error: 'forbidden' }
const noOwner = { error: 'a project vm has no owner' }
const invalidBody = { error: 'invalid request body' }

it.each([
  // caller, VM, body, status, answer, the body that the control plane got (null: no write)
  [LUIS, 'lima', { project_id: PR1 }, 200, { project_id: PR1, project: 'Payments' }, { project_id: PR1 }],
  // @vera does not manage lima.
  [VERA, 'lima', { project_id: PR1 }, 404, { error: 'not found' }, null],
  [ANN, 'hub', { project_id: PR2 }, 200, { project_id: PR2, project: 'Billing' }, { project_id: PR2 }],
  [LUIS, 'hub', { project_id: PR2 }, 403, forbidden, null],
  // A vm-creator cannot take a project VM out.
  [LUIS, 'hub', { project_id: '' }, 403, forbidden, null],
  // The stored creator is a person.
  [ANN, 'hub', { project_id: '' }, 200, { project_id: null, project: null, creator: LUIS }, { project_id: '' }],
  [ANN, 'hub', { project_id: '', owner: BOB }, 200, { project_id: null, creator: BOB }, { project_id: '', creator: BOB }],
  // A creator of null.
  [ANN, 'dock', { project_id: '' }, 400, { error: 'owner must be a member of the workspace' }, null],
  [ANN, 'lima', { owner: BOB }, 200, { creator: BOB }, { creator: BOB }],
  // The creator may not change the owner.
  [LUIS, 'lima', { owner: BOB }, 403, forbidden, null],
  [ANN, 'hub', { owner: BOB }, 400, noOwner, null],
  [LUIS, 'hub', { owner: BOB }, 400, noOwner, null],
  [ANN, 'lima', { project_id: PR1, owner: BOB }, 400, noOwner, null],
  [ANN, 'lima', { owner: ZOOID }, 400, { error: 'owner must be a person' }, null],
  [ANN, 'lima', { owner: '@nobody:example.org' }, 400, { error: 'owner must be a member of the workspace' }, null],
  // D2: "" for a personal VM. D1: the stored project, and the stored creator.
  [LUIS, 'lima', { project_id: '' }, 200, { project_id: null }, null],
  [LUIS, 'hub', { project_id: PR1 }, 200, { project_id: PR1 }, null],
  [ANN, 'lima', { owner: LUIS }, 200, { creator: LUIS }, null],
  [ANN, 'lima', {}, 400, invalidBody, null],
  [ANN, 'lima', { name: 'x' }, 400, invalidBody, null],
  [ANN, 'lima', { project_id: PR1, creator: BOB }, 400, invalidBody, null],
  [ANN, 'lima', { project_id: null }, 400, invalidBody, null],
  [ANN, 'lima', { project_id: 5 }, 400, { error: 'project_id must be a string' }, null],
] as const)('%s on %s with %j is %i', async (user, name, body, status, answer, sent) => {
  const res = await put(user, name, body)
  expect([res.status, await res.json()]).toEqual([status, expect.objectContaining(answer)])
  expect(writes().map((r) => r.body)).toEqual(sent === null ? [] : [sent])
})

it('a body that is not a JSON object is 400', async () => {
  for (const json of [['x'], 'x', null]) {
    const res = await put(ANN, 'lima', json)
    expect([res.status, await res.json()], JSON.stringify(json)).toEqual([400, invalidBody])
  }
  const text = await api.app.request(`/_fabrium/v1/vms/${idOf('lima')}/owner`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${tokens[ANN]}`, 'content-type': 'application/json' },
    body: '{"owner":',
  })
  expect([text.status, await text.json()]).toEqual([400, { error: 'the body must be JSON' }])
  expect(writes()).toEqual([])
})

it('a VM with a project agent cannot leave its project', async () => {
  agentOnHub(PR1)
  const res = await put(ANN, 'hub', { project_id: '' })
  expect([res.status, await res.json()]).toEqual([409, { error: 'the vm has project agents' }])
  expect(writes()).toEqual([])
})

it('a VM with a personal agent can leave its project', async () => {
  agentOnHub(null)
  expect((await put(ANN, 'hub', { project_id: '' })).status).toBe(200)
})

it('an unknown project_id is 400, and a stale list is still 400', async () => {
  const unknown = await put(LUIS, 'lima', { project_id: 'f'.repeat(32) })
  expect([unknown.status, await unknown.json()]).toEqual([400, { error: 'unknown project' }])
  expect(writes()).toEqual([])
  // The list still has a project that the control plane deleted.
  const gone = project('3'.repeat(32), 'Gone')
  api.controlPlane.on('GET', '/v1/projects', jsonResponse(200, [gone]))
  const stale = await put(LUIS, 'lima', { project_id: gone.id })
  expect([stale.status, await stale.json()]).toEqual([400, { error: 'unknown project' }])
  expect(vms[0]!.project_id).toBeNull()
})

it('passes the 409 "vm has no registry row" and a 404 for an unknown VM id', async () => {
  vms[0]!.registered = false
  const res = await put(ANN, 'lima', { owner: BOB })
  expect([res.status, await res.json()]).toEqual([409, { error: 'vm has no registry row' }])
  const missing = await api.request('PUT', '/vms/i-0000000000000nope/owner', { json: { owner: BOB } })
  expect([missing.status, await missing.json()]).toEqual([404, { error: 'not found' }])
})

it('an agents-manager gets 403', async () => {
  const res = await put(ANA, 'hub', { project_id: PR2 })
  expect([res.status, await res.json()]).toEqual([403, forbidden])
  expect(api.controlPlane.requests).toEqual([])
})

it('the answer is the VM with the view fields', async () => {
  const res = await put(LUIS, 'lima', { project_id: PR1 })
  expect(await res.json()).toEqual({
    ...vm('i-0000000000000lima', 'lima', LUIS, PR1),
    project: 'Payments',
    can: { set_project: false },
  })
})

it('writes no roster event', async () => {
  agentOnHub(null)
  const before = api.fake.calls.length
  expect((await put(ANN, 'hub', { project_id: PR2 })).status).toBe(200)
  expect(api.fake.calls.slice(before).filter((c) => c.path.includes('dev.zooid.workforce'))).toEqual([])
})
