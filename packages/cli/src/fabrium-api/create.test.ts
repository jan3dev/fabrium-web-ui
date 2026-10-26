import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseCreateRequest } from './create.js'
import type { ApiError } from './errors.js'
import { COMMIT, createTestApi, jsonResponse } from './test-api.js'

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
  name: 'lima',
  instance_type: 't3a.medium',
  agent: { mode: 'new', name: 'echo', persona: 'Reviewer', project: 'Fabrium' },
  haven_api_key: HAVEN,
  github_token: GITHUB,
  ...over,
})

let api: ReturnType<typeof createTestApi>
let logSpies: { mock: { calls: unknown[][] } }[]
beforeEach(() => {
  logSpies = [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
  ]
})
function setup(overrides: Parameters<typeof createTestApi>[0] = {}) {
  api = createTestApi(overrides)
  api.controlPlane.on('POST', '/v1/vms', jsonResponse(201, VM))
  api.controlPlane.on('GET', '/v1/vms', jsonResponse(200, []))
  return api
}
const create = (json: unknown, token?: string | null) => api.request('POST', '/vms', { json, token })
const upstreamCreate = () =>
  api.controlPlane.requests.find((r) => r.method === 'POST' && r.path === '/v1/vms')
    ?.body as { name: string; instance_type?: string; bootstrap: { files: { path: string; content: string; mode: string; owner: string }[]; script: string } }

afterEach(() => {
  api?.cleanup()
  vi.restoreAllMocks()
})

