import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  MARKER,
  bundleAgent,
  ensureBundle,
  listBundles,
  readBundle,
  renderEnv,
  renderRegistration,
  renderYaml,
  withServer,
  type BundleSpec,
} from './bundle.js'

const spec: BundleSpec = {
  workstation: 'lima',
  agent: 'echo',
  serverName: 'example.org',
  homeserverUrl: 'https://chat.example.org',
  space: 'dev',
  rooms: ['#general'],
}
const tokens = { asToken: 'a'.repeat(64), hsToken: 'b'.repeat(64) }

const deploy = (path: string) =>
  readFileSync(new URL(`../../../../deploy/${path}`, import.meta.url), 'utf8')
// `${VAR}` for the listed variables only, as render_template in deploy/lib/common.sh does.
const fill = (text: string, vars: Record<string, string>) =>
  text.replace(/\$\{(\w+)\}/g, (match, name: string) => vars[name] ?? match)
const withoutComments = (text: string) =>
  text.split('\n').filter((line) => !line.trimStart().startsWith('#'))

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fabrium-bundle-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('renderers', () => {
  it('renders .env in the format of add-workstation.sh', () => {
    expect(renderEnv(spec, tokens)).toBe(
      [
        '# Agent VM environment for workstation lima. Written by the zooid daemon (VM management API).',
        '# Copy to the VM as ~/zooid/.env (mode 600). Format rules: deploy/README.md.',
        'WORKSTATION=lima',
        'AGENT_NAME=echo',
        'SERVER_NAME=example.org',
        'HOMESERVER_URL=https://chat.example.org',
        'WORKFORCE_SPACE=dev',
        `MATRIX_AS_TOKEN=${tokens.asToken}`,
        `MATRIX_HS_TOKEN=${tokens.hsToken}`,
        '',
        '# Agent secrets go in ~/zooid/secrets.env on the VM, not here: a new copy of',
        '# the bundle replaces this file.',
        '',
      ].join('\n'),
    )
  })

  it('renders zooid.yaml like deploy/agent-vm/zooid.yaml.example', () => {
    const expected = fill(deploy('agent-vm/zooid.yaml.example'), {
      WORKSTATION: 'lima',
      SERVER_NAME: 'example.org',
      WORKFORCE_SPACE: 'dev',
      AGENT_NAME: 'echo',
      AGENT_ACP: "{ preset: 'opencode' }",
      AGENT_ROOMS: "'#general:example.org'",
    })
    const actual = renderYaml(spec)
    expect(withoutComments(actual)).toEqual(withoutComments(expected))
    expect(parse(actual)).toEqual(parse(expected))
    // zooid reads the homeserver URL from the VM environment at run time.
    expect(actual).toContain('homeserver: "${HOMESERVER_URL}"')
  })

  it('renders the registration like deploy/templates/registration-workstation.yaml', () => {
    const expected = fill(deploy('templates/registration-workstation.yaml'), {
      WORKSTATION: 'lima',
      WS_AS_TOKEN: tokens.asToken,
      WS_HS_TOKEN: tokens.hsToken,
      SERVER_NAME_RE: 'example\\.org',
    })
    const actual = renderRegistration(spec, tokens)
    expect(withoutComments(actual)).toEqual(withoutComments(expected))
    expect(parse(actual)).toMatchObject({
      id: 'lima',
      url: null,
      sender_localpart: 'lima',
      namespaces: { users: [{ exclusive: true, regex: '@lima\\..*:example\\.org' }] },
    })
  })

  it('adds the server name to room aliases and keeps full aliases and ids', () => {
    expect(withServer('#general', 'example.org')).toBe('#general:example.org')
    expect(withServer('#a:other.org', 'example.org')).toBe('#a:other.org')
    expect(withServer('!abc:example.org', 'example.org')).toBe('!abc:example.org')
  })

  it('writes every room of the spec into zooid.yaml', () => {
    const yaml = renderYaml({ ...spec, rooms: ['#general', '#dev:other.org'] })
    expect(yaml).toContain("rooms: ['#general:example.org', '#dev:other.org']")
  })
})

