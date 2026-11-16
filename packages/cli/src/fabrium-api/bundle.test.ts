import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  MARKER,
  ensureVmBundle,
  listBundleNames,
  readBundleEnv,
  removeBundle,
  renderEnv,
  renderRegistration,
  withServer,
  type VmBundleSpec,
} from './bundle.js'

const spec: VmBundleSpec = {
  workstation: 'lima',
  serverName: 'example.org',
  homeserverUrl: 'https://chat.example.org',
  space: 'dev',
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
})

describe('renderEnv previews', () => {
  it('adds FABRIUM_PREVIEWS only when the central box has previews', () => {
    expect(renderEnv(spec, tokens)).not.toContain('FABRIUM_PREVIEWS')
    expect(renderEnv({ ...spec, previews: true }, tokens)).toContain('\nFABRIUM_PREVIEWS=true\n')
  })
})

describe('ensureVmBundle', () => {
  const dirOf = () => join(root, 'workstations', 'lima')

  it('creates the marker and .env with private modes', async () => {
    const bundle = await ensureVmBundle(dirOf(), spec)
    expect(bundle.asToken).toMatch(/^[0-9a-f]{64}$/)
    expect(bundle.hsToken).toMatch(/^[0-9a-f]{64}$/)
    expect(bundle.asToken).not.toBe(bundle.hsToken)
    expect(readFileSync(join(dirOf(), '.env'), 'utf8')).toBe(bundle.env)
    expect(bundle.env).toBe(renderEnv(spec, bundle))
    expect(readFileSync(join(dirOf(), MARKER), 'utf8')).toContain('appservices unregister lima')
    expect(statSync(dirOf()).mode & 0o777).toBe(0o700)
    expect(statSync(join(root, 'workstations')).mode & 0o777).toBe(0o700)
    expect(statSync(join(dirOf(), '.env')).mode & 0o777).toBe(0o600)
  })

  it('fails when .env has only one of the two tokens', async () => {
    mkdirSync(dirOf(), { recursive: true })
    writeFileSync(join(dirOf(), '.env'), 'MATRIX_AS_TOKEN=x\n')
    await expect(ensureVmBundle(dirOf(), spec)).rejects.toThrow(/MATRIX_HS_TOKEN/)
  })
})

describe('the bundle of a VM name', () => {
  const vmSpec: VmBundleSpec = {
    workstation: 'lima',
    serverName: 'example.org',
    homeserverUrl: 'https://chat.example.org',
    space: 'dev',
  }
  const dirOf = (name = 'lima') => join(root, 'workstations', name)

  it('the .env has the six keys of the contracts and no AGENT_NAME', async () => {
    const bundle = await ensureVmBundle(dirOf(), vmSpec)
    const keys = bundle.env.split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => l.split('=')[0])
    expect(keys).toEqual([
      'WORKSTATION',
      'SERVER_NAME',
      'HOMESERVER_URL',
      'WORKFORCE_SPACE',
      'MATRIX_AS_TOKEN',
      'MATRIX_HS_TOKEN',
    ])
    expect(bundle.env).toContain(`MATRIX_AS_TOKEN=${bundle.asToken}\n`)
    expect(readFileSync(join(dirOf(), '.env'), 'utf8')).toBe(bundle.env)
    expect(statSync(join(dirOf(), '.env')).mode & 0o777).toBe(0o600)
    expect(statSync(dirOf()).mode & 0o777).toBe(0o700)
  })

  it('the bundle has no workforce directory and no .creator file', async () => {
    await ensureVmBundle(dirOf(), vmSpec)
    expect(readdirSync(dirOf()).sort()).toEqual(['.env', MARKER])
  })

  it('a second ensureVmBundle keeps the tokens', async () => {
    const first = await ensureVmBundle(dirOf(), vmSpec)
    const second = await ensureVmBundle(dirOf(), vmSpec)
    expect([second.asToken, second.hsToken, second.env]).toEqual([first.asToken, first.hsToken, first.env])
  })

  it('readBundleEnv is null without the marker', async () => {
    const made = await ensureVmBundle(dirOf(), vmSpec)
    expect(await readBundleEnv(dirOf())).toBe(made.env)
    // A directory of deploy/add-workstation.sh has no marker.
    rmSync(join(dirOf(), MARKER))
    expect(await readBundleEnv(dirOf())).toBeNull()
    expect(await readBundleEnv(dirOf('missing'))).toBeNull()
  })

  it('listBundleNames lists the names with the marker, sorted', async () => {
    await ensureVmBundle(dirOf('lima'), vmSpec)
    await ensureVmBundle(dirOf('cusco'), { ...vmSpec, workstation: 'cusco' })
    mkdirSync(dirOf('legacy'))
    writeFileSync(join(dirOf('legacy'), '.env'), 'WORKSTATION=legacy\n')
    expect(await listBundleNames(join(root, 'workstations'))).toEqual(['cusco', 'lima'])
    expect(await listBundleNames(join(root, 'missing'))).toEqual([])
  })

  it('removeBundle removes the directory, and a second call does nothing', async () => {
    await ensureVmBundle(dirOf(), vmSpec)
    await removeBundle(dirOf())
    expect(existsSync(dirOf())).toBe(false)
    await expect(removeBundle(dirOf())).resolves.toBeUndefined()
  })
})
