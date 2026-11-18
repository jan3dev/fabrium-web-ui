import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAdmission, type AdmissionDeps, type NewAgent } from './admission.js'
import { MARKER, envVar, renderRegistration, renderYaml, type BundleSpec } from './bundle.js'
import { whoami } from './matrix.js'
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

describe('admit and remove on a VM name', () => {
  const REVIEWER = '@lima.reviewer:example.org'
  const TESTER = '@lima.tester:example.org'
  const SENDER = '@lima:example.org'
  const dir = () => join(api.workstationsDir, 'lima')
  const placed = (agent: string, last = false) => ({
    workstation: 'lima',
    agent,
    rooms: ['#general:example.org'],
    last,
  })
  const leaves = () => calls('POST', /\/leave\?/).length

  it('admits the first agent of a VM name', async () => {
    const admitted = await admission().admit({ workstation: 'lima', agent: 'reviewer' })
    const f = api.fake
    expect(admitted).toEqual({ agentId: REVIEWER, rooms: ['#general:example.org'], env: envOf() })
    expect(existsSync(join(dir(), MARKER))).toBe(true)
    expect(existsSync(join(dir(), 'workforce'))).toBe(false)
    expect(envOf()).not.toContain('AGENT_NAME')
    expect(adminMessages()).toHaveLength(1)
    expect(adminMessages()[0]?.body).toMatch(/^!admin appservices register\n/)
    expect(f.userExists(REVIEWER)).toBe(true)
    expect(f.membership(f.spaceId, REVIEWER)).toBe('join')
    expect(f.membership(f.generalRoomId, REVIEWER)).toBe('join')
    expect(f.membership(f.spaceId, SENDER)).toBe('join')
    // The roster is not the job of admit.
    expect(f.state(f.spaceId, 'dev.zooid.workforce', 'lima')).toBeUndefined()
  })

  it('admits a second agent without a second registration', async () => {
    const adm = admission()
    const first = await adm.admit({ workstation: 'lima', agent: 'reviewer' })
    const second = await adm.admit({ workstation: 'lima', agent: 'tester' })
    expect(second).toEqual({ ...first, agentId: TESTER })
    expect(adminMessages()).toHaveLength(1)
    expect(api.fake.membership(api.fake.generalRoomId, REVIEWER)).toBe('join')
    expect(api.fake.membership(api.fake.generalRoomId, TESTER)).toBe('join')
  })

  it('refuses a new VM name that is a Matrix user, or that would capture a space member', async () => {
    const asUser = await settle(admission().admit({ workstation: 'ann', agent: 'reviewer' }))
    expect(asUser).toMatchObject({ status: 409 })
    api.fake.joinSpace('@lima.bob:example.org')
    const captures = await settle(admission().admit({ workstation: 'lima', agent: 'reviewer' }))
    expect(captures).toMatchObject({ status: 409 })
    expect(captures).not.toHaveProperty('body.step')
    expect(existsSync(dir())).toBe(false)
    expect(adminMessages()).toHaveLength(0)
  })

  it('refuses a name with a registration file or a bundle without the marker', async () => {
    writeFileSync(join(api.registrationsDir, 'lima.yaml'), 'id: lima\n')
    expect(await settle(admission().admit({ workstation: 'lima', agent: 'reviewer' }))).toMatchObject({ status: 409 })
    mkdirSync(join(api.workstationsDir, 'kilo'), { recursive: true })
    writeFileSync(join(api.workstationsDir, 'kilo', '.env'), 'WORKSTATION=kilo\n')
    expect(await settle(admission().admit({ workstation: 'kilo', agent: 'reviewer' }))).toMatchObject({ status: 409 })
    expect(adminMessages()).toHaveLength(0)
  })

  it('a failed step names itself', async () => {
    api.fake.failOnce('POST', /\/join\//, 500)
    const err = await settle(admission().admit({ workstation: 'lima', agent: 'reviewer' }))
    expect(err).toMatchObject({ status: 502, body: { step: 'join' } })
    // A resume, for any agent: the bundle has the marker.
    await expect(admission().admit({ workstation: 'lima', agent: 'tester' })).resolves.toMatchObject({ agentId: TESTER })
    expect(adminMessages()).toHaveLength(1)
  })

  it('removes one agent and keeps the VM credential', async () => {
    const adm = admission()
    await adm.admit({ workstation: 'lima', agent: 'reviewer' })
    await adm.admit({ workstation: 'lima', agent: 'tester' })
    await adm.remove(placed('tester'))
    const f = api.fake
    expect(f.membership(f.generalRoomId, TESTER)).toBe('leave')
    expect(f.membership(f.spaceId, TESTER)).toBe('leave')
    expect(adminMessages()).toHaveLength(1)
    expect(existsSync(join(dir(), '.env'))).toBe(true)
    expect(f.membership(f.generalRoomId, REVIEWER)).toBe('join')
    expect(f.membership(f.spaceId, SENDER)).toBe('join')
  })

  it('removes the last agent, the registration, and the bundle', async () => {
    const adm = admission()
    const { env } = await adm.admit({ workstation: 'lima', agent: 'reviewer' })
    await adm.remove(placed('reviewer', true))
    const f = api.fake
    expect(adminMessages().at(-1)?.body).toBe('!admin appservices unregister lima')
    expect(await whoami(api.deps.conn, envVar(env, 'MATRIX_AS_TOKEN')!)).toBeNull()
    expect(f.membership(f.generalRoomId, REVIEWER)).toBe('leave')
    expect(f.membership(f.spaceId, REVIEWER)).toBe('leave')
    expect(f.membership(f.spaceId, SENDER)).toBe('leave')
    expect(existsSync(dir())).toBe(false)
  })

  it('a second remove of the last agent does nothing and succeeds', async () => {
    const adm = admission()
    await adm.admit({ workstation: 'lima', agent: 'reviewer' })
    await adm.remove(placed('reviewer', true))
    const before = api.fake.calls.length
    await adm.remove(placed('reviewer', true))
    expect(api.fake.calls.length).toBe(before)
  })

  it('the last agent can leave before its VM goes, and unregister after', async () => {
    // The order of contracts section 3: leave, then the delete of the VM, then unregister.
    const adm = admission()
    await adm.admit({ workstation: 'lima', agent: 'reviewer' })
    await adm.remove(placed('reviewer'))
    expect(api.fake.membership(api.fake.spaceId, REVIEWER)).toBe('leave')
    expect(adminMessages()).toHaveLength(1)
    const afterLeave = leaves()
    await adm.remove(placed('reviewer', true))
    // Only the sender leaves now: the agent left already.
    expect(leaves() - afterLeave).toBe(1)
    expect(adminMessages().at(-1)?.body).toBe('!admin appservices unregister lima')
    expect(existsSync(dir())).toBe(false)
  })

  it('a remove waits until the token stops, and fails with the step after the timeout', async () => {
    const adm = admission()
    const { env } = await adm.admit({ workstation: 'lima', agent: 'reviewer' })
    api.fake.knobs.adminCommandWorks = false
    const whoamis = calls('GET', /account\/whoami/).length
    const err = await settle(adm.remove(placed('reviewer', true)))
    expect(err).toMatchObject({ status: 502, body: { step: 'unregister' } })
    expect(err?.body.error).not.toContain(envVar(env, 'MATRIX_AS_TOKEN')!)
    expect(calls('GET', /account\/whoami/).length - whoamis).toBeGreaterThan(2)
    expect(existsSync(join(dir(), '.env'))).toBe(true)
  })

  it('a remove after the registration went away finishes without a second command', async () => {
    const adm = admission()
    await adm.admit({ workstation: 'lima', agent: 'reviewer' })
    api.fake.knobs.adminCommandWorks = false
    await settle(adm.remove(placed('reviewer', true)))
    // The command takes effect late.
    api.fake.knobs.adminCommandWorks = true
    await api.deps.client.sendMessage({
      roomId: api.fake.adminRoomId,
      asUserId: '@zooid:example.org',
      content: { msgtype: 'm.text', body: '!admin appservices unregister lima' },
    })
    const sent = adminMessages().length
    await adm.remove(placed('reviewer', true))
    expect(adminMessages()).toHaveLength(sent)
    expect(existsSync(dir())).toBe(false)
  })

  it('keeps the bundle when the homeserver fails the token check', async () => {
    const adm = admission()
    await adm.admit({ workstation: 'lima', agent: 'reviewer' })
    api.fake.failOnce('GET', /account\/whoami/, 500)
    const err = await settle(adm.remove(placed('reviewer', true)))
    expect(err).toMatchObject({ status: 502, body: { step: 'unregister' } })
    expect(existsSync(join(dir(), '.env'))).toBe(true)
  })
})
