import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRecord } from './agent-records.js'
import type { Project } from './project-records.js'
import { ADMIN, MEMBER, createTestApi, fakeAgentStore, fakeProjectStore, jsonResponse } from './test-api.js'

// The world of the policy tests (policy.test.ts), with Matrix behind it.
const ANN = ADMIN // admin
const LUIS = '@luis:example.org' // vm-creator
const VERA = '@vera:example.org' // vm-creator
const ANA = '@ana:example.org' // agents-manager
const BOB = MEMBER // agents-manager

const LIMA = { id: 'i-0123456789abcdef0', name: 'lima', state: 'running', creator: LUIS, launched_at: '2026-11-18T19:00:00Z' }
const CUSCO = { id: 'i-0c0c0c0c0c0c0c0c0', name: 'cusco', state: 'running', creator: VERA, launched_at: '2026-11-18T19:00:00Z' }

let api: ReturnType<typeof createTestApi>
let store: { records: AgentRecord[] }
let projects: Project[]
let vms: Record<string, unknown>[]
const tokens: Record<string, string> = {}

/** A record, admitted on its VM as an earlier assign leaves it. */
async function place(id: string, name: string, vm: string | null, owner: string, over: Partial<AgentRecord> = {}) {
  if (vm !== null) await api.admit(vm, name)
  store.records.push({
    id,
    name,
    owner,
    description: '',
    model: 'glm-5-3',
    tag: null,
    project: null,
    project_id: null,
    vm,
    rooms: vm === null ? [] : ['#general:example.org'],
    ...over,
  })
}

beforeEach(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  api = createTestApi({
    whoamiTimeoutMs: 100,
    pollIntervalMs: 5,
    instanceAgents: [{ name: 's-meow', userId: '@s-meow:example.org' }],
  })
  projects = []
  store = fakeAgentStore(api.controlPlane, projects)
  vms = [LIMA, CUSCO]
  api.controlPlane.on('GET', '/v1/vms', () => jsonResponse(200, vms))
  api.controlPlane.on('DELETE', /^\/v1\/vms\/[^/]+$/, () => new Response(null, { status: 202 }))
  for (const [user, level] of [[LUIS, 70], [VERA, 70], [ANA, 40], [BOB, 40]] as const) {
    api.fake.joinSpace(user, level)
  }
  for (const user of [ANN, LUIS, VERA, ANA, BOB]) tokens[user] = api.fake.openIdToken(user)
  await place('p1', 'draft', null, ANA)
  await place('p2', 'helper', null, BOB)
  await place('a1', 'reviewer', 'lima', ANA, {
    description: 'You are an expert software engineer who does code reviews.',
    tag: 'Reviewer',
    project: 'Payments',
  })
  await place('a2', 'tester', 'lima', LUIS)
  await place('a3', 'builder', 'cusco', BOB)
  await place('a4', 'watcher', 'quito', BOB)
})
afterEach(() => {
  api.cleanup()
  vi.restoreAllMocks()
})

const as = (user: string, method: string, path: string, json?: unknown) =>
  api.request(method, path, { token: tokens[user], json })
const list = async (user: string) =>
  (await (await as(user, 'GET', '/agents')).json()) as {
    agents: { id: string; name: string; vm: unknown; agent_id: string | null }[]
    vms: unknown[]
    people: { user_id: string; name: string }[]
  }
const viewOf = async (user: string, id: string) => (await list(user)).agents.find((a) => a.id === id)
const writes = () => api.controlPlane.requests.filter((r) => r.method !== 'GET')
const recordOf = (id: string) => store.records.find((r) => r.id === id)
const roster = (vm: string) => api.fake.state(api.fake.spaceId, 'dev.zooid.workforce', vm)
const rosterNames = (vm: string) =>
  ((roster(vm) as { agents: { name: string }[] } | undefined)?.agents ?? []).map((a) => a.name)
const adminMessages = () => api.fake.messages.filter((m) => m.roomId === api.fake.adminRoomId).map((m) => m.body)
const bundleOf = (vm: string) => join(api.workstationsDir, vm)

