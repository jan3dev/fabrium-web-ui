import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdmission, type AdmissionDeps, type NewAgent } from './admission.js'
import { MARKER, renderRegistration, renderYaml, type BundleSpec } from './bundle.js'
import { createTestApi } from './test-api.js'

const agent: NewAgent = {
  workstation: 'lima',
  agent: 'echo',
  persona: 'Reviewer',
  project: 'Fabrium',
}
const spec: BundleSpec = {
  workstation: 'lima',
  agent: 'echo',
  serverName: 'example.org',
  homeserverUrl: 'https://chat.example.org',
  space: 'dev',
  rooms: ['#general'],
}
const AGENT_ID = '@lima.echo:example.org'

let api: ReturnType<typeof createTestApi>

function admission(over: Partial<AdmissionDeps> = {}) {
  const d = api.deps
  return createAdmission({
    conn: d.conn,
    client: d.client,
    asToken: d.asToken,
    asUserId: d.asUserId,
    serverName: d.serverName,
    homeserverUrl: d.homeserverUrl,
    workforceSpace: d.workforceSpace,
    getSpaceRoomId: d.getSpaceRoomId,
    rooms: d.vmRooms,
    workstationsDir: api.workstationsDir,
    registrationsDir: api.registrationsDir,
    whoamiTimeoutMs: 100,
    pollIntervalMs: 5,
    ...over,
  })
}

const adminMessages = () =>
  api.fake.messages.filter((m) => m.roomId === api.fake.adminRoomId)
const envOf = (ws = 'lima') => readFileSync(join(api.workstationsDir, ws, '.env'), 'utf8')
const calls = (method: string, pattern: RegExp) =>
  api.fake.calls.filter((c) => c.method === method && pattern.test(c.path))
const settle = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (err: unknown) => err as { status: number; body: { error: string; step?: string } },
  )

beforeEach(() => {
  api = createTestApi()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  api.cleanup()
  vi.restoreAllMocks()
})

describe('a new agent', () => {
  it('is admitted end to end', async () => {
    const bundle = await admission().admitNew(agent)
    const f = api.fake
    expect(bundle.agentId).toBe(AGENT_ID)
    expect(existsSync(join(api.workstationsDir, 'lima', MARKER))).toBe(true)
    expect(envOf()).toBe(bundle.env)
    expect(readFileSync(join(api.workstationsDir, 'lima', 'workforce', 'zooid.yaml'), 'utf8')).toBe(
      renderYaml(spec),
    )
    expect(adminMessages()).toHaveLength(1)
    expect(f.userExists(AGENT_ID)).toBe(true)
    expect(f.membership(f.spaceId, '@lima:example.org')).toBe('join')
    expect(f.membership(f.spaceId, AGENT_ID)).toBe('join')
    expect(f.membership(f.generalRoomId, AGENT_ID)).toBe('join')
    expect(f.state(f.spaceId, 'dev.zooid.workforce', 'lima')).toEqual({
      version: 1,
      agents: [
        {
          user_id: AGENT_ID,
          name: 'echo',
          rooms: [f.generalRoomId],
          persona: 'Reviewer',
          project: 'Fabrium',
        },
      ],
    })
  })

  it('registers the appservice with !admin appservices register and a code block', async () => {
    const bundle = await admission().admitNew(agent)
    const [message] = adminMessages()
    expect(message?.sender).toBe('@zooid:example.org')
    expect(message?.body).toBe(
      ['!admin appservices register', '```', renderRegistration(spec, bundle).trimEnd(), '```'].join(
        '\n',
      ),
    )
    expect(message?.body).toContain(bundle.asToken)
    expect(message?.body).toContain(bundle.hsToken)
  })

  it('leaves persona and project out of the roster when they are not given', async () => {
    await admission().admitNew({ workstation: 'lima', agent: 'echo' })
    const roster = api.fake.state(api.fake.spaceId, 'dev.zooid.workforce', 'lima') as {
      agents: Record<string, unknown>[]
    }
    expect(Object.keys(roster.agents[0]!).sort()).toEqual(['name', 'rooms', 'user_id'])
  })

  it('waits for whoami to accept the VM token', async () => {
    api.fake.knobs.registerAfterWhoamiPolls = 3
    await admission().admitNew(agent)
    expect(calls('GET', /account\/whoami/).length).toBeGreaterThanOrEqual(4)
  })

  it('joins every configured room, resolving aliases', async () => {
    api.fake.addRoom('#ops', '!ops:example.org', 'public')
    await admission({ rooms: ['#general', '#ops'] }).admitNew(agent)
    expect(api.fake.membership('!ops:example.org', AGENT_ID)).toBe('join')
    const roster = api.fake.state(api.fake.spaceId, 'dev.zooid.workforce', 'lima') as {
      agents: { rooms: string[] }[]
    }
    expect(roster.agents[0]?.rooms).toEqual([api.fake.generalRoomId, '!ops:example.org'])
  })
})

