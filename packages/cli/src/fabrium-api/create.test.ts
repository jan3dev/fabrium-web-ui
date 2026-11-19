import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRecord } from './agent-records.js'
import { ensureVmBundle } from './bundle.js'
import { parseCreateRequest } from './create.js'
import type { ApiError } from './errors.js'
import type { Project } from './project-records.js'
import { ADMIN, COMMIT, createTestApi, fakeAgentStore, jsonResponse, stalledResponse } from './test-api.js'

const LUIS = '@luis:example.org' // vm-creator
const VERA = '@vera:example.org' // vm-creator
const ANA = '@ana:example.org' // agents-manager
const VM = {
  id: 'i-0123456789abcdef0',
  name: 'lima',
  state: 'pending',
  instance_type: 't3a.medium',
  sev_snp: false,
  public_ip: null,
  launched_at: '2026-10-26T19:00:00Z',
  setup: 'pending',
}
const HAVEN = 'hk-secret-1'
const GITHUB = 'gh-secret-1'

const body = (over: Record<string, unknown> = {}) => ({
  agent: 'p1',
  name: 'lima',
  instance_type: 't3a.medium',
  haven_api_key: HAVEN,
  github_token: GITHUB,
  ...over,
})

let api: ReturnType<typeof createTestApi>
let store: { records: AgentRecord[] }
let projects: Project[]
let vms: Record<string, unknown>[]
let logSpies: { mock: { calls: unknown[][] } }[]
beforeEach(() => {
  logSpies = [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
  ]
})
const PR1 = '1'.repeat(32)
const record = (id: string, name: string, vm: string | null, owner: string, projectId: string | null = null) =>
  store.records.push({
    id,
    name,
    owner,
    description: '',
    model: 'glm-5-3',
    tag: null,
    project: null,
    project_id: projectId,
    vm,
    rooms: vm === null ? [] : ['#general:example.org'],
  })
function setup(overrides: Parameters<typeof createTestApi>[0] = {}) {
  api = createTestApi({ whoamiTimeoutMs: 100, pollIntervalMs: 5, ...overrides })
  projects = [{ id: PR1, name: 'Payments', created_at: '2026-11-19T19:00:00Z', updated_at: '2026-11-19T19:00:00Z' }]
  store = fakeAgentStore(api.controlPlane, projects)
  vms = []
  api.controlPlane.on('GET', '/v1/vms', () => jsonResponse(200, vms))
  api.controlPlane.on('GET', '/v1/projects', () => jsonResponse(200, projects))
  // The new VM has the creator and the project of the request.
  api.controlPlane.on('POST', '/v1/vms', (req) => {
    const sent = req.body as { creator: string; project_id?: string }
    return jsonResponse(201, { ...VM, creator: sent.creator, project_id: sent.project_id ?? null })
  })
  for (const [user, level] of [[LUIS, 70], [VERA, 70], [ANA, 40]] as const) api.fake.joinSpace(user, level)
  record('p1', 'draft', null, ANA)
  record('p2', 'helper', null, VERA)
  return api
}
const as = (user: string) => api.fake.openIdToken(user)
const create = (json: unknown, token?: string | null) => api.request('POST', '/vms', { json, token })
const posts = () => api.controlPlane.requests.filter((r) => r.method !== 'GET')
const upstreamCreate = () =>
  api.controlPlane.requests.find((r) => r.method === 'POST' && r.path === '/v1/vms')
    ?.body as { name: string; instance_type?: string; auto_stop_hours?: number; creator?: string; bootstrap: { files: { path: string; content: string; mode: string; owner: string }[]; script: string } }
const recordOf = (id: string) => store.records.find((r) => r.id === id)
const rosterNames = (vm: string) =>
  ((api.fake.state(api.fake.spaceId, 'dev.zooid.workforce', vm) as { agents: { name: string }[] } | undefined)
    ?.agents ?? []).map((a) => a.name)
const registrations = () =>
  api.fake.messages.filter((m) => m.roomId === api.fake.adminRoomId && m.body.includes('register\n'))

afterEach(() => {
  api?.cleanup()
  vi.restoreAllMocks()
})