describe('GET /agents', () => {
  it('gives the view of section 2 for an agent on a VM', async () => {
    expect(await viewOf(ANA, 'a1')).toEqual({
      id: 'a1',
      name: 'reviewer',
      agent_id: '@lima.reviewer:example.org',
      owner: ANA,
      description: 'You are an expert software engineer who does code reviews.',
      model: 'glm-5-3',
      tag: 'Reviewer',
      // The text label of phase 1 is not shown.
      project_id: null,
      project: null,
      vm: { name: 'lima', id: 'i-0123456789abcdef0', state: 'running', owner: LUIS, project_id: null },
      source: 'control-plane',
      can: {
        edit: true,
        set_owner: false,
        set_project: true,
        assign: false,
        create_vm: false,
        delete: true,
        delete_needs_vm: false,
      },
    })
  })

  it('a profile has agent_id null and vm null', async () => {
    expect(await viewOf(ANA, 'p1')).toMatchObject({ agent_id: null, vm: null, can: { assign: true } })
  })

  it('an agent whose VM is deleted has vm {name} only', async () => {
    expect(await viewOf(BOB, 'a4')).toMatchObject({ agent_id: '@quito.watcher:example.org', vm: { name: 'quito' } })
    expect((await viewOf(BOB, 'a4'))?.vm).toEqual({ name: 'quito' })
  })

  it('a live VM without a creator has a VM owner of null', async () => {
    vms = [{ ...LIMA, creator: null }, CUSCO]
    expect((await viewOf(ANN, 'a1'))?.vm).toEqual({
      name: 'lima',
      id: LIMA.id,
      state: 'running',
      owner: null,
      project_id: null,
    })
  })

  it('lists what the caller sees, by name, with the instance agents last', async () => {
    // Two profiles with one name: the id decides.
    await place('p0', 'draft', null, VERA)
    const ids = async (user: string) => (await list(user)).agents.map((a) => a.id)
    expect(await ids(LUIS)).toEqual(['p0', 'p1', 'p2', 'a1', 'a2', 'a4', 'instance:s-meow'])
    expect(await ids(ANA)).toEqual(['p1', 'a1', 'instance:s-meow'])
    expect(await ids(BOB)).toEqual(['a3', 'p2', 'a4', 'instance:s-meow'])
    expect(await ids(ANN)).toEqual(['a3', 'p0', 'p1', 'p2', 'a1', 'a2', 'a4', 'instance:s-meow'])
  })

  it('an instance agent is read-only', async () => {
    expect((await list(BOB)).agents.at(-1)).toEqual({
      id: 'instance:s-meow',
      name: 's-meow',
      agent_id: '@s-meow:example.org',
      owner: null,
      description: null,
      model: null,
      tag: null,
      project_id: null,
      project: null,
      vm: null,
      source: 'instance',
      can: {
        edit: false,
        set_owner: false,
        set_project: false,
        assign: false,
        create_vm: false,
        delete: false,
        delete_needs_vm: false,
      },
    })
  })

  it.each([
    [ANN, ['cusco', 'lima']],
    [LUIS, ['lima']],
    [ANA, ['lima']],
    [BOB, ['cusco']],
    [VERA, ['cusco']],
  ])('vms has the live VMs that %s can use', async (user, names) => {
    expect((await list(user)).vms).toEqual(names.map((name) => ({ name, state: 'running', project_id: null })))
  })

  it('lists the people, for every role', async () => {
    for (const user of [ANN, LUIS, VERA, ANA, BOB]) {
      expect((await list(user)).people, user).toEqual([
        { user_id: ANA, name: 'ana' },
        { user_id: ANN, name: 'ann' },
        { user_id: BOB, name: 'bob' },
        { user_id: LUIS, name: 'luis' },
        { user_id: VERA, name: 'vera' },
      ])
    }
  })

  it('the people list has no agent, no VM sender, no bot, and no member who left', async () => {
    api.fake.joinSpace('@s-meow:example.org')
    api.fake.joinSpace('@gone:example.org')
    api.fake.setMember(api.fake.spaceId, '@gone:example.org', 'leave')
    const ids = (await list(LUIS)).people.map((p) => p.user_id)
    for (const id of [
      '@lima:example.org',
      '@lima.reviewer:example.org',
      '@s-meow:example.org',
      '@zooid:example.org',
      '@gone:example.org',
    ]) {
      expect(ids).not.toContain(id)
    }
  })

  it('passes a control plane failure on as 502', async () => {
    api.controlPlane.on('GET', '/v1/vms', jsonResponse(502, { error: 'ec2 failed' }))
    const vmsDown = await as(ANA, 'GET', '/agents')
    expect([vmsDown.status, await vmsDown.json()]).toEqual([502, { error: 'ec2 failed' }])
    api.controlPlane.on('GET', '/v1/vms', jsonResponse(200, vms))
    api.controlPlane.on('GET', '/v1/agents', jsonResponse(500, { error: 'database is locked' }))
    const recordsDown = await as(ANA, 'GET', '/agents')
    expect([recordsDown.status, await recordsDown.json()]).toEqual([
      502,
      { error: 'control plane sent an invalid response' },
    ])
  })
})

it('a project list failure on any agent route is a 502', async () => {
  api.controlPlane.on('GET', '/v1/projects', jsonResponse(500, { error: 'database is locked' }))
  const invalid = [502, { error: 'control plane sent an invalid response' }]
  for (const [method, path, json] of [
    ['GET', '/agents'],
    ['POST', '/agents', { name: 'scout', model: 'glm-5-3' }],
    ['PUT', '/agents/a1', { description: 'x' }],
    ['DELETE', '/agents/p1'],
  ] as const) {
    const res = await as(ANA, method, path, json)
    expect([res.status, await res.json()], `${method} ${path}`).toEqual(invalid)
  }
  expect(writes()).toEqual([])
})

