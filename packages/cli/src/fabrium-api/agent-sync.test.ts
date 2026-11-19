import { execFile, execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = resolve(__dirname, '../../../../deploy/agent-vm/fabrium-agent-sync')
const TOKEN = 'vm-secret-0123'

interface Reply {
  status: number
  body: string
}
interface Agent {
  name: string
  description: string
  model: string
  rooms: string[]
  senders?: unknown
}

const reviewer: Agent = {
  name: 'reviewer',
  description: 'You are an expert software engineer who does code reviews.',
  model: 'glm-5-3',
  rooms: ['#general:example.org'],
}
const tester: Agent = { name: 'tester', description: '', model: 'glm-5-3', rooms: ['#general:example.org', '!ops:example.org'] }
const list = (...agents: unknown[]): Reply => ({ status: 200, body: JSON.stringify({ agents }) })

describe('fabrium-agent-sync', () => {
  let root: string
  let server: Server
  let reply: Reply
  let auth: string[]

  const zooid = () => join(root, 'home/ubuntu/zooid')
  const workforce = (...parts: string[]) => join(zooid(), 'workforce', ...parts)
  const read = (...parts: string[]) => readFileSync(workforce(...parts), 'utf8')

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'agent-sync-'))
    auth = []
    reply = list(reviewer, tester)
    server = createServer((req, res) => {
      if (req.url === '/v1/vm/agents') auth.push(String(req.headers.authorization))
      const r = req.url === '/v1/vm/agents' ? reply : { status: 404, body: '' }
      res.writeHead(r.status, { 'content-type': 'application/json' }).end(r.body)
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const { port } = server.address() as AddressInfo
    mkdirSync(join(root, 'etc/fabrium'), { recursive: true })
    writeFileSync(join(root, 'etc/fabrium/vm-token'), `${TOKEN}\n`)
    writeFileSync(join(root, 'etc/fabrium/control-plane-url'), `http://127.0.0.1:${port}\n`)
    mkdirSync(zooid(), { recursive: true })
    writeFileSync(
      join(zooid(), '.env'),
      [
        'WORKSTATION=lima',
        'SERVER_NAME=example.org',
        'HOMESERVER_URL=https://chat.example.org',
        'WORKFORCE_SPACE=dev',
        'MATRIX_AS_TOKEN=as-token',
        'MATRIX_HS_TOKEN=hs-token',
        '',
      ].join('\n'),
    )
  })
  afterEach(() => {
    server.close()
    rmSync(root, { recursive: true, force: true })
  })

  /** Runs the script. Exit status, stdout and stderr; never throws. */
  function sync(args: string[] = [], env: Record<string, string> = {}) {
    return new Promise<{ code: number; out: string; err: string }>((done) => {
      execFile(
        'bash',
        [SCRIPT, ...args],
        { cwd: root, env: { PATH: process.env.PATH, FABRIUM_AGENT_SYNC_DIR: root, ...env } },
        (error, out, err) => done({ code: error ? Number(error.code ?? 1) : 0, out, err }),
      )
    })
  }
  const lines = (out: string) => out.trim().split('\n')

  it('writes zooid.yaml and the files of each agent', async () => {
    const { code, out } = await sync()
    expect(code).toBe(0)
    expect(JSON.parse(read('zooid.yaml'))).toEqual({
      workstation: 'lima',
      runtime: 'local',
      transports: {
        matrix: {
          homeserver: '${HOMESERVER_URL}',
          mode: 'client',
          sender_localpart: 'lima',
          user_namespace: '@lima\\..*:example.org',
          space: 'dev',
        },
      },
      agents: {
        reviewer: {
          acp: { preset: 'opencode' },
          matrix: { display_name: 'reviewer', rooms: ['#general:example.org'], trigger: 'mention' },
        },
        tester: {
          acp: { preset: 'opencode' },
          matrix: { display_name: 'tester', rooms: ['#general:example.org', '!ops:example.org'], trigger: 'mention' },
        },
      },
    })
    expect(statSync(workforce('zooid.yaml')).mode & 0o777).toBe(0o644)
    expect(read('agents/reviewer/AGENTS.md')).toBe(`${reviewer.description}\n`)
    // An empty description gives an empty file.
    expect(read('agents/tester/AGENTS.md')).toBe('')
    const opencode = JSON.parse(read('agents/reviewer/opencode.json'))
    expect(opencode).toMatchObject({
      $schema: 'https://opencode.ai/config.json',
      model: 'haven/glm-5-3',
      provider: { haven: { name: 'Haven', options: { apiKey: '{env:HAVEN_API_KEY}' }, models: { 'glm-5-3': { tool_call: true } } } },
      permission: { webfetch: 'allow' },
    })
    expect(lines(out)).toEqual([
      `write: ${workforce('zooid.yaml')}`,
      `write: ${workforce('agents/reviewer/AGENTS.md')}`,
      `write: ${workforce('agents/reviewer/opencode.json')}`,
      `write: ${workforce('agents/tester/AGENTS.md')}`,
      `write: ${workforce('agents/tester/opencode.json')}`,
      'restart: fabrium-agent',
    ])
  })

  it('sends the VM token in the Authorization header and not in the arguments', async () => {
    // A curl first on the PATH that logs its arguments, then runs the real one.
    const bin = join(root, 'bin')
    mkdirSync(bin)
    const realCurl = (await new Promise<string>((done) => execFile('bash', ['-c', 'command -v curl'], (_e, o) => done(o)))).trim()
    writeFileSync(join(bin, 'curl'), `#!/bin/bash\nprintf '%s\\n' "$@" >>"${join(root, 'curl-args')}"\nexec ${realCurl} "$@"\n`)
    chmodSync(join(bin, 'curl'), 0o755)
    const { code } = await sync([], { PATH: `${bin}:${process.env.PATH}` })
    expect(code).toBe(0)
    expect(auth).toEqual([`Bearer ${TOKEN}`])
    expect(readFileSync(join(root, 'curl-args'), 'utf8')).not.toContain(TOKEN)
  })

  it('a second run changes nothing', async () => {
    await sync()
    const files = ['zooid.yaml', 'agents/reviewer/AGENTS.md', 'agents/reviewer/opencode.json']
    const mtimes = files.map((f) => statSync(workforce(f)).mtimeMs)
    const { code, out } = await sync()
    expect([code, lines(out)]).toEqual([0, ['no change']])
    expect(files.map((f) => statSync(workforce(f)).mtimeMs)).toEqual(mtimes)
  })

  it('a new model changes only that opencode.json', async () => {
    await sync()
    reply = list(reviewer, { ...tester, model: 'kimi-k2' })
    const { out } = await sync()
    expect(lines(out)).toEqual([`write: ${workforce('agents/tester/opencode.json')}`, 'restart: fabrium-agent'])
    expect(JSON.parse(read('agents/tester/opencode.json')).model).toBe('haven/kimi-k2')
  })

  it('keeps the keys of opencode.json that it does not own', async () => {
    mkdirSync(workforce('agents/reviewer'), { recursive: true })
    writeFileSync(workforce('agents/reviewer/opencode.json'), '{"permission":{"bash":"ask"},"model":"old"}\n')
    await sync()
    expect(JSON.parse(read('agents/reviewer/opencode.json'))).toMatchObject({
      model: 'haven/glm-5-3',
      permission: { bash: 'ask', webfetch: 'allow' },
    })
  })

  it('an agent that is gone loses its directory', async () => {
    await sync()
    // A directory outside the name rule is not ours.
    mkdirSync(workforce('agents/Notes'))
    reply = list(reviewer)
    const { out } = await sync()
    expect(lines(out)).toEqual([
      `write: ${workforce('zooid.yaml')}`,
      `remove: ${workforce('agents/tester')}`,
      'restart: fabrium-agent',
    ])
    expect(existsSync(workforce('agents/tester'))).toBe(false)
    expect(existsSync(workforce('agents/Notes'))).toBe(true)
    expect(Object.keys(JSON.parse(read('zooid.yaml')).agents)).toEqual(['reviewer'])
  })

  const snapshot = () =>
    ['zooid.yaml', 'agents/reviewer/AGENTS.md', 'agents/reviewer/opencode.json', 'agents/tester/AGENTS.md'].map((f) => read(f))

  it.each([
    ['a 404', { status: 404, body: '{"error":"not found"}' }],
    ['a 500', { status: 500, body: '' }],
    ['a body that is not JSON', { status: 200, body: '<html>' }],
    ['a list that is not under agents', { status: 200, body: JSON.stringify([reviewer]) }],
    ['an agent without rooms', list({ ...reviewer, rooms: undefined })],
    ['a model that is not a string', list({ ...reviewer, model: 5 })],
  ])('%s keeps every file', async (_case, bad) => {
    await sync()
    const before = snapshot()
    reply = bad
    const { code, out } = await sync()
    expect([code, out]).toEqual([0, ''])
    expect(snapshot()).toEqual(before)
    expect((await sync(['--require'])).code).toBe(1)
  })

  it('a failed request keeps every file', async () => {
    await sync()
    const before = snapshot()
    writeFileSync(join(root, 'etc/fabrium/control-plane-url'), 'http://127.0.0.1:1\n')
    const { code, out } = await sync()
    expect([code, out]).toEqual([0, ''])
    expect(snapshot()).toEqual(before)
  })

  it('an empty list keeps every file', async () => {
    await sync()
    const before = snapshot()
    reply = list()
    expect(await sync()).toMatchObject({ code: 0, out: '' })
    expect(snapshot()).toEqual(before)
  })

  it('--require exits 1 without a list', async () => {
    reply = list()
    expect((await sync(['--require'])).code).toBe(1)
    rmSync(join(root, 'etc/fabrium/vm-token'))
    expect((await sync(['--require'])).code).toBe(1)
    expect((await sync()).code).toBe(0)
    expect(existsSync(workforce())).toBe(false)
  })

  it('--dry-run prints the changes and writes nothing', async () => {
    const { code, out } = await sync(['--dry-run'])
    expect(code).toBe(0)
    expect(lines(out)).toContain(`write: ${workforce('zooid.yaml')}`)
    expect(lines(out).at(-1)).toBe('restart: fabrium-agent')
    expect(existsSync(workforce())).toBe(false)
    await sync()
    reply = list(reviewer)
    expect(lines((await sync(['--dry-run'])).out)).toContain(`remove: ${workforce('agents/tester')}`)
    expect(existsSync(workforce('agents/tester'))).toBe(true)
  })

  it('skips an agent with a bad name and writes the others', async () => {
    // jq's $ also matches before a final line break: a name that ends with one must not pass.
    reply = list({ ...tester, name: '../x' }, { ...tester, name: 'A' }, { ...tester, name: 'ab\n' }, reviewer)
    const { code, out } = await sync()
    expect(code).toBe(0)
    expect(lines(out).filter((l) => l.startsWith('skip:'))).toEqual([
      'skip: "../x": the name breaks the rule ^[a-z][a-z0-9-]{0,31}$',
      'skip: "A": the name breaks the rule ^[a-z][a-z0-9-]{0,31}$',
      'skip: "ab\\n": the name breaks the rule ^[a-z][a-z0-9-]{0,31}$',
    ])
    expect(Object.keys(JSON.parse(read('zooid.yaml')).agents)).toEqual(['reviewer'])
    expect(existsSync(workforce('x'))).toBe(false)
    expect(existsSync(join(zooid(), 'x'))).toBe(false)
  })

  it('skips an agent with a bad room', async () => {
    const bad = [`#it's:example.org`, '#a b:example.org', 'general', '#a:example.org\n', `#${'x'.repeat(255)}`]
    reply = list(reviewer, ...bad.map((room, i) => ({ ...tester, name: `t${i}`, rooms: [room] })))
    const { out } = await sync()
    expect(lines(out).filter((l) => l.startsWith('skip:'))).toEqual(
      bad.map((_, i) => `skip: t${i}: a room breaks the rule of the contracts`),
    )
    expect(Object.keys(JSON.parse(read('zooid.yaml')).agents)).toEqual(['reviewer'])
  })

  it('a skipped agent keeps its directory', async () => {
    await sync()
    reply = list(reviewer, { ...tester, rooms: [`#it's:example.org`] })
    const { out } = await sync()
    expect(lines(out)).toEqual([
      'skip: tester: a room breaks the rule of the contracts',
      `write: ${workforce('zooid.yaml')}`,
      'restart: fabrium-agent',
    ])
    expect(read('agents/tester/AGENTS.md')).toBe('')
    expect(Object.keys(JSON.parse(read('zooid.yaml')).agents)).toEqual(['reviewer'])
  })

  it('a list whose every agent is skipped keeps every file', async () => {
    await sync()
    const before = snapshot()
    reply = list({ ...reviewer, name: 'Bad' })
    const { code, out } = await sync()
    expect([code, lines(out)]).toEqual([0, ['skip: "Bad": the name breaks the rule ^[a-z][a-z0-9-]{0,31}$']])
    expect(snapshot()).toEqual(before)
    expect((await sync(['--require'])).code).toBe(1)
  })

  // Review Focus 5: text that a user typed reaches the VM as data, and nothing runs.
  it('writes a hostile description byte for byte', async () => {
    const description = `Quote " and ' and \` and $(touch pwned) and $HOME and \\ é\n\n`
    const room = '#x$(touch${IFS}pwned)`id`:example.org'
    const model = `m'"$(touch\${IFS}pwned)\`id\``
    reply = list({ ...reviewer, description, model, rooms: [room] }, { ...tester, description: 'no line break' })
    const { code } = await sync()
    expect(code).toBe(0)
    expect(read('agents/reviewer/AGENTS.md')).toBe(description)
    expect(read('agents/tester/AGENTS.md')).toBe('no line break\n')
    expect(JSON.parse(read('agents/reviewer/opencode.json')).model).toBe(`haven/${model}`)
    expect(JSON.parse(read('zooid.yaml')).agents.reviewer.matrix.rooms).toEqual([room])
    for (const dir of [root, zooid(), workforce(), workforce('agents/reviewer'), process.cwd()]) {
      expect(existsSync(join(dir, 'pwned')), dir).toBe(false)
    }
  })

  describe('senders', () => {
    const ana = ['@ana:example.org']
    const yaml = () => JSON.parse(read('zooid.yaml'))

    it('writes senders in the matrix block of an agent that has a list', async () => {
      reply = list({ ...reviewer, senders: ana }, tester)
      expect((await sync()).code).toBe(0)
      expect(yaml().agents.reviewer.matrix).toEqual({
        display_name: 'reviewer',
        rooms: ['#general:example.org'],
        trigger: 'mention',
        senders: ana,
      })
      expect(yaml().agents.tester.matrix).not.toHaveProperty('senders')
    })

    it('writes no senders for null, and for an absent field', async () => {
      reply = list({ ...reviewer, senders: null }, tester)
      expect((await sync()).code).toBe(0)
      expect(yaml().agents.reviewer.matrix).not.toHaveProperty('senders')
      expect(yaml().agents.tester.matrix).not.toHaveProperty('senders')
    })

    it('a second run with senders changes nothing', async () => {
      reply = list({ ...reviewer, senders: ana }, tester)
      await sync()
      expect(lines((await sync()).out)).toEqual(['no change'])
    })

    it('a changed list rewrites zooid.yaml and restarts', async () => {
      reply = list({ ...reviewer, senders: ana }, tester)
      await sync()
      reply = list({ ...reviewer, senders: ['@bo:example.org'] }, tester)
      expect(lines((await sync()).out)).toEqual([`write: ${workforce('zooid.yaml')}`, 'restart: fabrium-agent'])
      expect(yaml().agents.reviewer.matrix.senders).toEqual(['@bo:example.org'])
    })

    it.each([
      ['a string', '@ana:example.org'],
      ['an empty list', []],
      ['21 entries', Array.from({ length: 21 }, (_, i) => `@u${i}:example.org`)],
      ['a non-string entry', [7]],
      ['an entry without @', ['ana:example.org']],
      ['an entry without a server', ['@ana']],
      ['an entry with a space', ['@a na:example.org']],
      ['an entry with a line break', ['@ana:example.org\n@bo:example.org']],
      ['an entry that ends with a line break', ['@ana:example.org\n']],
      ['an entry over 255 bytes', [`@${'a'.repeat(250)}:example.org`]],
      ['an object', { owner: '@ana:example.org' }],
      ['a number', 7],
    ])('skips an agent whose senders is %s', async (_case, senders) => {
      reply = list({ ...reviewer, senders }, tester)
      const { code, out } = await sync()
      expect(code).toBe(0)
      expect(lines(out).filter((l) => l.startsWith('skip:'))).toEqual([
        'skip: reviewer: senders breaks the rule of the contracts',
      ])
      expect(Object.keys(yaml().agents)).toEqual(['tester'])
    })

    it('accepts 20 entries, and a server with a port', async () => {
      const many = [...Array.from({ length: 19 }, (_, i) => `@u${i}:example.org`), '@ana:example.org:8448']
      reply = list({ ...reviewer, senders: many })
      expect((await sync()).code).toBe(0)
      expect(yaml().agents.reviewer.matrix.senders).toEqual(many)
    })

    it('a skipped senders never writes the agent without a filter', async () => {
      reply = list({ ...reviewer, senders: ana }, tester)
      await sync()
      const before = snapshot()
      reply = list({ ...reviewer, senders: [] })
      const { code, out } = await sync()
      expect([code, lines(out)]).toEqual([0, ['skip: reviewer: senders breaks the rule of the contracts']])
      expect(snapshot()).toEqual(before)
      expect(yaml().agents.reviewer.matrix.senders).toEqual(ana)
    })

    it('writes a hostile senders entry byte for byte or skips it, and runs nothing', async () => {
      const passes = '@a:b$(touch${IFS}pwned)`id`'
      reply = list({ ...reviewer, senders: [passes] }, { ...tester, senders: ['@a:b$(touch pwned)'] })
      const { code, out } = await sync()
      expect(code).toBe(0)
      expect(yaml().agents.reviewer.matrix.senders).toEqual([passes])
      expect(lines(out)).toContain('skip: tester: senders breaks the rule of the contracts')
      for (const dir of [root, zooid(), workforce(), workforce('agents/reviewer'), process.cwd()]) {
        expect(existsSync(join(dir, 'pwned')), dir).toBe(false)
      }
    })
  })

  // The agent of the test turn of configure-agent.sh on these files: this runs the script's own block.
  it('configure-agent.sh tests the first agent when the agent of FABRIUM_AGENT left the VM', async () => {
    reply = list(tester, reviewer)
    await sync()
    const script = readFileSync(resolve(__dirname, '../../../../deploy/agent-vm/configure-agent.sh'), 'utf8')
    const block = /\nif \[ "\$MANAGED" -eq 1 \]; then\n {2}AGENT_NAME=[\s\S]*?\nfi\n/.exec(script)?.[0]
    expect(block).toBeDefined()
    const agentOf = (env: Record<string, string>) =>
      execFileSync(
        'bash',
        ['-c', `set -euo pipefail\ndie() { printf 'DIE %s' "$*"; exit 0; }\nMANAGED=1\n${block}printf %s "$AGENT_NAME"`],
        { encoding: 'utf8', env: { PATH: process.env.PATH, ZOOID_HOME: zooid(), YAML_FILE: workforce('zooid.yaml'), ...env } },
      )
    expect(agentOf({ FABRIUM_AGENT: 'tester' })).toBe('tester')
    // Deleted before the setup reached the script: the sync wrote only the others.
    expect(agentOf({ FABRIUM_AGENT: 'watcher' })).toBe('reviewer')
    expect(agentOf({})).toBe('reviewer')
    expect(agentOf({ FABRIUM_AGENT: 'x/../tester' })).toMatch(/^DIE /)
  })
})