describe('configuration', () => {
  it.each([
    ['ZOOID_COMMIT is not set', { zooidCommit: undefined }],
    ['ZOOID_COMMIT is not a full commit hash', { zooidCommit: 'abc123' }],
  ])('answers 503 {"error":"%s"} and does nothing', async (error, overrides) => {
    setup(overrides)
    const res = await create(body())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error })
    expect(api.controlPlane.requests).toEqual([])
    expect(api.fake.messages).toEqual([])
  })

  it('works without FABRIUM_HAVEN_MODEL', async () => {
    setup({ havenModel: undefined })
    expect((await create(body())).status).toBe(201)
  })

  it('needs a role that manages VMs: an agents-manager cannot create a VM', async () => {
    setup()
    expect((await create(body(), null)).status).toBe(401)
    expect((await create(body(), api.memberToken)).status).toBe(403)
    const manager = await create(body(), as(ANA))
    expect([manager.status, await manager.json()]).toEqual([403, { error: 'forbidden' }])
    expect(api.controlPlane.requests).toEqual([])
  })
})

describe('validation', () => {
  it.each([
    ['an uppercase name', { name: 'Lima' }],
    ['a name that starts with a hyphen', { name: '-x' }],
    ['a name of 64 characters', { name: 'a'.repeat(64) }],
    ['the name zooid', { name: 'zooid' }],
    ['no name', { name: undefined }],
    ['no agent', { agent: undefined }],
    ['an agent that is not a string', { agent: 5 }],
    ['no Haven key', { haven_api_key: undefined }],
    ['an empty Haven key', { haven_api_key: '' }],
    ['a blank Haven key', { haven_api_key: '   ' }],
    ['a Haven key that is not a string', { haven_api_key: 5 }],
    ['a Haven key with a newline inside (RF5)', { haven_api_key: 'a\nb' }],
    ['a GitHub token that is not a string', { github_token: 5 }],
    ['a GitHub token with a NUL (RF5)', { github_token: 'a\u0000b' }],
    ['a Haven key with a backslash', { haven_api_key: 'abc\\def' }],
    ['a Haven key that starts with a double quote', { haven_api_key: '"hvn1_abc"' }],
    ['a Haven key that starts with a single quote', { haven_api_key: "'hvn1_abc'" }],
    ['a GitHub token with a backslash', { github_token: 'abc\\def' }],
    ['a GitHub token that starts with a quote', { github_token: '"ghp_abc' }],
    ['an instance type that is not a string', { instance_type: 5 }],
    ['auto_stop_hours of 0', { auto_stop_hours: 0 }],
    ['auto_stop_hours of 169', { auto_stop_hours: 169 }],
    ['auto_stop_hours of 1.5', { auto_stop_hours: 1.5 }],
    ['auto_stop_hours as a string', { auto_stop_hours: '12' }],
    ['a project_id that is not a string', { project_id: 5 }],
  ])('answers 400 for %s, without a secret in the message', async (_name, over) => {
    setup()
    const res = await create(body(over))
    expect(res.status).toBe(400)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ error: expect.any(String) })
    expect(text).not.toContain(HAVEN)
    expect(text).not.toContain(GITHUB)
    expect(api.controlPlane.requests).toEqual([])
    expect(api.fake.messages).toEqual([])
  })

  it('answers 400 for a body that is not JSON', async () => {
    setup()
    const res = await api.app.request('/_fabrium/v1/vms', {
      method: 'POST',
      headers: { authorization: `Bearer ${api.adminToken}`, 'content-type': 'application/json' },
      body: '{"haven_api_key": "hk-secret-1"',
    })
    expect(res.status).toBe(400)
    expect(await res.text()).not.toContain(HAVEN)
  })
})