describe('POST /agents', () => {
  it('creates a profile that the caller owns', async () => {
    const res = await as(ANA, 'POST', '/agents', {
      name: 'scout',
      model: 'glm-5-3',
      description: 'Find bugs.',
      tag: 'Scout',
      project: '',
    })
    expect(res.status).toBe(201)
    const view = await res.json()
    expect(view).toMatchObject({ name: 'scout', owner: ANA, agent_id: null, vm: null, tag: 'Scout', project: null })
    // The control plane refuses a field it does not name and a tag of "": the body holds only what is set.
    expect(writes().map((r) => [r.method, r.path, r.body])).toEqual([
      ['POST', '/v1/agents', { name: 'scout', owner: ANA, model: 'glm-5-3', description: 'Find bugs.', tag: 'Scout' }],
    ])
    expect(recordOf(view.id)).toMatchObject({ owner: ANA, vm: null })
  })

  it('refuses a model that is not on the list', async () => {
    const res = await as(ANA, 'POST', '/agents', { name: 'scout', model: 'gpt-0' })
    expect([res.status, await res.json()]).toEqual([400, { error: 'model is not on the Haven model list' }])
    expect(writes()).toEqual([])
  })

  it.each([
    ['an uppercase name', { name: 'Reviewer' }],
    ['no name', { name: undefined }],
    ['no model', { model: undefined }],
    ['a model with a space', { model: 'glm 5' }],
    ['a tag of 201 characters', { tag: 'x'.repeat(201) }],
    ['a description of 16385 bytes', { description: 'é'.repeat(8192) + 'x' }],
    ['a description that is not a string', { description: 5 }],
    ['a vm outside the name rule', { vm: '../lima' }],
  ])('refuses %s', async (_case, over) => {
    const res = await as(ANA, 'POST', '/agents', { name: 'scout', model: 'glm-5-3', ...over })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: expect.any(String) })
    expect(writes()).toEqual([])
  })

  it('accepts a description of 16384 bytes and a tag of 200 characters', async () => {
    const res = await as(ANA, 'POST', '/agents', {
      name: 'scout',
      model: 'glm-5-3',
      description: 'é'.repeat(8192),
      tag: 'é'.repeat(200),
    })
    expect(res.status).toBe(201)
  })

  it('with vm, admits the agent and writes the record with vm and rooms', async () => {
    // An agents-manager who owns an agent on lima.
    const res = await as(ANA, 'POST', '/agents', { name: 'scout', model: 'glm-5-3', vm: 'lima' })
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ agent_id: '@lima.scout:example.org', vm: { name: 'lima', owner: LUIS } })
    expect(writes().map((r) => r.body)).toEqual([
      { name: 'scout', owner: ANA, model: 'glm-5-3', vm: 'lima', rooms: ['#general:example.org'] },
    ])
    expect(api.fake.userExists('@lima.scout:example.org')).toBe(true)
    expect(api.fake.membership(api.fake.generalRoomId, '@lima.scout:example.org')).toBe('join')
    expect(rosterNames('lima')).toEqual(['reviewer', 'scout', 'tester'])
  })

  it('with vm, refuses a caller who cannot use the VM', async () => {
    const res = await as(BOB, 'POST', '/agents', { name: 'scout', model: 'glm-5-3', vm: 'lima' })
    expect([res.status, await res.json()]).toEqual([403, { error: 'forbidden' }])
    expect(api.fake.userExists('@lima.scout:example.org')).toBe(false)
    expect(writes()).toEqual([])
  })

  it('with vm, refuses a name in use and an unknown VM', async () => {
    const taken = await as(LUIS, 'POST', '/agents', { name: 'reviewer', model: 'glm-5-3', vm: 'lima' })
    expect([taken.status, await taken.json()]).toEqual([409, { error: 'name in use' }])
    // quito has records and no live VM.
    for (const vm of ['nope', 'quito']) {
      const unknown = await as(ANN, 'POST', '/agents', { name: 'scout', model: 'glm-5-3', vm })
      expect([unknown.status, await unknown.json()], vm).toEqual([404, { error: 'vm not found' }])
    }
    expect(writes()).toEqual([])
  })

  it('a name of another VM or of an instance agent is free', async () => {
    const res = await as(ANN, 'POST', '/agents', { name: 'builder', model: 'glm-5-3', vm: 'lima' })
    expect(res.status).toBe(201)
    const instance = await as(ANN, 'POST', '/agents', { name: 's-meow', model: 'glm-5-3', vm: 'lima' })
    expect(instance.status).toBe(201)
  })
})

