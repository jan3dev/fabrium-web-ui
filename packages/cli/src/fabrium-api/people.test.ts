import { mkdirSync } from 'node:fs'
import { join as joinPath } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRecord } from './agent-records.js'
import type { AgentContext } from './agents.js'
import { createControlPlane } from './control-plane.js'
import { checkPerson, listPeople } from './people.js'
import { createTestApi, fakeAgentStore } from './test-api.js'

let api: ReturnType<typeof createTestApi>
let ctx: AgentContext

const join = (userId: string, content: Record<string, unknown> = {}) =>
  api.fake.setState(api.fake.spaceId, 'm.room.member', userId, { membership: 'join', ...content })

beforeEach(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  // createTestApi joins @ann (admin) and @bob (member) already.
  api = createTestApi()
  const store = fakeAgentStore(api.controlPlane)
  join('@ana:example.org', { displayname: 'Ana' })
  join('@bob:example.org', { displayname: '' })
  join('@dee1:example.org', { displayname: 'Dee' })
  join('@dee2:example.org', { displayname: ' Dee ' })
  for (const id of ['@carl', '@limaway', '@tango', '@rost', '@s-meow']) join(`${id}:example.org`)
  join('@remote:other.org')
  join('@gone:example.org')
  api.fake.setMember(api.fake.spaceId, '@gone:example.org', 'leave')
  // The bundles lima and kilo, with @lima, @lima.scout, @kilo, and @kilo.draft joined. No record has vm kilo.
  await api.admit('lima', 'scout')
  await api.admit('kilo', 'draft')
  // A workstation of deploy/add-workstation.sh: its bundle has no marker of the VM API.
  mkdirSync(joinPath(api.workstationsDir, 'echo'), { recursive: true })
  join('@echo:example.org')
  // A record of the VM name tango, which has no bundle.
  store.records.push({
    id: 'r1',
    name: 'helper',
    owner: '@ana:example.org',
    description: '',
    model: 'glm-5-3',
    tag: null,
    project: null,
    vm: 'tango',
    rooms: [],
  } satisfies AgentRecord)
  // The central roster lists @rost, which is in no other rule.
  api.fake.setState(api.fake.spaceId, 'dev.zooid.workforce', '', {
    version: 1,
    agents: [{ user_id: '@rost:example.org', name: 'rost', rooms: [] }],
  })
  // Only the fields that people.ts reads.
  ctx = {
    controlPlane: createControlPlane({
      baseUrl: api.deps.controlPlaneUrl,
      apiKey: api.deps.controlPlaneKey,
      fetch: api.deps.conn.fetch,
    }),
    client: api.client,
    asUserId: api.deps.asUserId,
    serverName: api.deps.serverName,
    getSpaceRoomId: api.deps.getSpaceRoomId,
    instanceAgents: [{ name: 's-meow', userId: '@s-meow:example.org' }],
    workstationsDir: api.workstationsDir,
  } as unknown as AgentContext
})
afterEach(() => {
  api.cleanup()
  vi.restoreAllMocks()
})

describe('listPeople', () => {
  it('lists only the people, with their names', async () => {
    expect(await listPeople(ctx)).toEqual([
      { user_id: '@ana:example.org', name: 'Ana' },
      { user_id: '@dee1:example.org', name: 'Dee' },
      { user_id: '@dee2:example.org', name: 'Dee' },
      { user_id: '@ann:example.org', name: 'ann' },
      { user_id: '@bob:example.org', name: 'bob' },
      { user_id: '@carl:example.org', name: 'carl' },
      { user_id: '@limaway:example.org', name: 'limaway' },
    ])
  })

  it('sorts by name, then by user_id', async () => {
    // 'Ana' and 'Dee' sort before 'ann': plain code unit order.
    expect((await listPeople(ctx)).filter((p) => p.name === 'Dee').map((p) => p.user_id)).toEqual([
      '@dee1:example.org',
      '@dee2:example.org',
    ])
  })
})

describe('checkPerson', () => {
  it.each([
    '@lima:example.org',
    '@lima.scout:example.org',
    '@kilo.draft:example.org',
    '@echo:example.org',
    '@tango:example.org',
    '@rost:example.org',
    '@s-meow:example.org',
    '@zooid:example.org',
  ])('refuses %s as a person', async (id) => {
    await expect(checkPerson(ctx, id)).rejects.toMatchObject({
      status: 400,
      body: { error: 'owner must be a person' },
    })
  })

  it.each(['@gone:example.org', '@remote:other.org', '@nobody:example.org', 'ana', '@ana:example.org\n', ''])(
    'refuses %j as not a member',
    async (id) => {
      await expect(checkPerson(ctx, id)).rejects.toMatchObject({
        status: 400,
        body: { error: 'owner must be a member of the workspace' },
      })
    },
  )

  it('accepts a person', async () => {
    await expect(checkPerson(ctx, '@ana:example.org')).resolves.toBeUndefined()
  })

  it('a name that only starts like a VM is a person', async () => {
    // The bundle is lima, not limaway.
    await expect(checkPerson(ctx, '@limaway:example.org')).resolves.toBeUndefined()
  })
})

describe('failures', () => {
  it('answers 503 while the space is not ready', async () => {
    const notReady = { ...ctx, getSpaceRoomId: () => undefined }
    const answer = { status: 503, body: { error: 'workforce space is not ready' } }
    await expect(listPeople(notReady)).rejects.toMatchObject(answer)
    await expect(checkPerson(notReady, '@ana:example.org')).rejects.toMatchObject(answer)
  })

  it('answers 502 when the homeserver fails', async () => {
    const answer = { status: 502, body: { error: 'homeserver unreachable' } }
    api.fake.failOnce('GET', /\/state$/, 500)
    await expect(listPeople(ctx)).rejects.toMatchObject(answer)
    api.fake.failOnce('GET', /\/state$/, 500)
    await expect(checkPerson(ctx, '@ana:example.org')).rejects.toMatchObject(answer)
  })
})
