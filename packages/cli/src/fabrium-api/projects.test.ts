import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRecord } from './agent-records.js'
import type { Project } from './project-records.js'
import { ADMIN, createTestApi, fakeAgentStore, fakeProjectStore, jsonResponse } from './test-api.js'

// The roles of agents.test.ts.
const ANN = ADMIN // admin
const LUIS = '@luis:example.org' // vm-creator
const ANA = '@ana:example.org' // agents-manager

const project = (id: string, name: string): Project => ({
  id: id.repeat(32),
  name,
  created_at: '2026-11-19T19:00:00Z',
  updated_at: '2026-11-19T19:00:00Z',
})
const PAYMENTS = project('a', 'Payments')
const BILLING = project('b', 'Billing')

const LIMA = { id: 'i-0123456789abcdef0', name: 'lima', state: 'running', creator: LUIS, launched_at: '2026-11-18T19:00:00Z' }
const CUSCO = { id: 'i-0c0c0c0c0c0c0c0c0', name: 'cusco', state: 'running', creator: LUIS, launched_at: '2026-11-18T19:00:00Z' }
const HUB = { id: 'i-0b0b0b0b0b0b0b0b0', name: 'hub', state: 'running', creator: LUIS, launched_at: '2026-11-18T19:00:00Z', project_id: PAYMENTS.id }

let api: ReturnType<typeof createTestApi>
let clock: number
let store: { records: AgentRecord[] }
let projects: Project[]
let vms: Record<string, unknown>[]
const tokens: Record<string, string> = {}

const place = (id: string, vm: string | null, projectId: string | null) =>
  store.records.push({
    id,
    name: id,
    owner: ANA,
    description: '',
    model: 'glm-5-3',
    tag: null,
    project: null,
    project_id: projectId,
    vm,
    rooms: vm === null ? [] : ['#general:example.org'],
  })

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  clock = Date.parse('2026-11-19T19:00:00Z')
  api = createTestApi({ now: () => clock, whoamiTimeoutMs: 100, pollIntervalMs: 5 })
  projects = [{ ...PAYMENTS }, { ...BILLING }]
  store = fakeAgentStore(api.controlPlane, projects)
  vms = [LIMA, CUSCO]
  fakeProjectStore(api.controlPlane, projects, { records: store.records, vms })
  api.controlPlane.on('GET', '/v1/vms', () => jsonResponse(200, vms))
  for (const [user, level] of [[LUIS, 70], [ANA, 40]] as const) api.fake.joinSpace(user, level)
  for (const user of [ANN, LUIS, ANA]) tokens[user] = api.fake.openIdToken(user)
})
afterEach(() => {
  api.cleanup()
  vi.restoreAllMocks()
})

const as = (user: string, method: string, path: string, json?: unknown) =>
  api.request(method, path, { token: tokens[user], json })
const writes = () => api.controlPlane.requests.filter((r) => r.method !== 'GET')
const roster = (vm: string) => api.fake.state(api.fake.spaceId, 'dev.zooid.workforce', vm) as
  | { agents: { name: string; project?: string }[] }
  | undefined
const rosterWrites = (vm: string) =>
  api.fake.calls.filter((c) => c.method === 'PUT' && c.path.includes(`/state/dev.zooid.workforce/${vm}`)).length

describe('GET /projects', () => {
  it('gives the view and can.manage for each role', async () => {
    for (const [user, manage] of [[ANN, true], [LUIS, false], [ANA, false]] as const) {
      const res = await as(user, 'GET', '/projects')
      expect([res.status, await res.json()], user).toEqual([
        200,
        {
          projects: [
            { id: BILLING.id, name: 'Billing', in_use: false },
            { id: PAYMENTS.id, name: 'Payments', in_use: false },
          ],
          can: { manage },
        },
      ])
    }
  })

  it('in_use is true for a record, true for a listed VM (also shutting-down), false otherwise', async () => {
    const inUse = async () =>
      ((await (await as(ANA, 'GET', '/projects')).json()) as { projects: { name: string; in_use: boolean }[] }).projects
        .filter((p) => p.in_use)
        .map((p) => p.name)
    expect(await inUse()).toEqual([])
    place('p1', null, BILLING.id)
    expect(await inUse()).toEqual(['Billing'])
    store.records.length = 0
    vms.push({ ...HUB, state: 'shutting-down' })
    expect(await inUse()).toEqual(['Payments'])
  })

  it('keeps the order of the control plane', async () => {
    api.controlPlane.on('GET', '/v1/projects', jsonResponse(200, [PAYMENTS, BILLING]))
    const body = (await (await as(ANA, 'GET', '/projects')).json()) as { projects: { name: string }[] }
    expect(body.projects.map((p) => p.name)).toEqual(['Payments', 'Billing'])
  })

  it('passes a control plane failure on as 502', async () => {
    api.controlPlane.on('GET', '/v1/projects', jsonResponse(500, { error: 'database is locked' }))
    const res = await as(ANA, 'GET', '/projects')
    expect([res.status, await res.json()]).toEqual([502, { error: 'control plane sent an invalid response' }])
  })
})

