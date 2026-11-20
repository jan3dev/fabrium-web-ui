import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentRecord } from './agent-records.js'
import { ensureVmBundle } from './bundle.js'
import type { Project } from './project-records.js'
import { createRoster } from './roster.js'
import { createTestApi, fakeAgentStore, fakeProjectStore, jsonResponse } from './test-api.js'

const PAYMENTS: Project = {
  id: '9a1c0e2b4c6d8a0f5f0c2d7a9b3e4c1d',
  name: 'Payments',
  created_at: '2026-11-19T19:00:00Z',
  updated_at: '2026-11-19T19:00:00Z',
}

let api: ReturnType<typeof createTestApi>
beforeEach(() => {
  api = createTestApi()
})
afterEach(() => {
  api.cleanup()
  vi.restoreAllMocks()
})

const roster = () =>
  createRoster({
    conn: api.deps.conn,
    client: api.client,
    asToken: api.deps.asToken,
    asUserId: api.deps.asUserId,
    serverName: api.deps.serverName,
    getSpaceRoomId: api.deps.getSpaceRoomId,
    workstationsDir: api.workstationsDir,
  })
const record = (name: string, vm: string | null, over: Partial<AgentRecord> = {}): AgentRecord => ({
  id: `id-${name}-${vm}`,
  name,
  owner: '@ana:example.org',
  description: '',
  model: 'glm-5-3',
  tag: null,
  project: null,
  project_id: null,
  vm,
  rooms: vm ? ['#general:example.org'] : [],
  ...over,
})
const entry = (vm: string) => api.fake.state(api.fake.spaceId, 'dev.zooid.workforce', vm)
const rosterWrites = () =>
  api.fake.calls.filter((c) => c.method === 'PUT' && c.path.includes('/state/dev.zooid.workforce/')).length

it('builds the entry of a VM from its records, sorted by name', async () => {
  const records = [
    record('tester', 'lima'),
    record('reviewer', 'lima', { tag: 'Reviewer', project_id: PAYMENTS.id }),
    record('reviewer', 'cusco'),
    record('draft', null),
  ]
  await roster().rebuild('lima', records, [PAYMENTS])
  expect(entry('lima')).toEqual({
    version: 1,
    agents: [
      {
        user_id: '@lima.reviewer:example.org',
        name: 'reviewer',
        rooms: [api.fake.generalRoomId],
        persona: 'Reviewer',
        project: 'Payments',
      },
      { user_id: '@lima.tester:example.org', name: 'tester', rooms: [api.fake.generalRoomId] },
    ],
  })
  // The central daemon is the writer.
  expect(api.fake.calls.find((c) => c.method === 'PUT' && c.path.includes('/dev.zooid.workforce/lima'))?.path).toContain(
    `user_id=${encodeURIComponent('@zooid:example.org')}`,
  )
})

it('does not send an equal event', async () => {
  const r = roster()
  await r.rebuild('lima', [record('reviewer', 'lima')], [])
  const writes = rosterWrites()
  await r.rebuild('lima', [record('reviewer', 'lima')], [])
  expect(rosterWrites()).toBe(writes)
})

it('a VM name without records gets an empty list', async () => {
  await roster().rebuild('lima', [record('reviewer', 'cusco')], [])
  expect(entry('lima')).toEqual({ version: 1, agents: [] })
})

it('a room alias that does not resolve is left out of the entry', async () => {
  const rooms = ['#general:example.org', '#gone:example.org', '!direct:example.org']
  await roster().rebuild('lima', [record('reviewer', 'lima', { rooms })], [])
  expect((entry('lima') as { agents: { rooms: string[] }[] }).agents[0]?.rooms).toEqual([
    api.fake.generalRoomId,
    '!direct:example.org',
  ])
})

it('rebuildAll covers a bundle without records and a record without a bundle', async () => {
  await ensureVmBundle(join(api.workstationsDir, 'kilo'), {
    workstation: 'kilo',
    serverName: 'example.org',
    homeserverUrl: 'https://chat.example.org',
    space: 'dev',
  })
  await roster().rebuildAll([record('reviewer', 'lima'), record('draft', null)], [])
  expect(entry('kilo')).toEqual({ version: 1, agents: [] })
  expect(entry('lima')).toMatchObject({ agents: [{ name: 'reviewer' }] })
})

it('a failure for one VM name does not stop the next', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  api.fake.failOnce('PUT', /\/state\/dev\.zooid\.workforce\/cusco$/, 500)
  await roster().rebuildAll([record('reviewer', 'cusco'), record('reviewer', 'lima')], [])
  expect(entry('cusco')).toBeUndefined()
  expect(entry('lima')).toMatchObject({ agents: [{ name: 'reviewer' }] })
  expect(JSON.stringify(warn.mock.calls)).toContain('cusco')
})

it('rebuildRosters reads the records, and keeps every roster when the read fails', async () => {
  const store = fakeAgentStore(api.controlPlane)
  store.records.push(record('reviewer', 'lima'))
  await api.rebuildRosters()
  expect(entry('lima')).toMatchObject({ agents: [{ name: 'reviewer' }] })
  // A failed read must not count as "no records": that would empty every roster.
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  api.controlPlane.on('GET', '/v1/agents', jsonResponse(500, { error: 'down' }))
  await expect(api.rebuildRosters()).rejects.toMatchObject({ status: 502 })
  expect(entry('lima')).toMatchObject({ agents: [{ name: 'reviewer' }] })
})

it('project is the name of the project of project_id', async () => {
  await roster().rebuild('lima', [record('reviewer', 'lima', { project_id: PAYMENTS.id })], [PAYMENTS])
  expect(entry('lima')).toMatchObject({ agents: [{ name: 'reviewer', project: 'Payments' }] })
})

it('the text label of phase 1 does not go into the roster', async () => {
  await roster().rebuild('lima', [record('reviewer', 'lima', { project: 'Old' })], [PAYMENTS])
  expect((entry('lima') as { agents: object[] }).agents[0]).not.toHaveProperty('project')
})

it('a project_id that no project has leaves the key out', async () => {
  await roster().rebuild('lima', [record('reviewer', 'lima', { project_id: 'f'.repeat(32) })], [PAYMENTS])
  expect((entry('lima') as { agents: object[] }).agents[0]).not.toHaveProperty('project')
})

it('a new name changes the event of the next rebuild', async () => {
  const r = roster()
  const records = [record('reviewer', 'lima', { project_id: PAYMENTS.id })]
  await r.rebuild('lima', records, [PAYMENTS])
  const writes = rosterWrites()
  await r.rebuild('lima', records, [{ ...PAYMENTS, name: 'Billing' }])
  expect(rosterWrites()).toBe(writes + 1)
  expect(entry('lima')).toMatchObject({ agents: [{ project: 'Billing' }] })
})

it('rebuildRosters reads the projects itself', async () => {
  const projects = [PAYMENTS]
  const store = fakeAgentStore(api.controlPlane, projects)
  fakeProjectStore(api.controlPlane, projects, { records: store.records, vms: [] })
  store.records.push(record('reviewer', 'lima', { project_id: PAYMENTS.id }))
  await api.rebuildRosters()
  expect(entry('lima')).toMatchObject({ agents: [{ name: 'reviewer', project: 'Payments' }] })
})