describe('configuration', () => {
  it.each([
    ['FABRIUM_HAVEN_MODEL is not set', { havenModel: undefined }],
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

  it('needs the admin role', async () => {
    setup()
    expect((await create(body(), null)).status).toBe(401)
    expect((await create(body(), api.memberToken)).status).toBe(403)
    expect(api.controlPlane.requests).toEqual([])
  })
})

describe('validation', () => {
  const longText = 'x'.repeat(201)
  it.each([
    ['an uppercase name', { name: 'Lima' }],
    ['a name that starts with a hyphen', { name: '-x' }],
    ['a name of 64 characters', { name: 'a'.repeat(64) }],
    ['the name zooid', { name: 'zooid' }],
    ['no name', { name: undefined }],
    ['no agent', { agent: undefined }],
    ['an unknown agent mode', { agent: { mode: 'other' } }],
    ['an agent name that starts with a digit', { agent: { mode: 'new', name: '1abc' } }],
    ['an agent name of 33 characters', { agent: { mode: 'new', name: 'a'.repeat(33) } }],
    ['a new agent without a name', { agent: { mode: 'new' } }],
    ['a persona that is not a string', { agent: { mode: 'new', name: 'echo', persona: 5 } }],
    ['a persona of 201 characters', { agent: { mode: 'new', name: 'echo', persona: longText } }],
    ['a project that is not a string', { agent: { mode: 'new', name: 'echo', project: {} } }],
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

// configure-agent.sh stores each secret as KEY=value in secrets.env and refuses what that file cannot hold.
// The API must refuse the same values, or the VM stops at its first boot. This runs the check of the script itself.
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
        name: 'lima',
        agent: { mode: 'new', name: 'echo' },
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

describe('a new agent', () => {
  it('creates the VM and returns it with the agent id', async () => {
    setup()
    const res = await create(body())
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ...VM, agent_id: '@lima.echo:example.org' })

    const sent = upstreamCreate()
    expect(Object.keys(sent).sort()).toEqual(['bootstrap', 'instance_type', 'name'])
    expect(sent.name).toBe('lima')
    expect(sent.instance_type).toBe('t3a.medium')
    expect(sent.bootstrap.files.map((f) => [f.path, f.owner, f.mode])).toEqual([
      ['/home/ubuntu/zooid/.env', 'ubuntu', '600'],
      ['/home/ubuntu/zooid/workforce/zooid.yaml', 'ubuntu', '600'],
      ['/run/fabrium-agent-secrets.env', 'ubuntu', '600'],
    ])
    const [env, yaml, secrets] = sent.bootstrap.files
    expect(env?.content).toBe(readFileSync(join(api.workstationsDir, 'lima', '.env'), 'utf8'))
    expect(yaml?.content).toBe(
      readFileSync(join(api.workstationsDir, 'lima', 'workforce', 'zooid.yaml'), 'utf8'),
    )
    expect(secrets?.content).toBe(
      `HAVEN_API_KEY='${HAVEN}'\nHAVEN_MODEL='glm-5-3'\nGH_TOKEN='${GITHUB}'\n`,
    )
    expect(sent.bootstrap.script).toContain(`provision.sh --ref ${COMMIT}'`)
  })

  it('omits instance_type and GH_TOKEN when they are absent or empty', async () => {
    setup()
    await create(body({ instance_type: undefined, github_token: '' }))
    const sent = upstreamCreate()
    expect(Object.keys(sent).sort()).toEqual(['bootstrap', 'name'])
    expect(sent.bootstrap.files[2]?.content).toBe(`HAVEN_API_KEY='${HAVEN}'\nHAVEN_MODEL='glm-5-3'\n`)
  })

  it('trims whitespace around the secrets', async () => {
    setup()
    await create(body({ haven_api_key: `  ${HAVEN}\n`, github_token: ` ${GITHUB} ` }))
    expect(upstreamCreate().bootstrap.files[2]?.content).toBe(
      `HAVEN_API_KEY='${HAVEN}'\nHAVEN_MODEL='glm-5-3'\nGH_TOKEN='${GITHUB}'\n`,
    )
  })

  it('refuses a name that is a Matrix user with 409 before any write', async () => {
    setup()
    const res = await create(body({ name: 'ann' }))
    expect(res.status).toBe(409)
    expect(api.controlPlane.requests).toEqual([])
    expect(api.fake.messages).toEqual([])
  })

  it('answers 502 with the step when admission fails, and creates no VM', async () => {
    setup()
    api.fake.failOnce('POST', /\/join\//, 500)
    const res = await create(body())
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ step: 'join', error: expect.any(String) })
    expect(api.controlPlane.requests.filter((r) => r.method === 'POST')).toEqual([])
  })

  it('continues from the failed step when the same body is sent again', async () => {
    setup()
    api.fake.failOnce('POST', /\/join\//, 500)
    await create(body())
    const env = readFileSync(join(api.workstationsDir, 'lima', '.env'), 'utf8')
    expect((await create(body())).status).toBe(201)
    expect(readFileSync(join(api.workstationsDir, 'lima', '.env'), 'utf8')).toBe(env)
    expect(api.fake.messages.filter((m) => m.roomId === api.fake.adminRoomId)).toHaveLength(1)
  })

  it.each([
    [409, { error: 'name in use' }],
    [502, { error: 'ec2 failed' }],
  ])('passes a control plane %i through and keeps the agent free', async (status, expected) => {
    setup()
    api.controlPlane.on('POST', '/v1/vms', jsonResponse(status, expected))
    const res = await create(body())
    expect(res.status).toBe(status)
    expect(await res.json()).toEqual(expected)
    const agents = await (await api.request('GET', '/agents')).json()
    expect(agents).toEqual([
      expect.objectContaining({ workstation: 'lima', free: true, preset: 'opencode' }),
    ])
  })

  it('relays a control plane answer that is not JSON (413 text)', async () => {
    setup()
    api.controlPlane.on(
      'POST',
      '/v1/vms',
      new Response('Payload Too Large', { status: 413, headers: { 'content-type': 'text/plain' } }),
    )
    const res = await create(body({ name: 'lima2' }))
    expect([res.status, await res.text()]).toEqual([413, 'Payload Too Large'])
  })
})

describe('an existing agent', () => {
  const existing = (over: Record<string, unknown> = {}) =>
    body({ agent: { mode: 'existing', name: 'lima' }, instance_type: undefined, ...over })

  it('moves a free agent to a new VM without touching Matrix', async () => {
    setup()
    await api.bundle('lima', 'echo')
    const matrixCalls = api.fake.calls.length
    const res = await create(existing())
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ ...VM, agent_id: '@lima.echo:example.org' })
    expect(upstreamCreate().bootstrap.files[0]?.content).toBe(
      readFileSync(join(api.workstationsDir, 'lima', '.env'), 'utf8'),
    )
    expect(api.fake.messages).toEqual([])
    expect(api.fake.calls.slice(matrixCalls).some((c) => c.method !== 'GET')).toBe(false)
  })

  it('takes the workstation from name and ignores agent.name', async () => {
    setup()
    await api.bundle('lima', 'echo')
    expect((await create(existing({ agent: { mode: 'existing' } }))).status).toBe(201)
    expect((await create(existing({ agent: { mode: 'existing', name: 'whatever' } }))).status).toBe(201)
  })

  it.each([
    ['a VM has the name', async () => {
      await api.bundle('lima', 'echo')
      api.controlPlane.on('GET', '/v1/vms', jsonResponse(200, [VM]))
    }],
    ['the preset is not opencode', async () => {
      await api.bundle('lima', 'echo')
      writeFileSync(
        join(api.workstationsDir, 'lima', 'workforce', 'zooid.yaml'),
        "agents:\n  echo:\n    acp: { command: sh, args: ['-c', 'true'] }\n",
      )
    }],
    ['there is no bundle', async () => {}],
  ])('answers 400 when %s', async (_name, arrange) => {
    setup()
    await arrange()
    const res = await create(existing())
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'lima is not a free agent' })
    expect(api.controlPlane.requests.filter((r) => r.method === 'POST')).toEqual([])
  })

  it('passes a failure of the VM list through and creates nothing', async () => {
    setup()
    await api.bundle('lima', 'echo')
    api.controlPlane.on('GET', '/v1/vms', jsonResponse(502, { error: 'ec2 failed' }))
    const res = await create(existing())
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'ec2 failed' })
    expect(api.controlPlane.requests.filter((r) => r.method === 'POST')).toEqual([])
  })
})

describe('secrets', () => {
  it('never reach a log or a response (RF5)', async () => {
    const texts: string[] = []
    setup()
    texts.push(await (await create(body())).text())
    api.fake.failOnce('POST', /\/join\//, 500)
    texts.push(await (await create(body({ name: 'lima2', agent: { mode: 'new', name: 'two' } }))).text())
    api.controlPlane.on('POST', '/v1/vms', jsonResponse(502, { error: 'ec2 failed' }))
    texts.push(await (await create(body({ name: 'lima3', agent: { mode: 'new', name: 'three' } }))).text())
    const logged = logSpies.flatMap((spy) => spy.mock.calls)
    expect(logged.length).toBeGreaterThan(0)
    const seen = JSON.stringify([...texts, ...logged])
    expect(seen).not.toContain(HAVEN)
    expect(seen).not.toContain(GITHUB)
  })
})