describe('PUT /agents/:id', () => {
  it('changes the description for the agent owner', async () => {
    const res = await as(ANA, 'PUT', '/agents/a1', { description: 'Review the tests too.' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ id: 'a1', description: 'Review the tests too.' })
    expect(writes().map((r) => [r.method, r.path, r.body])).toEqual([
      ['PUT', '/v1/agents/a1', { description: 'Review the tests too.' }],
    ])
  })

  it('a change of the tag rebuilds the roster', async () => {
    const res = await as(ANA, 'PUT', '/agents/a1', { tag: 'Lead' })
    expect(res.status).toBe(200)
    expect(writes().map((r) => r.body)).toEqual([{ tag: 'Lead' }])
    expect(roster('lima')).toMatchObject({ agents: [{ name: 'reviewer', persona: 'Lead' }, { name: 'tester' }] })
    expect((roster('lima') as { agents: object[] }).agents[0]).not.toHaveProperty('project')
  })

  // Review Focus 3: the model is checked only when it changes.
  it('a change of only the tag works while the Haven list is down', async () => {
    api.haven.up = false
    const res = await as(ANA, 'PUT', '/agents/a1', { tag: 'Lead' })
    expect(res.status).toBe(200)
    expect(recordOf('a1')?.tag).toBe('Lead')
  })

  it('the same model is not checked again', async () => {
    api.haven.up = false
    expect((await as(ANA, 'PUT', '/agents/a1', { model: 'glm-5-3' })).status).toBe(200)
    const changed = await as(ANA, 'PUT', '/agents/a1', { model: 'kimi-k2' })
    expect([changed.status, await changed.json()]).toEqual([502, { error: 'the Haven model list does not answer' }])
    api.haven.up = true
    const refused = await as(ANA, 'PUT', '/agents/a1', { model: 'kimi-k2' })
    expect([refused.status, await refused.json()]).toEqual([400, { error: 'model is not on the Haven model list' }])
  })

  it('refuses an agent that the caller sees and may not change', async () => {
    const res = await as(LUIS, 'PUT', '/agents/p1', { description: 'x' })
    expect([res.status, await res.json()]).toEqual([403, { error: 'forbidden' }])
    expect(writes()).toEqual([])
  })

  it('answers 404 for an agent that the caller does not see', async () => {
    const res = await as(ANA, 'PUT', '/agents/p2', { description: 'x' })
    expect([res.status, await res.json()]).toEqual([404, { error: 'not found' }])
    expect((await as(ANA, 'PUT', '/agents/nope', { description: 'x' })).status).toBe(404)
  })

  it('only the VM owner or an admin changes the owner', async () => {
    expect((await as(ANA, 'PUT', '/agents/a1', { owner: BOB })).status).toBe(403)
    const res = await as(LUIS, 'PUT', '/agents/a1', { owner: BOB })
    expect(res.status).toBe(200)
    expect(recordOf('a1')?.owner).toBe(BOB)
  })

  it('the new owner must be a joined member of the space', async () => {
    api.fake.joinSpace('@gone:example.org', 40)
    api.fake.setMember(api.fake.spaceId, '@gone:example.org', 'leave')
    api.fake.addUser('@ana:other.org')
    for (const owner of ['@gone:example.org', '@ana:other.org', 'ana', 5]) {
      const res = await as(LUIS, 'PUT', '/agents/a1', { owner })
      expect([res.status, await res.json()], String(owner)).toEqual([
        400,
        { error: 'owner must be a member of the workspace' },
      ])
    }
    expect(writes()).toEqual([])
  })

  it('refuses an owner who is an agent', async () => {
    api.fake.joinSpace('@s-meow:example.org')
    for (const owner of ['@lima:example.org', '@lima.reviewer:example.org', '@s-meow:example.org', '@zooid:example.org']) {
      const res = await as(LUIS, 'PUT', '/agents/a1', { owner })
      expect([res.status, await res.json()], owner).toEqual([400, { error: 'owner must be a person' }])
    }
    expect(writes()).toEqual([])
  })

  it('answers 502 on GET /agents and on an owner write when the homeserver fails', async () => {
    const down = [502, { error: 'homeserver unreachable' }]
    api.fake.failOnce('GET', /\/state$/, 500)
    const listed = await as(LUIS, 'GET', '/agents')
    expect([listed.status, await listed.json()]).toEqual(down)
    api.fake.failOnce('GET', /\/state$/, 500)
    const changed = await as(LUIS, 'PUT', '/agents/a1', { owner: BOB })
    expect([changed.status, await changed.json()]).toEqual(down)
    expect(writes()).toEqual([])
  })

  it('assigns a profile to a VM that the caller can use', async () => {
    const res = await as(ANA, 'PUT', '/agents/p1', { vm: 'lima' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ agent_id: '@lima.draft:example.org', vm: { name: 'lima' } })
    expect(writes().map((r) => r.body)).toEqual([{ vm: 'lima', rooms: ['#general:example.org'] }])
    expect(api.fake.membership(api.fake.spaceId, '@lima.draft:example.org')).toBe('join')
    expect(rosterNames('lima')).toEqual(['draft', 'reviewer', 'tester'])
  })

  it('an assign that fails at a Matrix step leaves the profile', async () => {
    api.fake.failOnce('POST', /\/join\//, 500)
    const res = await as(ANA, 'PUT', '/agents/p1', { vm: 'lima', description: 'x' })
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ step: 'join' })
    expect(recordOf('p1')).toMatchObject({ vm: null, description: '' })
    // The same request again finishes it.
    expect((await as(ANA, 'PUT', '/agents/p1', { vm: 'lima', description: 'x' })).status).toBe(200)
    expect(recordOf('p1')).toMatchObject({ vm: 'lima', description: 'x' })
  })

  it('an assign that fails at the record step names it', async () => {
    api.controlPlane.on('PUT', /^\/v1\/agents\//, jsonResponse(500, { error: 'database is locked' }))
    const res = await as(ANA, 'PUT', '/agents/p1', { vm: 'lima' })
    expect([res.status, await res.json()]).toEqual([
      502,
      { error: 'control plane sent an invalid response', step: 'record' },
    ])
  })

  it('refuses a second VM, a VM that the caller cannot use, and a name in use', async () => {
    const again = await as(ANA, 'PUT', '/agents/a1', { vm: 'cusco' })
    expect([again.status, await again.json()]).toEqual([409, { error: 'vm already set' }])
    const other = await as(ANA, 'PUT', '/agents/p1', { vm: 'cusco' })
    expect([other.status, await other.json()]).toEqual([403, { error: 'forbidden' }])
    await place('p3', 'reviewer', null, ANA)
    const taken = await as(ANA, 'PUT', '/agents/p3', { vm: 'lima' })
    expect([taken.status, await taken.json()]).toEqual([409, { error: 'name in use' }])
    expect(writes()).toEqual([])
  })

  it('a write to an instance agent is 404', async () => {
    expect((await as(ANN, 'PUT', '/agents/instance:s-meow', { tag: 'x' })).status).toBe(404)
    expect((await as(ANN, 'DELETE', '/agents/instance:s-meow')).status).toBe(404)
  })
})