describe('a failure', () => {
  it('names the setup when @zooid is not in the admin room (RF1)', async () => {
    api.fake.setMember(api.fake.adminRoomId, '@zooid:example.org', 'leave')
    const err = await settle(admission().admitNew(agent))
    expect(err).toMatchObject({ status: 502, body: { step: 'register_appservice' } })
    expect(err?.body.error).toContain('make-user-admin')
    expect(existsSync(join(api.workstationsDir, 'lima', '.env'))).toBe(true)
  })

  it('names the admin room when the command has no effect (RF1)', async () => {
    api.fake.knobs.adminCommandWorks = false
    const err = await settle(admission().admitNew(agent))
    expect(err).toMatchObject({ status: 502, body: { step: 'whoami' } })
    expect(err?.body.error).toContain('#admins:example.org')
    expect(err?.body.error).toContain('make-user-admin')
  })

  it.each([
    [
      'bundle',
      () => writeFileSync(api.workstationsDir, 'not a directory'),
      {},
    ],
    [
      'register_appservice',
      () => api.fake.failOnce('PUT', /\/send\/m\.room\.message\//, 500),
      {},
    ],
    ['register_user', () => api.fake.failOnce('POST', /\/register$/, 500), {}],
    ['join', () => undefined, { rooms: ['#missing'] }],
    ['roster', () => api.fake.failOnce('PUT', /\/state\/dev\.zooid\.workforce/, 500), {}],
  ])('names the step %s in a 502 and keeps tokens out of the message', async (step, arrange, over) => {
    arrange()
    const err = await settle(admission(over).admitNew(agent))
    expect(err).toMatchObject({ status: 502, body: { step } })
    if (existsSync(join(api.workstationsDir, 'lima', '.env'))) {
      const tokens = envOf().match(/^MATRIX_(?:AS|HS)_TOKEN=(.+)$/gm) ?? []
      for (const line of tokens) expect(err?.body.error).not.toContain(line.split('=')[1])
    }
  })

  it('resumes without new tokens and without a second registration', async () => {
    api.fake.failOnce('POST', /\/join\//, 500)
    const first = await settle(admission().admitNew(agent))
    expect(first).toMatchObject({ status: 502, body: { step: 'join' } })
    const envBefore = envOf()
    expect(adminMessages()).toHaveLength(1)

    await admission().admitNew(agent)
    expect(envOf()).toBe(envBefore)
    expect(adminMessages()).toHaveLength(1)
    expect(api.fake.membership(api.fake.generalRoomId, AGENT_ID)).toBe('join')
  })

  it('sends the command again when the first one had no effect', async () => {
    api.fake.knobs.adminCommandWorks = false
    expect(await settle(admission().admitNew(agent))).toMatchObject({ body: { step: 'whoami' } })
    api.fake.knobs.adminCommandWorks = true
    await admission().admitNew(agent)
    expect(adminMessages()).toHaveLength(2)
  })

  it('fails the join for a user who is banned from a room', async () => {
    api.fake.setMember(api.fake.generalRoomId, AGENT_ID, 'ban')
    const err = await settle(admission().admitNew(agent))
    expect(err).toMatchObject({ status: 502, body: { step: 'join' } })
    expect(err?.body.error).toContain('banned')
  })
})

describe('a refusal', () => {
  it.each([
    ['a registration file of add-workstation.sh', () =>
      writeFileSync(join(api.registrationsDir, 'lima.yaml'), 'id: lima\n')],
    ['a bundle without the marker', () => {
      mkdirSync(join(api.workstationsDir, 'lima'), { recursive: true })
      writeFileSync(join(api.workstationsDir, 'lima', '.env'), 'AGENT_NAME=echo\n')
    }],
  ])('refuses %s with 409 and sends nothing', async (_name, arrange) => {
    arrange()
    const err = await settle(admission().admitNew(agent))
    expect(err).toMatchObject({ status: 409 })
    expect(err).not.toHaveProperty('body.step')
    expect(adminMessages()).toHaveLength(0)
  })

  it('refuses a bundle that belongs to another agent', async () => {
    await admission().admitNew(agent)
    const err = await settle(admission().admitNew({ workstation: 'lima', agent: 'other' }))
    expect(err).toMatchObject({ status: 409 })
    expect(err?.body.error).toContain('echo')
    expect(adminMessages()).toHaveLength(1)
  })

  it('refuses a name when a member of the space has a name under it (RF2)', async () => {
    api.fake.joinSpace('@lima.bob:example.org')
    const err = await settle(admission().admitNew(agent))
    expect(err).toMatchObject({ status: 409 })
    expect(err?.body.error).toContain('@lima.bob:example.org')
    expect(existsSync(join(api.workstationsDir, 'lima'))).toBe(false)
    expect(adminMessages()).toHaveLength(0)
  })

  it('refuses when the agent id exists already, also outside the space', async () => {
    api.fake.addUser(AGENT_ID)
    const err = await settle(admission().admitNew(agent))
    expect(err).toMatchObject({ status: 409 })
    expect(err?.body.error).toContain(AGENT_ID)
    expect(existsSync(join(api.workstationsDir, 'lima'))).toBe(false)
    expect(adminMessages()).toHaveLength(0)
  })

  it.each([
    ['a name that only starts the same way', '@limax.bob:example.org'],
    ['a name that differs by one letter', '@lime.bob:example.org'],
    ['a user of another server', '@lima.bob:other.org'],
  ])('does not refuse the name for %s in the space', async (_name, user) => {
    api.fake.joinSpace(user)
    await expect(admission().admitNew(agent)).resolves.toMatchObject({ agentId: AGENT_ID })
  })

  it('answers 502 at bundle when the members of the space cannot be read', async () => {
    api.fake.failOnce('GET', /joined_members/, 500)
    const err = await settle(admission().admitNew(agent))
    expect(err).toMatchObject({ status: 502, body: { step: 'bundle' } })
    expect(existsSync(join(api.workstationsDir, 'lima'))).toBe(false)
  })

  it.each(['ann', 'zooid'])('refuses a name that is already a Matrix user: %s (RF2)', async (name) => {
    const err = await settle(admission().admitNew({ workstation: name, agent: 'echo' }))
    expect(err).toMatchObject({ status: 409 })
    expect(err?.body.error).toContain(`@${name}:example.org`)
    expect(existsSync(join(api.workstationsDir, name))).toBe(false)
    expect(adminMessages()).toHaveLength(0)
  })
})

describe('concurrency and repeats', () => {
  it('serializes concurrent admissions of one workstation (RF3)', async () => {
    const adm = admission()
    const [a, b] = await Promise.all([adm.admitNew(agent), adm.admitNew(agent)])
    expect(a.asToken).toBe(b.asToken)
    expect(adminMessages()).toHaveLength(1)
    expect(calls('POST', /\/register$/).length).toBeLessThanOrEqual(2)
  })

  it('keeps going after a failed admission', async () => {
    api.fake.failOnce('PUT', /\/state\/dev\.zooid\.workforce/, 500)
    const adm = admission()
    expect(await settle(adm.admitNew(agent))).toMatchObject({ body: { step: 'roster' } })
    await expect(adm.admitNew(agent)).resolves.toMatchObject({ agentId: AGENT_ID })
  })

  it('writes the roster only when it changes', async () => {
    const adm = admission()
    await adm.admitNew(agent)
    await adm.admitNew(agent)
    expect(calls('PUT', /state\/dev\.zooid\.workforce/)).toHaveLength(1)
    await adm.admitNew({ ...agent, persona: 'Planner' })
    expect(calls('PUT', /state\/dev\.zooid\.workforce/)).toHaveLength(2)
  })

  it('does not invite a member who has joined already', async () => {
    const adm = admission()
    await adm.admitNew(agent)
    const invites = calls('POST', /\/invite/).length
    await adm.admitNew(agent)
    expect(calls('POST', /\/invite/)).toHaveLength(invites)
  })
})