// Refuse what configure-agent.sh refuses, or the VM stops at boot: this runs the script's own check.
describe('secrets that the VM script refuses', () => {
  const script = readFileSync(
    new URL('../../../../deploy/agent-vm/configure-agent.sh', import.meta.url),
    'utf8',
  )
  const block = /for key in \$VARS; do\n {2}case "\$\{!key\}" in[\s\S]*?\n {2}esac\ndone\n/.exec(script)?.[0]
  const vmVerdict = (value: string): string =>
    execFileSync(
      'bash',
      ['-c', `die() { printf 'REJECT %s' "$*"; exit 0; }\nVARS=SECRET\nSECRET="$1"\n${block}printf ACCEPT`, '_', value],
      { encoding: 'utf8' },
    )
  const apiVerdict = (field: string, value: string): string => {
    try {
      parseCreateRequest({
        agent: 'p1',
        name: 'lima',
        haven_api_key: 'hvn1_abc',
        github_token: undefined,
        [field]: value,
      })
      return 'ACCEPT'
    } catch (err) {
      return `REJECT ${(err as ApiError).body.error}`
    }
  }

  it('finds the check in the script', () => {
    expect(block).toBeDefined()
    expect(vmVerdict('hvn1_abc')).toBe('ACCEPT')
    expect(vmVerdict('abc\\def')).toMatch(/^REJECT SECRET has a line break, a backslash or a leading quote/)
  })

  it.each(['haven_api_key', 'github_token'])(
    'refuses with the wording of the script, for %s',
    (field) => {
      for (const value of ['abc\\def', '"hvn1_abc"', "'hvn1_abc'", 'a\nb', 'a\rb', '\\']) {
        const script = vmVerdict(value).replace('SECRET', field)
        expect(script).toMatch(/^REJECT /)
        expect(apiVerdict(field, value)).toBe(script)
      }
    },
  )

  it.each(['hvn1_abc', 'ab"cd', "ab'cd", 'ab cd', 'a$b`c`', 'ghp_0123456789'])(
    'accepts %j, as the script does',
    (value) => {
      expect(vmVerdict(value)).toBe('ACCEPT')
      expect(apiVerdict('haven_api_key', value)).toBe('ACCEPT')
    },
  )

  it.each(['"', "'", '\\', 'a\\', ' "x', '\t"x'])(
    'never accepts %j when the script refuses the value that the API would send',
    (value) => {
      // The API trims a secret first, so the VM gets the trimmed value.
      if (vmVerdict(value.trim()).startsWith('REJECT')) {
        expect(apiVerdict('haven_api_key', value)).toMatch(/^REJECT /)
      }
    },
  )
})