describe('DELETE /agents/:id', () => {
  it('deletes a profile with one control plane call and no Matrix call', async () => {
    const before = api.fake.calls.length
    const res = await as(ANA, 'DELETE', '/agents/p1')
    expect(res.status).toBe(204)
    expect(writes().map((r) => [r.method, r.path])).toEqual([['DELETE', '/v1/agents/p1']])
    // Only the reads of the role check.
    expect(api.fake.calls.slice(before).filter((c) => !/m\.room\.(member|power_levels|create)|openid/.test(c.path))).toEqual([])
  })

  it('deletes one agent of a VM and keeps the VM', async () => {
    const res = await as(LUIS, 'DELETE', '/agents/a2')
    expect(res.status).toBe(204)
    expect(api.fake.membership(api.fake.generalRoomId, '@lima.tester:example.org')).toBe('leave')
    expect(api.fake.membership(api.fake.spaceId, '@lima.tester:example.org')).toBe('leave')
    expect(writes().map((r) => [r.method, r.path])).toEqual([['DELETE', '/v1/agents/a2']])
    expect(adminMessages().filter((m) => m.includes('unregister'))).toEqual([])
    expect(existsSync(bundleOf('lima'))).toBe(true)
    expect(rosterNames('lima')).toEqual(['reviewer'])
  })

  it('needs ?vm=1 for the last agent of a live VM', async () => {
    const res = await as(VERA, 'DELETE', '/agents/a3')
    expect([res.status, await res.json()]).toEqual([409, { error: 'last agent of the vm' }])
    expect(writes()).toEqual([])
    expect(api.fake.membership(api.fake.spaceId, '@cusco.builder:example.org')).toBe('join')
  })

  it('with ?vm=1, deletes the VM, the registration, the bundle, and the record', async () => {
    const order: string[] = []
    const agentId = '@cusco.builder:example.org'
    api.controlPlane.on('DELETE', `/v1/vms/${CUSCO.id}`, () => {
      // leave is done, unregister is not.
      const unregistered = adminMessages().some((m) => m.includes('unregister'))
      order.push(`vm left=${api.fake.membership(api.fake.spaceId, agentId)} unregistered=${unregistered}`)
      return new Response(null, { status: 202 })
    })
    api.controlPlane.on('DELETE', '/v1/agents/a3', () => {
      order.push(`record bundle=${existsSync(bundleOf('cusco'))}`)
      store.records.splice(store.records.indexOf(recordOf('a3')!), 1)
      return new Response(null, { status: 204 })
    })
    const res = await as(VERA, 'DELETE', '/agents/a3?vm=1')
    expect(res.status).toBe(204)
    expect(order).toEqual(['vm left=leave unregistered=false', 'record bundle=false'])
    expect(adminMessages().at(-1)).toBe('!admin appservices unregister cusco')
    expect(api.fake.membership(api.fake.spaceId, '@cusco:example.org')).toBe('leave')
    expect(roster('cusco')).toEqual({ version: 1, agents: [] })
  })

  it('the agent owner cannot delete the last agent of a live VM', async () => {
    const res = await as(BOB, 'DELETE', '/agents/a3?vm=1')
    expect([res.status, await res.json()]).toEqual([403, { error: 'forbidden' }])
    expect(writes()).toEqual([])
  })

  it('the agent owner deletes the last agent of a VM that is gone', async () => {
    const res = await as(BOB, 'DELETE', '/agents/a4')
    expect(res.status).toBe(204)
    expect(adminMessages().at(-1)).toBe('!admin appservices unregister quito')
    expect(existsSync(bundleOf('quito'))).toBe(false)
    expect(writes().map((r) => [r.method, r.path])).toEqual([['DELETE', '/v1/agents/a4']])
  })

  it('a failure before the record step keeps the record', async () => {
    api.fake.knobs.adminCommandWorks = false
    const res = await as(VERA, 'DELETE', '/agents/a3?vm=1')
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ step: 'unregister' })
    expect(recordOf('a3')).toBeDefined()
    expect((await list(ANN)).agents.map((a) => a.id)).toContain('a3')
  })

  // Review Focus 4: a delete of the last agent that runs again after it failed halfway.
  describe('a second delete after a failure ends with 204', () => {
    it('when the VM is terminated already', async () => {
      api.fake.knobs.adminCommandWorks = false
      expect((await as(VERA, 'DELETE', '/agents/a3?vm=1')).status).toBe(502)
      // The VM is going: the list shows it shutting down, and the control plane answers 404 to a delete.
      vms = [LIMA, { ...CUSCO, state: 'shutting-down' }]
      api.controlPlane.on('DELETE', `/v1/vms/${CUSCO.id}`, jsonResponse(404, { error: 'not found' }))
      api.fake.knobs.adminCommandWorks = true
      // Without a live VM, the agent owner deletes it.
      const res = await as(BOB, 'DELETE', '/agents/a3')
      expect(res.status).toBe(204)
      expect(recordOf('a3')).toBeUndefined()
      expect(existsSync(bundleOf('cusco'))).toBe(false)
      expect(writes().filter((r) => r.path.startsWith('/v1/vms/'))).toHaveLength(1)
    })

    it('when the control plane still lists the VM and answers 404 to its delete', async () => {
      api.fake.knobs.adminCommandWorks = false
      expect((await as(VERA, 'DELETE', '/agents/a3?vm=1')).status).toBe(502)
      api.controlPlane.on('DELETE', `/v1/vms/${CUSCO.id}`, jsonResponse(404, { error: 'not found' }))
      api.fake.knobs.adminCommandWorks = true
      expect((await as(VERA, 'DELETE', '/agents/a3?vm=1')).status).toBe(204)
      expect(recordOf('a3')).toBeUndefined()
    })

    it('when the appservice is unregistered already', async () => {
      api.controlPlane.on('DELETE', '/v1/agents/a3', jsonResponse(500, { error: 'database is locked' }))
      const failed = await as(VERA, 'DELETE', '/agents/a3?vm=1')
      expect([failed.status, await failed.json()]).toEqual([
        502,
        { error: 'control plane sent an invalid response', step: 'record' },
      ])
      expect(existsSync(bundleOf('cusco'))).toBe(false)
      vms = [LIMA, { ...CUSCO, state: 'shutting-down' }]
      api.controlPlane.on('DELETE', '/v1/agents/a3', () => {
        store.records.splice(store.records.indexOf(recordOf('a3')!), 1)
        return new Response(null, { status: 204 })
      })
      const res = await as(BOB, 'DELETE', '/agents/a3')
      expect(res.status).toBe(204)
      expect(adminMessages().filter((m) => m.includes('unregister'))).toHaveLength(1)
    })
  })

  it('a roster failure does not fail the delete', async () => {
    const warn = vi.mocked(console.warn)
    api.fake.failOnce('PUT', /\/state\/dev\.zooid\.workforce\/lima$/, 500)
    const res = await as(LUIS, 'DELETE', '/agents/a2')
    expect(res.status).toBe(204)
    expect(recordOf('a2')).toBeUndefined()
    expect(JSON.stringify(warn.mock.calls)).toContain('the roster of lima was not rebuilt')
  })
})

