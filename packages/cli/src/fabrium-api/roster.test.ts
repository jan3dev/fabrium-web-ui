import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AgentRecord } from './agent-records.js'
import { ensureVmBundle } from './bundle.js'
import { createRoster } from './roster.js'
import { createTestApi, fakeAgentStore, jsonResponse } from './test-api.js'

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
    client: api.deps.client,
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
    record('reviewer', 'lima', { tag: 'Reviewer', project: 'Payments' }),
    record('reviewer', 'cusco'),
    record('draft', null),
  ]
  await roster().rebuild('lima', records)
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
  await r.rebuild('lima', [record('reviewer', 'lima')])
  const writes = rosterWrites()
  await r.rebuild('lima', [record('reviewer', 'lima')])
  expect(rosterWrites()).toBe(writes)
})

it('a VM name without records gets an empty list', async () => {
  await roster().rebuild('lima', [record('reviewer', 'cusco')])
  expect(entry('lima')).toEqual({ version: 1, agents: [] })
})

it('a room alias that does not resolve is left out of the entry', async () => {
  const rooms = ['#general:example.org', '#gone:example.org', '!direct:example.org']
  await roster().rebuild('lima', [record('reviewer', 'lima', { rooms })])
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
  await roster().rebuildAll([record('reviewer', 'lima'), record('draft', null)])
  expect(entry('kilo')).toEqual({ version: 1, agents: [] })
  expect(entry('lima')).toMatchObject({ agents: [{ name: 'reviewer' }] })
})

it('a failure for one VM name does not stop the next', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  api.fake.failOnce('PUT', /\/state\/dev\.zooid\.workforce\/cusco$/, 500)
  await roster().rebuildAll([record('reviewer', 'cusco'), record('reviewer', 'lima')])
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