describe('a VM for an agent', () => {
  it('creates a VM for a profile', async () => {
    setup()
    const res = await create(body(), as(LUIS))
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      ...VM,
      creator: LUIS,
      project_id: null,
      project: null,
      can: { set_project: true },
      agent_id: '@lima.draft:example.org',
    })
    expect(recordOf('p1')).toMatchObject({ vm: 'lima', rooms: ['#general:example.org'] })
    expect(rosterNames('lima')).toEqual(['draft'])

    const sent = upstreamCreate()
    expect(Object.keys(sent).sort()).toEqual(['bootstrap', 'creator', 'instance_type', 'name'])
    expect(sent).toMatchObject({ name: 'lima', creator: LUIS, instance_type: 't3a.medium' })
    expect(sent.bootstrap.files.map((f) => [f.path, f.owner, f.mode])).toEqual([
      ['/home/ubuntu/zooid/.env', 'ubuntu', '600'],
      ['/run/fabrium-agent-secrets.env', 'ubuntu', '600'],
    ])
    const [env, secrets] = sent.bootstrap.files
    expect(env?.content).toBe(readFileSync(join(api.workstationsDir, 'lima', '.env'), 'utf8'))
    expect(secrets?.content).toBe(
      `HAVEN_API_KEY='${HAVEN}'\nGH_TOKEN='${GITHUB}'\nFABRIUM_CREATOR='${LUIS}'\nFABRIUM_AGENT='draft'\n`,
    )
    expect(sent.bootstrap.script).toContain(`provision.sh --ref ${COMMIT}'`)
    // The caller is the creator: the agent greets them in a direct message once it works.
    expect(sent.bootstrap.script).toContain('greet-creator.sh')
    // The record is written before the VM is asked for.
    expect(posts().map((r) => `${r.method} ${r.path}`)).toEqual(['PUT /v1/agents/p1', 'POST /v1/vms'])
  })

  it('creates the VM without the greeting for a caller ID outside the strict grammar', async () => {
    setup()
    // A historical user ID, which servers still accept. It must not reach the VM, and it must not block the create.
    const caller = '@Ann:example.org'
    api.fake.joinSpace(caller, 90)
    const res = await create(body(), api.fake.openIdToken(caller))
    expect(res.status).toBe(201)
    const sent = upstreamCreate()
    expect(sent.bootstrap.files[1]?.content).toBe(
      `HAVEN_API_KEY='${HAVEN}'\nGH_TOKEN='${GITHUB}'\nFABRIUM_AGENT='draft'\n`,
    )
    expect(sent.bootstrap.script).not.toContain('greet-creator.sh')
    // The VM still gets its creator: the control plane checks the ID itself.
    expect(sent.creator).toBe(caller)
  })

  it('omits instance_type and GH_TOKEN when they are absent or empty', async () => {
    setup()
    await create(body({ instance_type: undefined, github_token: '' }))
    const sent = upstreamCreate()
    expect(Object.keys(sent).sort()).toEqual(['bootstrap', 'creator', 'name'])
    expect(sent.bootstrap.files[1]?.content).toBe(
      `HAVEN_API_KEY='${HAVEN}'\nFABRIUM_CREATOR='${ADMIN}'\nFABRIUM_AGENT='draft'\n`,
    )
  })

  it('forwards auto_stop_hours to the control plane, and none when it is absent', async () => {
    setup()
    await create(body({ auto_stop_hours: 8 }))
    expect(upstreamCreate()).toMatchObject({ auto_stop_hours: 8 })
    setup()
    await create(body())
    expect(upstreamCreate()).not.toHaveProperty('auto_stop_hours')
  })

  it('trims whitespace around the secrets', async () => {
    setup()
    await create(body({ haven_api_key: `  ${HAVEN}\n`, github_token: ` ${GITHUB} ` }))
    expect(upstreamCreate().bootstrap.files[1]?.content).toContain(`HAVEN_API_KEY='${HAVEN}'\nGH_TOKEN='${GITHUB}'\n`)
  })

  it('answers 404 for an agent that the caller does not see', async () => {
    setup()
    vms = [{ ...VM, name: 'cusco', state: 'running', creator: VERA }]
    record('a3', 'builder', 'cusco', VERA)
    for (const agent of ['nope', 'a3']) {
      const res = await create(body({ agent }), as(LUIS))
      expect([res.status, await res.json()], agent).toEqual([404, { error: 'agent not found' }])
    }
    expect(posts()).toEqual([])
  })

  it('refuses an agent that has a live VM', async () => {
    setup()
    vms = [{ ...VM, name: 'cusco', state: 'running', creator: VERA }]
    record('a3', 'builder', 'cusco', VERA)
    const res = await create(body({ agent: 'a3', name: 'cusco' }), as(VERA))
    expect([res.status, await res.json()]).toEqual([409, { error: 'the agent has a vm' }])
    expect(posts()).toEqual([])
  })

  it.each([
    ['a live VM', () => (vms = [{ ...VM, state: 'running' }])],
    ['an agent record', () => record('a9', 'other', 'lima', VERA)],
    ['a bundle without the marker', () => mkdirSync(join(api.workstationsDir, 'lima'), { recursive: true })],
  ])('refuses a profile a name that has %s', async (_case, arrange) => {
    setup()
    arrange()
    const res = await create(body(), as(LUIS))
    expect([res.status, await res.json()]).toEqual([409, { error: 'name in use' }])
    expect(posts()).toEqual([])
    expect(api.fake.messages).toEqual([])
  })

  it('a name of a VM that is shutting down is free', async () => {
    setup()
    vms = [{ ...VM, state: 'shutting-down' }]
    expect((await create(body(), as(LUIS))).status).toBe(201)
  })

  it('refuses a name that is a Matrix user with 409 before any write', async () => {
    setup()
    const res = await create(body({ name: 'ann' }))
    expect(res.status).toBe(409)
    expect(posts()).toEqual([])
    expect(api.fake.messages).toEqual([])
  })

  it('a second request after a failed join completes the VM', async () => {
    setup()
    api.fake.failOnce('POST', /\/join\//, 500)
    const failed = await create(body(), as(LUIS))
    expect(failed.status).toBe(502)
    expect(await failed.json()).toMatchObject({ step: 'join', error: expect.any(String) })
    expect(existsSync(join(api.workstationsDir, 'lima', '.env'))).toBe(true)
    expect(recordOf('p1')?.vm).toBeNull()
    expect(posts()).toEqual([])
    const env = readFileSync(join(api.workstationsDir, 'lima', '.env'), 'utf8')

    expect((await create(body(), as(LUIS))).status).toBe(201)
    expect(readFileSync(join(api.workstationsDir, 'lima', '.env'), 'utf8')).toBe(env)
    expect(registrations()).toHaveLength(1)
  })

  it('another agent can take a name whose admission did not finish', async () => {
    setup()
    api.fake.failOnce('POST', /\/join\//, 500)
    expect((await create(body(), as(LUIS))).status).toBe(502)
    const res = await create(body({ agent: 'p2' }), as(VERA))
    expect(res.status).toBe(201)
    expect(rosterNames('lima')).toEqual(['helper'])
    expect(recordOf('p1')?.vm).toBeNull()
    expect(recordOf('p2')?.vm).toBe('lima')
  })

  it('brings back the VM of an agent whose VM is gone', async () => {
    setup()
    await api.admit('quito', 'watcher')
    record('a4', 'watcher', 'quito', ANA)
    const before = registrations().length
    const res = await create(body({ agent: 'a4', name: 'quito' }), as(LUIS))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ agent_id: '@quito.watcher:example.org' })
    expect(registrations()).toHaveLength(before)
    expect(posts().map((r) => `${r.method} ${r.path}`)).toEqual(['POST /v1/vms'])
    expect(upstreamCreate().bootstrap.files[1]?.content).toContain("FABRIUM_AGENT='watcher'")
  })

  it('brings back the VM of an agent in the rooms of its record, not in FABRIUM_VM_ROOMS of today', async () => {
    setup({ vmRooms: ['#general', '#dev-talk'] })
    api.fake.addRoom('#dev-talk', '!dev-talk:example.org', 'public')
    api.fake.addRoom('#ops', '!ops:example.org', 'public')
    record('a4', 'watcher', 'quito', ANA)
    recordOf('a4')!.rooms = ['#general:example.org', '#ops:example.org']
    const res = await create(body({ agent: 'a4', name: 'quito' }), as(LUIS))
    expect(res.status).toBe(201)
    const watcher = '@quito.watcher:example.org'
    expect(api.fake.membership(api.fake.generalRoomId, watcher)).toBe('join')
    expect(api.fake.membership('!ops:example.org', watcher)).toBe('join')
    expect(api.fake.membership('!dev-talk:example.org', watcher)).toBeUndefined()
  })

  it('refuses another name for an agent that has a vm', async () => {
    setup()
    record('a4', 'watcher', 'quito', ANA)
    const res = await create(body({ agent: 'a4', name: 'lima' }), as(LUIS))
    expect([res.status, await res.json()]).toEqual([400, { error: 'name must be the vm of the agent' }])
    expect(posts()).toEqual([])
  })

  it('a control plane failure leaves the agent with its vm and no live VM', async () => {
    setup()
    api.controlPlane.on('POST', '/v1/vms', jsonResponse(502, { error: 'ec2 failed' }))
    const res = await create(body(), as(LUIS))
    expect([res.status, await res.json()]).toEqual([502, { error: 'ec2 failed' }])
    expect(recordOf('p1')?.vm).toBe('lima')
    const listed = await (await api.request('GET', '/agents', { token: as(LUIS) })).json()
    const p1 = listed.agents.find((a: { id: string }) => a.id === 'p1')
    expect(p1).toMatchObject({ vm: { name: 'lima' }, can: { create_vm: true } })
    // Create VM again, with the name of the agent.
    api.controlPlane.on('POST', '/v1/vms', jsonResponse(201, VM))
    expect((await create(body(), as(LUIS))).status).toBe(201)
  })

  it('passes a control plane 409 through', async () => {
    setup()
    api.controlPlane.on('POST', '/v1/vms', jsonResponse(409, { error: 'name in use' }))
    const res = await create(body())
    expect([res.status, await res.json()]).toEqual([409, { error: 'name in use' }])
  })

  describe('when the create went through but its answer is lost', () => {
    const lost = 'the control plane answered, but the answer could not be read. The VM may exist: check the VM list'

    it('does not say that the create failed when the body stalls', async () => {
      setup({ controlPlaneTimeoutMs: 30 })
      api.controlPlane.on('POST', '/v1/vms', stalledResponse(201))
      const res = await create(body())
      expect([res.status, await res.json()]).toEqual([502, { error: lost }])
    })

    it('says the same when the body is not JSON', async () => {
      setup()
      api.controlPlane.on('POST', '/v1/vms', new Response('<html>', { status: 201 }))
      const res = await create(body())
      expect([res.status, await res.json()]).toEqual([502, { error: lost }])
    })

    it('answers 502 control plane unreachable when an error answer stalls', async () => {
      setup({ controlPlaneTimeoutMs: 30 })
      api.controlPlane.on('POST', '/v1/vms', stalledResponse(409))
      const res = await create(body())
      expect([res.status, await res.json()]).toEqual([502, { error: 'control plane unreachable' }])
    })
  })

  it('relays a control plane answer that is not JSON (413 text)', async () => {
    setup()
    api.controlPlane.on(
      'POST',
      '/v1/vms',
      new Response('Payload Too Large', { status: 413, headers: { 'content-type': 'text/plain' } }),
    )
    const res = await create(body())
    expect([res.status, await res.text()]).toEqual([413, 'Payload Too Large'])
  })
})