describe('ensureBundle', () => {
  const dirOf = () => join(root, 'workstations', 'lima')

  it('creates the marker, .env, and zooid.yaml with private modes', async () => {
    const bundle = await ensureBundle(dirOf(), spec)
    expect(bundle.agentId).toBe('@lima.echo:example.org')
    expect(bundle.asToken).toMatch(/^[0-9a-f]{64}$/)
    expect(bundle.hsToken).toMatch(/^[0-9a-f]{64}$/)
    expect(bundle.asToken).not.toBe(bundle.hsToken)
    expect(readFileSync(join(dirOf(), '.env'), 'utf8')).toBe(bundle.env)
    expect(bundle.env).toBe(renderEnv(spec, bundle))
    expect(readFileSync(join(dirOf(), 'workforce', 'zooid.yaml'), 'utf8')).toBe(renderYaml(spec))
    expect(readFileSync(join(dirOf(), MARKER), 'utf8')).toContain('appservices unregister lima')
    expect(statSync(dirOf()).mode & 0o777).toBe(0o700)
    expect(statSync(join(root, 'workstations')).mode & 0o777).toBe(0o700)
    expect(statSync(join(dirOf(), '.env')).mode & 0o777).toBe(0o600)
  })

  it('reuses the tokens of an existing .env', async () => {
    const first = await ensureBundle(dirOf(), spec)
    const second = await ensureBundle(dirOf(), spec)
    expect(second.asToken).toBe(first.asToken)
    expect(second.hsToken).toBe(first.hsToken)
    expect(readFileSync(join(dirOf(), '.env'), 'utf8')).toBe(first.env)
  })

  it('completes a bundle that lost zooid.yaml without new tokens', async () => {
    const first = await ensureBundle(dirOf(), spec)
    rmSync(join(dirOf(), 'workforce', 'zooid.yaml'))
    const second = await ensureBundle(dirOf(), spec)
    expect(second.asToken).toBe(first.asToken)
    expect(readFileSync(join(dirOf(), 'workforce', 'zooid.yaml'), 'utf8')).toBe(renderYaml(spec))
  })

  it('fails when .env has only one of the two tokens', async () => {
    mkdirSync(dirOf(), { recursive: true })
    writeFileSync(join(dirOf(), '.env'), 'MATRIX_AS_TOKEN=x\n')
    await expect(ensureBundle(dirOf(), spec)).rejects.toThrow(/MATRIX_HS_TOKEN/)
  })
})

describe('readBundle and listBundles', () => {
  it('reads a bundle with its summary', async () => {
    const dir = join(root, 'lima')
    const made = await ensureBundle(dir, spec)
    const read = await readBundle(dir)
    expect(read).toEqual({
      env: made.env,
      yaml: made.yaml,
      summary: {
        workstation: 'lima',
        agent: 'echo',
        agentId: '@lima.echo:example.org',
        preset: 'opencode',
      },
    })
  })

  it('reads preset null for an acp without a preset', async () => {
    const dir = join(root, 'lima')
    await ensureBundle(dir, spec)
    writeFileSync(
      join(dir, 'workforce', 'zooid.yaml'),
      "agents:\n  echo:\n    acp: { command: sh, args: ['-c', 'true'] }\n",
    )
    expect((await readBundle(dir))?.summary.preset).toBeNull()
  })

  it('reads preset null for a zooid.yaml that is not YAML', async () => {
    const dir = join(root, 'lima')
    await ensureBundle(dir, spec)
    writeFileSync(join(dir, 'workforce', 'zooid.yaml'), 'agents: [unclosed\n')
    expect((await readBundle(dir))?.summary.preset).toBeNull()
  })

  it.each([
    ['no .env', (dir: string) => rmSync(join(dir, '.env'))],
    ['no zooid.yaml', (dir: string) => rmSync(join(dir, 'workforce', 'zooid.yaml'))],
    ['no AGENT_NAME', (dir: string) => writeFileSync(join(dir, '.env'), 'SERVER_NAME=example.org\n')],
    ['no SERVER_NAME', (dir: string) => writeFileSync(join(dir, '.env'), 'AGENT_NAME=echo\n')],
  ])('returns null for a bundle with %s', async (_name, damage) => {
    const dir = join(root, 'lima')
    await ensureBundle(dir, spec)
    damage(dir)
    expect(await readBundle(dir)).toBeNull()
  })

  it('lists bundles sorted by workstation and skips what is not a bundle', async () => {
    const workstations = join(root, 'workstations')
    await ensureBundle(join(workstations, 'b-two'), { ...spec, workstation: 'b-two', agent: 'bob' })
    await ensureBundle(join(workstations, 'a-one'), { ...spec, workstation: 'a-one', agent: 'amy' })
    mkdirSync(join(workstations, 'empty'))
    writeFileSync(join(workstations, 'README'), 'not a bundle')
    expect((await listBundles(workstations)).map((b) => [b.workstation, b.agentId])).toEqual([
      ['a-one', '@a-one.amy:example.org'],
      ['b-two', '@b-two.bob:example.org'],
    ])
  })

  it('reads the agent of a .env, also from a bundle without zooid.yaml', async () => {
    const dir = join(root, 'lima')
    await ensureBundle(dir, spec)
    rmSync(join(dir, 'workforce', 'zooid.yaml'))
    expect(await bundleAgent(dir)).toBe('echo')
    expect(await bundleAgent(join(root, 'missing'))).toBeUndefined()
  })

  it('lists nothing when the directory does not exist', async () => {
    expect(await listBundles(join(root, 'missing'))).toEqual([])
  })
})