// The fixture of the project writes: hub is a project VM of PR1, @gone left the workspace.
const PR1 = '1'.repeat(32)
const PR2 = '2'.repeat(32)
const UNKNOWN = 'f'.repeat(32)
const GONE = '@gone:example.org'
const HUB = {
  id: 'i-0b0b0b0b0b0b0b0b0',
  name: 'hub',
  state: 'running',
  creator: LUIS,
  launched_at: '2026-11-18T19:00:00Z',
  project_id: PR1,
}
const project = (id: string, name: string): Project => ({
  id,
  name,
  created_at: '2026-11-19T19:00:00Z',
  updated_at: '2026-11-19T19:00:00Z',
})

describe('with projects', () => {
  beforeEach(async () => {
    projects.push(project(PR1, 'Payments'), project(PR2, 'Billing'))
    fakeProjectStore(api.controlPlane, projects, { records: store.records, vms })
    vms.push(HUB)
    api.fake.joinSpace(GONE, 40)
    api.fake.setMember(api.fake.spaceId, GONE, 'leave')
    // A project profile, a project agent on hub whose stored owner left, and a personal agent on hub.
    await place('q1', 'planner', null, ANA, { project_id: PR1 })
    await place('q2', 'auditor', 'hub', GONE, { project_id: PR1 })
    await place('q3', 'notes', 'hub', VERA)
  })

  describe('GET /agents', () => {
    it('gives a project agent every field of the contract example', async () => {
      expect(await viewOf(ANA, 'q2')).toEqual({
        id: 'q2',
        name: 'auditor',
        agent_id: '@hub.auditor:example.org',
        owner: GONE,
        description: '',
        model: 'glm-5-3',
        tag: null,
        project_id: PR1,
        project: 'Payments',
        vm: { name: 'hub', id: HUB.id, state: 'running', owner: LUIS, project_id: PR1 },
        source: 'control-plane',
        can: {
          edit: true,
          set_owner: false,
          set_project: false,
          assign: false,
          create_vm: false,
          delete: true,
          delete_needs_vm: false,
        },
      })
    })

    it('a personal agent has project_id null, project null, vm.project_id null', async () => {
      expect(await viewOf(VERA, 'q3')).toMatchObject({
        project_id: null,
        project: null,
        vm: { name: 'hub', project_id: PR1 },
      })
      expect(await viewOf(ANA, 'a1')).toMatchObject({ project_id: null, project: null, vm: { project_id: null } })
    })

    it('the text label of phase 1 is not shown', async () => {
      await place('q4', 'scribe', null, ANA, { project: 'Old' })
      expect(await viewOf(ANA, 'q4')).toMatchObject({ project_id: null, project: null })
    })

    it('a project_id that no project has gives project null', async () => {
      await place('q4', 'scribe', null, ANA, { project_id: UNKNOWN })
      expect(await viewOf(ANA, 'q4')).toMatchObject({ project_id: UNKNOWN, project: null })
    })

    it('an agent whose VM is gone has vm {name} only', async () => {
      await place('q4', 'scribe', 'quito', ANA, { project_id: PR1 })
      expect((await viewOf(ANA, 'q4'))?.vm).toEqual({ name: 'quito' })
    })

    it('an instance agent has project_id null and every can false', async () => {
      expect((await list(ANN)).agents.at(-1)).toMatchObject({
        source: 'instance',
        project_id: null,
        project: null,
        can: { set_project: false, edit: false },
      })
    })

    it('vms has project_id for each live VM that the caller can use', async () => {
      expect((await list(ANA)).vms).toEqual([
        { name: 'hub', state: 'running', project_id: PR1 },
        { name: 'lima', state: 'running', project_id: null },
      ])
    })

    it('can.set_project follows the policy', async () => {
      const setProject = async (user: string, id: string) =>
        ((await viewOf(user, id)) as unknown as { can: { set_project: boolean } }).can.set_project
      expect(await setProject(ANA, 'a1')).toBe(true)
      expect(await setProject(LUIS, 'a1')).toBe(false)
      expect(await setProject(ANA, 'q1')).toBe(false)
      expect(await setProject(ANN, 'q1')).toBe(true)
    })

    it('still gives people', async () => {
      expect((await list(BOB)).people.map((p) => p.user_id)).toEqual([ANA, ANN, BOB, LUIS, VERA])
    })
  })

  describe('POST /agents with projects', () => {
    it('creates a project agent for a caller of every role', async () => {
      for (const user of [ANN, LUIS, ANA]) {
        const res = await as(user, 'POST', '/agents', { name: 'scout', model: 'glm-5-3', project_id: PR1 })
        expect(res.status, user).toBe(201)
        expect(await res.json(), user).toMatchObject({ project_id: PR1, project: 'Payments', owner: user })
      }
    })

    it('sends project_id and never project', async () => {
      const res = await as(ANA, 'POST', '/agents', { name: 'scout', model: 'glm-5-3', project: 'Old', project_id: PR1 })
      expect(res.status).toBe(201)
      expect(writes().map((r) => r.body)).toEqual([{ name: 'scout', owner: ANA, model: 'glm-5-3', project_id: PR1 }])
    })

    it('a non-string project_id is 400, null and "" give a personal agent', async () => {
      for (const projectId of [5, true, {}, [PR1]]) {
        const res = await as(ANA, 'POST', '/agents', { name: 'scout', model: 'glm-5-3', project_id: projectId })
        expect([res.status, await res.json()]).toEqual([400, { error: 'project_id must be a string' }])
      }
      expect(writes()).toEqual([])
      for (const projectId of [null, '']) {
        const res = await as(ANA, 'POST', '/agents', { name: 'scout', model: 'glm-5-3', project_id: projectId })
        expect(res.status).toBe(201)
        expect(await res.json()).toMatchObject({ project_id: null, project: null })
      }
      // The control plane reads "" in a POST as an unknown project: zooid leaves the field out.
      expect(writes().map((r) => r.body)).toEqual([
        { name: 'scout', owner: ANA, model: 'glm-5-3' },
        { name: 'scout', owner: ANA, model: 'glm-5-3' },
      ])
    })

    it('an unknown project_id is 400 before any Matrix step', async () => {
      const before = adminMessages().length
      const res = await as(ANA, 'POST', '/agents', { name: 'scout', model: 'glm-5-3', vm: 'hub', project_id: UNKNOWN })
      expect([res.status, await res.json()]).toEqual([400, { error: 'unknown project' }])
      expect(adminMessages()).toHaveLength(before)
      expect(api.fake.userExists('@hub.scout:example.org')).toBe(false)
      expect(writes()).toEqual([])
    })

    it('with vm, refuses a personal VM for a project agent', async () => {
      const res = await as(ANA, 'POST', '/agents', { name: 'scout', model: 'glm-5-3', vm: 'lima', project_id: PR1 })
      expect([res.status, await res.json()]).toEqual([409, { error: 'a project agent needs a project vm' }])
      expect(api.fake.userExists('@lima.scout:example.org')).toBe(false)
      expect(writes()).toEqual([])
    })

    it('with vm, puts a project agent on a project VM', async () => {
      const res = await as(ANA, 'POST', '/agents', { name: 'scout', model: 'glm-5-3', vm: 'hub', project_id: PR1 })
      expect(res.status).toBe(201)
      expect(await res.json()).toMatchObject({ agent_id: '@hub.scout:example.org', vm: { name: 'hub', project_id: PR1 } })
      expect(roster('hub')).toMatchObject({ agents: expect.arrayContaining([expect.objectContaining({ name: 'scout', project: 'Payments' })]) })
    })
  })

  describe('PUT /agents/:id with projects', () => {
    const needsProjectVm = { error: 'a project agent needs a project vm' }
    const noOwner = { error: 'a project agent has no owner' }
    it.each([
      // caller, agent, body, status, answer, the body that the control plane got (null: no write)
      [ANA, 'p1', { project_id: PR1 }, 200, { project_id: PR1, project: 'Payments' }, { project_id: PR1 }],
      // set_project is false for a non-owner.
      [LUIS, 'p1', { project_id: PR1 }, 403, { error: 'forbidden' }, null],
      // a1 is on the personal VM lima. The rule holds for an admin too.
      [ANA, 'a1', { project_id: PR1 }, 409, needsProjectVm, null],
      [ANN, 'a1', { project_id: PR1 }, 409, needsProjectVm, null],
      // a4 has a vm and no live VM: allowed.
      [BOB, 'a4', { project_id: PR1 }, 200, { project_id: PR1 }, { project_id: PR1 }],
      [ANN, 'q2', { project_id: PR2 }, 200, { project_id: PR2, project: 'Billing' }, { project_id: PR2 }],
      // Only an admin moves.
      [ANA, 'q1', { project_id: PR2 }, 403, { error: 'forbidden' }, null],
      // The stored project_id is not a change (D1).
      [ANA, 'q1', { description: 'x', project_id: PR1 }, 200, { description: 'x' }, { description: 'x' }],
      [ANN, 'q1', { owner: BOB }, 400, noOwner, null],
      [ANN, 'p1', { project_id: PR1, owner: BOB }, 400, noOwner, null],
      [ANN, 'p1', { project_id: UNKNOWN }, 400, { error: 'unknown project' }, null],
      // D2: "" for a personal agent changes nothing.
      [ANA, 'p1', { project_id: '' }, 200, { project_id: null }, null],
    ] as const)('%s on %s with %j is %i', async (user, id, body, status, answer, sent) => {
      const res = await as(user, 'PUT', `/agents/${id}`, body)
      expect([res.status, await res.json()]).toEqual([status, expect.objectContaining(answer)])
      expect(writes().map((r) => r.body)).toEqual(sent === null ? [] : [sent])
    })

    it('a non-string project_id is 400', async () => {
      const res = await as(ANA, 'PUT', '/agents/p1', { project_id: 5 })
      expect([res.status, await res.json()]).toEqual([400, { error: 'project_id must be a string' }])
      expect((await as(ANA, 'PUT', '/agents/p1', { project_id: null, description: 'x' })).status).toBe(200)
      expect(writes().map((r) => r.body)).toEqual([{ description: 'x' }])
    })

    it('a project the control plane no longer has is 400 even when the list is stale', async () => {
      api.controlPlane.on('PUT', /^\/v1\/agents\//, jsonResponse(400, { error: 'unknown project' }))
      const res = await as(ANA, 'PUT', '/agents/p1', { project_id: PR1 })
      expect([res.status, await res.json()]).toEqual([400, { error: 'unknown project' }])
      expect(recordOf('p1')?.project_id).toBeNull()
    })

    it('leaves a project without owner when the stored owner is a person', async () => {
      const res = await as(ANN, 'PUT', '/agents/q1', { project_id: '' })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ project_id: null, project: null, owner: ANA })
      expect(writes().map((r) => r.body)).toEqual([{ project_id: '' }])
      expect(recordOf('q1')).toMatchObject({ project_id: null, owner: ANA })
    })

    it('leaves a project with an owner', async () => {
      const res = await as(ANN, 'PUT', '/agents/q1', { project_id: '', owner: BOB })
      expect(res.status).toBe(200)
      expect(writes().map((r) => r.body)).toEqual([{ project_id: '', owner: BOB }])
      expect(recordOf('q1')).toMatchObject({ project_id: null, owner: BOB })
    })

    it('leave: a stored owner who left the workspace is 400, and nothing changes', async () => {
      const res = await as(ANN, 'PUT', '/agents/q2', { project_id: '' })
      expect([res.status, await res.json()]).toEqual([400, { error: 'owner must be a member of the workspace' }])
      expect(writes()).toEqual([])
      const withOwner = await as(ANN, 'PUT', '/agents/q2', { project_id: '', owner: BOB })
      expect(withOwner.status).toBe(200)
      expect(recordOf('q2')).toMatchObject({ project_id: null, owner: BOB })
    })

    it('only an admin takes an agent out of a project', async () => {
      for (const user of [LUIS, ANA]) {
        const res = await as(user, 'PUT', '/agents/q1', { project_id: '' })
        expect([res.status, await res.json()], user).toEqual([403, { error: 'forbidden' }])
      }
      expect(writes()).toEqual([])
    })

    it('vm and project_id together: a project VM works, a personal VM is 409', async () => {
      const refused = await as(ANA, 'PUT', '/agents/p1', { project_id: PR1, vm: 'lima' })
      expect([refused.status, await refused.json()]).toEqual([409, needsProjectVm])
      expect(api.fake.userExists('@lima.draft:example.org')).toBe(false)
      expect(recordOf('p1')).toMatchObject({ vm: null, project_id: null })
      const res = await as(ANA, 'PUT', '/agents/p1', { project_id: PR1, vm: 'hub' })
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ agent_id: '@hub.draft:example.org', project_id: PR1 })
      expect(writes().map((r) => r.body)).toEqual([{ project_id: PR1, vm: 'hub', rooms: ['#general:example.org'] }])
      expect(roster('hub')).toMatchObject({
        agents: expect.arrayContaining([expect.objectContaining({ name: 'draft', project: 'Payments' })]),
      })
    })

    it('assigns a project profile only to a project VM', async () => {
      // @ana owns a1 on lima, so she can use lima.
      const refused = await as(ANA, 'PUT', '/agents/q1', { vm: 'lima' })
      expect([refused.status, await refused.json()]).toEqual([409, needsProjectVm])
      expect(api.fake.userExists('@lima.planner:example.org')).toBe(false)
      expect((await as(ANA, 'PUT', '/agents/q1', { vm: 'hub' })).status).toBe(200)
      expect(recordOf('q1')).toMatchObject({ vm: 'hub', project_id: PR1 })
    })

    it('a project profile on a VM that the caller cannot use is 403, not 409', async () => {
      const res = await as(ANA, 'PUT', '/agents/q1', { vm: 'cusco' })
      expect([res.status, await res.json()]).toEqual([403, { error: 'forbidden' }])
    })

    it('a name in use wins over the project VM rule', async () => {
      await place('q5', 'reviewer', null, ANA, { project_id: PR1 })
      const res = await as(ANA, 'PUT', '/agents/q5', { vm: 'lima' })
      expect([res.status, await res.json()]).toEqual([409, { error: 'name in use' }])
    })

    it('a vm-creator changes the owner of a personal agent on a project VM', async () => {
      const res = await as(LUIS, 'PUT', '/agents/q3', { owner: BOB })
      expect(res.status).toBe(200)
      expect(recordOf('q3')?.owner).toBe(BOB)
    })

    it('the stored owner is not a change', async () => {
      // A project agent: without D1, owner would be "a project agent has no owner".
      expect((await as(ANN, 'PUT', '/agents/q1', { owner: ANA, tag: 'Plan' })).status).toBe(200)
      // A caller without set_owner who sends the stored owner again.
      expect((await as(ANA, 'PUT', '/agents/a1', { owner: ANA, tag: 'Lead' })).status).toBe(200)
      expect(writes().map((r) => r.body)).toEqual([{ tag: 'Plan' }, { tag: 'Lead' }])
    })

    it('a text project in the body is dropped', async () => {
      expect((await as(ANA, 'PUT', '/agents/a1', { description: 'x', project: 'Old' })).status).toBe(200)
      expect(writes().map((r) => r.body)).toEqual([{ description: 'x' }])
    })

    it('the roster of the VM is rebuilt after a change of project_id', async () => {
      expect((await as(ANN, 'PUT', '/agents/q2', { project_id: PR2 })).status).toBe(200)
      expect(roster('hub')).toMatchObject({
        agents: expect.arrayContaining([expect.objectContaining({ name: 'auditor', project: 'Billing' })]),
      })
    })
  })

  describe('DELETE /agents/:id with projects', () => {
    it('an agents-manager deletes a project agent that is not the last of its VM', async () => {
      expect((await as(ANA, 'DELETE', '/agents/q2')).status).toBe(204)
      expect(recordOf('q2')).toBeUndefined()
    })

    it('only who manages the project VM deletes its last agent', async () => {
      expect((await as(ANN, 'DELETE', '/agents/q3')).status).toBe(204)
      const refused = await as(ANA, 'DELETE', '/agents/q2?vm=1')
      expect([refused.status, await refused.json()]).toEqual([403, { error: 'forbidden' }])
      expect(writes().filter((r) => r.path.startsWith('/v1/vms/'))).toEqual([])
      expect((await as(VERA, 'DELETE', '/agents/q2?vm=1')).status).toBe(204)
      expect(writes().map((r) => [r.method, r.path])).toContainEqual(['DELETE', `/v1/vms/${HUB.id}`])
      expect(recordOf('q2')).toBeUndefined()
    })
  })
})

describe('GET /models', () => {
  it('gives the list and the default', async () => {
    const res = await as(ANA, 'GET', '/models')
    expect([res.status, await res.json()]).toEqual([200, { models: [{ id: 'glm-5-3' }], default: 'glm-5-3' }])
  })

  it('default is null when FABRIUM_HAVEN_MODEL is not on the list', async () => {
    api.haven.models = [{ id: 'kimi-k2' }]
    expect(await (await as(ANA, 'GET', '/models')).json()).toEqual({ models: [{ id: 'kimi-k2' }], default: null })
  })

  it('answers 502 when the Haven list does not answer', async () => {
    api.haven.up = false
    const res = await as(ANA, 'GET', '/models')
    expect([res.status, await res.json()]).toEqual([502, { error: 'the Haven model list does not answer' }])
  })
})