describe('a VM in a project', () => {
  const needsProjectVm = [409, { error: 'a project agent needs a project vm' }]

  it('creates a project VM', async () => {
    setup()
    const res = await create(body({ project_id: PR1 }), as(LUIS))
    expect(res.status).toBe(201)
    expect(upstreamCreate()).toMatchObject({ name: 'lima', creator: LUIS, project_id: PR1 })
    expect(await res.json()).toMatchObject({
      project_id: PR1,
      project: 'Payments',
      can: { set_project: false },
      agent_id: '@lima.draft:example.org',
    })
  })

  it('relays the project of the answer: a project deleted during the launch gives a personal VM', async () => {
    setup()
    api.controlPlane.on('POST', '/v1/vms', jsonResponse(201, { ...VM, creator: LUIS, project_id: null }))
    const res = await create(body({ project_id: PR1 }), as(LUIS))
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ project_id: null, project: null, can: { set_project: true } })
  })

  it('an unknown project_id is 400 before admit', async () => {
    setup()
    const res = await create(body({ project_id: 'f'.repeat(32) }), as(LUIS))
    expect([res.status, await res.json()]).toEqual([400, { error: 'unknown project' }])
    expect(api.fake.messages).toEqual([])
    expect(existsSync(join(api.workstationsDir, 'lima'))).toBe(false)
    expect(posts()).toEqual([])
  })

  it('null and "" create a personal VM, a number is 400', async () => {
    for (const projectId of [null, '']) {
      setup()
      const res = await create(body({ project_id: projectId }), as(LUIS))
      expect(res.status).toBe(201)
      // The control plane reads "" in a POST as an unknown project: zooid leaves the field out.
      expect(upstreamCreate()).not.toHaveProperty('project_id')
    }
    setup()
    const res = await create(body({ project_id: 5 }), as(LUIS))
    expect([res.status, await res.json()]).toEqual([400, { error: 'project_id must be a string' }])
  })

  it('a project profile cannot get a personal VM', async () => {
    setup()
    record('q1', 'planner', null, ANA, PR1)
    const res = await create(body({ agent: 'q1' }), as(LUIS))
    expect([res.status, await res.json()]).toEqual(needsProjectVm)
    expect(api.fake.messages).toEqual([])
    expect(posts()).toEqual([])
  })

  it('a personal agent cannot get a personal VM name that a project agent holds', async () => {
    setup()
    // Two records with vm quito, and no live VM.
    record('a4', 'watcher', 'quito', ANA)
    record('a5', 'planner', 'quito', ANA, PR1)
    const res = await create(body({ agent: 'a4', name: 'quito' }), as(LUIS))
    expect([res.status, await res.json()]).toEqual(needsProjectVm)
    expect(posts()).toEqual([])
  })

  it('a project VM for a project agent works', async () => {
    setup()
    record('q1', 'planner', null, ANA, PR1)
    const res = await create(body({ agent: 'q1', project_id: PR1 }), as(LUIS))
    expect(res.status).toBe(201)
    expect(recordOf('q1')).toMatchObject({ vm: 'lima', project_id: PR1 })
  })

  it('an agent with a vm and no live VM that entered a project gets 409 from Create VM without a project', async () => {
    setup()
    await api.admit('quito', 'watcher')
    record('a4', 'watcher', 'quito', ANA)
    const entered = await api.request('PUT', '/agents/a4', { token: as(ANA), json: { project_id: PR1 } })
    expect(entered.status).toBe(200)
    const before = api.fake.messages.length
    const res = await create(body({ agent: 'a4', name: 'quito' }), as(LUIS))
    expect([res.status, await res.json()]).toEqual(needsProjectVm)
    expect(api.fake.messages).toHaveLength(before)
    expect(upstreamCreate()).toBeUndefined()
    expect((await create(body({ agent: 'a4', name: 'quito', project_id: PR1 }), as(LUIS))).status).toBe(201)
  })
})