describe('POST /projects', () => {
  it('creates a project as an admin', async () => {
    const res = await as(ANN, 'POST', '/projects', { name: 'Ops' })
    expect(res.status).toBe(201)
    const view = await res.json()
    expect(view).toEqual({ id: expect.stringMatching(/^[0-9a-f]{32}$/), name: 'Ops', in_use: false })
    expect(projects.map((p) => p.id)).toContain(view.id)
  })

  it('removes white space around the name before it sends it', async () => {
    expect((await as(ANN, 'POST', '/projects', { name: '  Ops \n' })).status).toBe(201)
    expect(writes().map((r) => r.body)).toEqual([{ name: 'Ops' }])
  })

  it('answers 403 for a vm-creator and an agents-manager, with no control plane call', async () => {
    for (const user of [LUIS, ANA]) {
      const res = await as(user, 'POST', '/projects', { name: 'Ops' })
      expect([res.status, await res.json()], user).toEqual([403, { error: 'forbidden' }])
    }
    expect(api.controlPlane.requests).toEqual([])
  })

  it('refuses a body that is not {"name": string}, or has another field', async () => {
    for (const json of [{}, { name: 5 }, { name: 'Ops', id: 'x' }, ['Ops'], 'Ops', null]) {
      const res = await as(ANN, 'POST', '/projects', json)
      expect([res.status, await res.json()], JSON.stringify(json)).toEqual([400, { error: 'invalid request body' }])
    }
    const text = await api.app.request('/_fabrium/v1/projects', {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens[ANN]}`, 'content-type': 'application/json' },
      body: '{"name":',
    })
    expect([text.status, await text.json()]).toEqual([400, { error: 'invalid request body' }])
    expect(api.controlPlane.requests).toEqual([])
  })

  it('passes the 400 and the 409 of the control plane on', async () => {
    const blank = await as(ANN, 'POST', '/projects', { name: '   ' })
    expect([blank.status, await blank.json()]).toEqual([400, { error: 'invalid project name' }])
    const taken = await as(ANN, 'POST', '/projects', { name: 'billing' })
    expect([taken.status, await taken.json()]).toEqual([409, { error: 'name in use' }])
  })
})

describe('PUT /projects/:id', () => {
  beforeEach(() => {
    vms.push(HUB)
    place('r1', 'lima', PAYMENTS.id)
    place('r2', 'hub', PAYMENTS.id)
    place('r3', 'hub', null)
    place('r4', 'cusco', BILLING.id)
    place('r5', null, PAYMENTS.id)
  })

  it('renames, and rebuilds the roster of each VM name with an agent of the project', async () => {
    const res = await as(ANN, 'PUT', `/projects/${PAYMENTS.id}`, { name: ' Ledger ' })
    expect([res.status, await res.json()]).toEqual([200, { id: PAYMENTS.id, name: 'Ledger', in_use: true }])
    expect(writes().map((r) => [r.method, r.path, r.body])).toEqual([
      ['PUT', `/v1/projects/${PAYMENTS.id}`, { name: 'Ledger' }],
    ])
    expect(roster('lima')?.agents).toEqual([expect.objectContaining({ name: 'r1', project: 'Ledger' })])
    expect(roster('hub')?.agents).toEqual([
      expect.objectContaining({ name: 'r2', project: 'Ledger' }),
      expect.not.objectContaining({ project: expect.anything() }),
    ])
    expect(rosterWrites('lima')).toBe(1)
    expect(rosterWrites('hub')).toBe(1)
    expect(rosterWrites('cusco')).toBe(0)
  })

  it('a roster failure does not fail the rename', async () => {
    const warn = vi.mocked(console.warn)
    api.fake.failOnce('PUT', /\/state\/dev\.zooid\.workforce\/hub$/, 500)
    const res = await as(ANN, 'PUT', `/projects/${PAYMENTS.id}`, { name: 'Ledger' })
    expect(res.status).toBe(200)
    expect(projects.find((p) => p.id === PAYMENTS.id)?.name).toBe('Ledger')
    expect(roster('lima')?.agents[0]?.project).toBe('Ledger')
    expect(JSON.stringify(warn.mock.calls)).toContain('the roster of hub was not rebuilt')
  })

  it('passes the 404 and the 409 on, and answers 403 for a non-admin', async () => {
    const missing = await as(ANN, 'PUT', `/projects/${'f'.repeat(32)}`, { name: 'Ledger' })
    expect([missing.status, await missing.json()]).toEqual([404, { error: 'not found' }])
    const taken = await as(ANN, 'PUT', `/projects/${PAYMENTS.id}`, { name: 'BILLING' })
    expect([taken.status, await taken.json()]).toEqual([409, { error: 'name in use' }])
    // A rename that changes only the case of the name of the same project.
    expect((await as(ANN, 'PUT', `/projects/${PAYMENTS.id}`, { name: 'payments' })).status).toBe(200)
    const before = api.controlPlane.requests.length
    for (const user of [LUIS, ANA]) {
      const res = await as(user, 'PUT', `/projects/${PAYMENTS.id}`, { name: 'Ledger' })
      expect([res.status, await res.json()], user).toEqual([403, { error: 'forbidden' }])
    }
    expect(api.controlPlane.requests.length).toBe(before)
  })
})

describe('a VM that is launching', () => {
  // The control plane lists a new VM late: in these tests the list never shows it.
  beforeEach(async () => {
    place('p1', null, null)
    api.controlPlane.on('POST', '/v1/vms', (req) =>
      jsonResponse(201, { id: 'i-0d0d0d0d0d0d0d0d0', name: 'kilo', state: 'pending', ...(req.body as object) }),
    )
    const res = await as(LUIS, 'POST', '/vms', {
      agent: 'p1',
      name: 'kilo',
      haven_api_key: 'hk-1',
      project_id: PAYMENTS.id,
    })
    expect(res.status).toBe(201)
  })
  const inUse = async () =>
    ((await (await as(ANA, 'GET', '/projects')).json()) as { projects: { name: string; in_use: boolean }[] }).projects
      .filter((p) => p.in_use)
      .map((p) => p.name)

  it('keeps its project in use for 10 minutes', async () => {
    expect(await inUse()).toEqual(['Payments'])
    clock += 10 * 60_000
    expect(await inUse()).toEqual([])
  })

  it('makes a delete of its project 409 without a control plane call', async () => {
    const res = await as(ANN, 'DELETE', `/projects/${PAYMENTS.id}`)
    expect([res.status, await res.json()]).toEqual([409, { error: 'project in use' }])
    expect(writes().filter((r) => r.path.startsWith('/v1/projects'))).toEqual([])
    clock += 10 * 60_000
    expect((await as(ANN, 'DELETE', `/projects/${PAYMENTS.id}`)).status).toBe(204)
  })
})

describe('DELETE /projects/:id', () => {
  it('deletes a project that nothing has', async () => {
    const res = await as(ANN, 'DELETE', `/projects/${BILLING.id}`)
    expect([res.status, await res.text()]).toEqual([204, ''])
    expect(projects.map((p) => p.name)).toEqual(['Payments'])
  })

  it('passes a 409 on while in_use is false', async () => {
    // A registry row of a VM that the list does not show.
    api.controlPlane.on('DELETE', /^\/v1\/projects\//, jsonResponse(409, { error: 'project in use' }))
    const listed = (await (await as(ANN, 'GET', '/projects')).json()) as { projects: { in_use: boolean }[] }
    expect(listed.projects.every((p) => !p.in_use)).toBe(true)
    const res = await as(ANN, 'DELETE', `/projects/${BILLING.id}`)
    expect([res.status, await res.json()]).toEqual([409, { error: 'project in use' }])
  })

  it('sends the delete while in_use is true, and passes the 409 on', async () => {
    place('p1', null, BILLING.id)
    const res = await as(ANN, 'DELETE', `/projects/${BILLING.id}`)
    expect([res.status, await res.json()]).toEqual([409, { error: 'project in use' }])
    expect(writes().map((r) => [r.method, r.path])).toEqual([['DELETE', `/v1/projects/${BILLING.id}`]])
  })

  it('passes the 404 on, and answers 403 for a non-admin', async () => {
    const missing = await as(ANN, 'DELETE', `/projects/${'f'.repeat(32)}`)
    expect([missing.status, await missing.json()]).toEqual([404, { error: 'not found' }])
    const before = api.controlPlane.requests.length
    for (const user of [LUIS, ANA]) {
      const res = await as(user, 'DELETE', `/projects/${BILLING.id}`)
      expect([res.status, await res.json()], user).toEqual([403, { error: 'forbidden' }])
    }
    expect(api.controlPlane.requests.length).toBe(before)
    expect(projects).toHaveLength(2)
  })
})