describe('a VM that is launching', () => {
  // The control plane lists a new VM late: in these tests the list never shows it.
  const needsProjectVm = [409, { error: 'a project agent needs a project vm' }]
  const enter = () => api.request('PUT', '/agents/p1', { token: as(ANA), json: { project_id: PR1 } })

  it('a project agent cannot enter while its personal VM launches', async () => {
    setup()
    expect((await create(body(), as(LUIS))).status).toBe(201)
    const before = posts().length
    const res = await enter()
    expect([res.status, await res.json()]).toEqual(needsProjectVm)
    expect(posts()).toHaveLength(before)
    expect(recordOf('p1')).toMatchObject({ vm: 'lima', project_id: null })
  })

  it.each([
    ['a 503', () => jsonResponse(503, { error: 'the launch did not answer in time' })],
    ['no answer', () => Promise.reject(new TypeError('fetch failed'))],
  ])('the launch still counts after %s of the control plane', async (_case, reply) => {
    setup()
    api.controlPlane.on('POST', '/v1/vms', reply)
    expect((await create(body(), as(LUIS))).status).toBeGreaterThanOrEqual(500)
    const res = await enter()
    expect([res.status, await res.json()]).toEqual(needsProjectVm)
  })

  it('a 4xx refusal drops the launch', async () => {
    setup()
    api.controlPlane.on('POST', '/v1/vms', jsonResponse(409, { error: 'name in use' }))
    expect((await create(body(), as(LUIS))).status).toBe(409)
    expect((await enter()).status).toBe(200)
  })

  it('after 10 minutes without a listed VM the launch no longer counts', async () => {
    let clock = Date.parse('2026-11-19T19:00:00Z')
    setup({ now: () => clock })
    expect((await create(body(), as(LUIS))).status).toBe(201)
    clock += 10 * 60_000 - 1000
    expect((await enter()).status).toBe(409)
    clock += 1000
    expect((await enter()).status).toBe(200)
  })

  it('a launch with a project lets a project agent in', async () => {
    setup()
    expect((await create(body({ project_id: PR1 }), as(LUIS))).status).toBe(201)
    expect((await enter()).status).toBe(200)
    expect(recordOf('p1')).toMatchObject({ vm: 'lima', project_id: PR1 })
  })
})

describe('a homeserver that does not answer', () => {
  it.each([
    ['a call of the central client', 'GET', /\/directory\/room\//, 'register_appservice'],
    ['a call of the VM client', 'POST', /\/join\//, 'join'],
    ['a call of the API itself', 'GET', /\/register\/available$/, 'bundle'],
  ])('ends %s as a 502, and the next write in the queue still runs', { timeout: 2000 }, async (_case, method, path, step) => {
    setup({ matrixTimeoutMs: 30 })
    api.fake.hangOnce(method, path)
    const answers = await Promise.all([
      create(body(), as(LUIS)),
      create(body({ agent: 'p2', name: 'quito' }), as(VERA)),
    ])
    const [ok, failed] = answers.sort((a, b) => a.status - b.status)
    expect(ok!.status).toBe(201)
    expect([failed!.status, await failed!.json()]).toEqual([502, expect.objectContaining({ step })])
  })
})

describe('POST /vms/:id/recreate', () => {
  const recreate = (json: unknown, token?: string) => api.request('POST', `/vms/${VM.id}/recreate`, { json, token })
  const upstream = () => api.controlPlane.requests.find((r) => r.path === `/v1/vms/${VM.id}/recreate`)
  async function running() {
    vms = [{ ...VM, state: 'running', creator: LUIS }]
    await ensureVmBundle(join(api.workstationsDir, 'lima'), {
      workstation: 'lima',
      serverName: 'example.org',
      homeserverUrl: 'https://chat.example.org',
      space: 'dev',
    })
    api.controlPlane.on(
      'POST',
      `/v1/vms/${VM.id}/recreate`,
      jsonResponse(201, { ...VM, id: 'i-0fedcba9876543210', creator: LUIS }),
    )
  }

  it('refuses a personal VM with a project agent, and sends nothing', async () => {
    setup()
    await running()
    record('q1', 'planner', 'lima', ANA, PR1)
    const res = await recreate({ haven_api_key: 'hk-new' }, as(LUIS))
    expect([res.status, await res.json()]).toEqual([409, { error: 'a project agent needs a project vm' }])
    expect(upstream()).toBeUndefined()
    // A project VM with a project agent is replaced.
    vms = [{ ...VM, state: 'running', creator: LUIS, project_id: PR1 }]
    expect((await recreate({ haven_api_key: 'hk-new' }, as(LUIS))).status).toBe(201)
  })

  it('a project agent cannot enter while the replacement of its personal VM launches', async () => {
    setup()
    await running()
    Object.assign(recordOf('p1')!, { vm: 'lima', rooms: ['#general:example.org'] })
    expect((await recreate({ haven_api_key: 'hk-new' }, as(LUIS))).status).toBe(201)
    // The old VM shuts down, and the list does not show the new one yet.
    vms = [{ ...VM, state: 'shutting-down', creator: LUIS }]
    const before = posts().length
    const res = await api.request('PUT', '/agents/p1', { token: as(ANA), json: { project_id: PR1 } })
    expect([res.status, await res.json()]).toEqual([409, { error: 'a project agent needs a project vm' }])
    expect(posts()).toHaveLength(before)
  })

  it('replaces a VM with new credentials', async () => {
    setup()
    await running()
    const res = await recreate({ haven_api_key: 'hk-new' }, as(LUIS))
    expect([res.status, await res.json()]).toEqual([
      201,
      { ...VM, id: 'i-0fedcba9876543210', creator: LUIS, project_id: null, project: null, can: { set_project: true } },
    ])
    const sent = upstream()?.body as { bootstrap: { files: { path: string; content: string }[]; script: string } }
    expect(Object.keys(sent)).toEqual(['bootstrap'])
    expect(sent.bootstrap.files.map((f) => [f.path, f.content])).toEqual([
      ['/home/ubuntu/zooid/.env', readFileSync(join(api.workstationsDir, 'lima', '.env'), 'utf8')],
      // No FABRIUM_CREATOR and no FABRIUM_AGENT: the VM does not greet again.
      ['/run/fabrium-agent-secrets.env', "HAVEN_API_KEY='hk-new'\n"],
    ])
    expect(sent.bootstrap.script).not.toContain('greet-creator.sh')
    // An admin replaces any VM.
    expect((await recreate({ haven_api_key: 'hk-new' })).status).toBe(201)
  })

  it('another vm-creator gets 404', async () => {
    setup()
    await running()
    const res = await recreate({ haven_api_key: 'hk-new' }, as(VERA))
    expect([res.status, await res.json()]).toEqual([404, { error: 'not found' }])
    expect(upstream()).toBeUndefined()
  })

  it('a VM whose name has no bundle is 409', async () => {
    setup()
    vms = [{ ...VM, state: 'running', creator: LUIS }]
    const res = await recreate({ haven_api_key: 'hk-new' }, as(LUIS))
    expect([res.status, await res.json()]).toEqual([409, { error: 'the vm has no bundle' }])
    expect(upstream()).toBeUndefined()
  })

  it('needs haven_api_key', async () => {
    setup()
    await running()
    for (const json of [{}, { github_token: GITHUB }, { haven_api_key: ' ' }]) {
      const res = await recreate(json, as(LUIS))
      expect([res.status, await res.json()]).toEqual([400, { error: 'haven_api_key is required' }])
    }
    expect(upstream()).toBeUndefined()
  })

  it('a missing ZOOID_COMMIT is 503', async () => {
    setup({ zooidCommit: undefined })
    await running()
    expect((await recreate({ haven_api_key: 'hk-new' }, as(LUIS))).status).toBe(503)
    expect(upstream()).toBeUndefined()
  })
})

describe('secrets', () => {
  it('never reach a log or a response (RF5)', async () => {
    const texts: string[] = []
    setup()
    texts.push(await (await create(body())).text())
    api.fake.failOnce('POST', /\/join\//, 500)
    texts.push(await (await create(body({ agent: 'p2', name: 'lima2' }))).text())
    api.controlPlane.on('POST', '/v1/vms', jsonResponse(502, { error: 'ec2 failed' }))
    record('p3', 'scout', null, ANA)
    texts.push(await (await create(body({ agent: 'p3', name: 'lima3' }))).text())
    const logged = logSpies.flatMap((spy) => spy.mock.calls)
    expect(logged.length).toBeGreaterThan(0)
    const seen = JSON.stringify([...texts, ...logged])
    expect(seen).not.toContain(HAVEN)
    expect(seen).not.toContain(GITHUB)
  })
})
