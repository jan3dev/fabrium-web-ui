import { randomBytes } from 'node:crypto'
import { access, chmod, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { readTokens } from '../bootstrap/tokens.js'

/**
 * A VM bundle is `workstations/<vm>/` on the central box: the `.env` that the VM receives, and the marker.
 * The `.env` follows deploy/add-workstation.sh, so that script and the VM scripts read it alike.
 */

/** Marks a bundle admitted by the daemon: its registration lives in the tuwunel database. */
export const MARKER = '.runtime-registration'

export const VM_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/
export const AGENT_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/

/** The bundle of a VM name: one Matrix credential for every agent of the VM (contracts section 3). */
export interface VmBundleSpec {
  workstation: string
  serverName: string
  /** Public URL of the homeserver: the VM reaches it with this. */
  homeserverUrl: string
  /** Localpart of the workforce space. */
  space: string
  /** Live app previews: the central box has them on. */
  previews?: boolean
}

export interface Tokens {
  asToken: string
  hsToken: string
}

export interface VmBundle extends Tokens {
  env: string
}

/** A room without a server part gets this server, as zooid.yaml does. */
export function withServer(room: string, serverName: string): string {
  return room.includes(':') ? room : `${room}:${serverName}`
}

/** The `.env` of a bundle (contracts section 3). */
export function renderEnv(spec: VmBundleSpec, tokens: Tokens): string {
  return [
    `# Agent VM environment for workstation ${spec.workstation}. Written by the zooid daemon (VM management API).`,
    '# Copy to the VM as ~/zooid/.env (mode 600). Format rules: deploy/README.md.',
    `WORKSTATION=${spec.workstation}`,
    `SERVER_NAME=${spec.serverName}`,
    `HOMESERVER_URL=${spec.homeserverUrl}`,
    `WORKFORCE_SPACE=${spec.space}`,
    // fabrium-agent-sync writes `previews: true` into zooid.yaml from this line (PREVIEWS_SPEC.md).
    ...(spec.previews ? ['FABRIUM_PREVIEWS=true'] : []),
    `MATRIX_AS_TOKEN=${tokens.asToken}`,
    `MATRIX_HS_TOKEN=${tokens.hsToken}`,
    '',
    '# Agent secrets go in ~/zooid/secrets.env on the VM, not here: a new copy of',
    '# the bundle replaces this file.',
    '',
  ].join('\n')
}

/** `deploy/templates/registration-workstation.yaml`: the YAML that `!admin appservices register` takes. */
export function renderRegistration(spec: VmBundleSpec, tokens: Tokens): string {
  // The namespace is a regex: escape the dots of the server name.
  const serverRe = spec.serverName.replaceAll('.', '\\.')
  return [
    `id: '${spec.workstation}'`,
    // Pull mode: the VM reads with /sync, so tuwunel has nothing to push.
    'url: null',
    `as_token: ${tokens.asToken}`,
    `hs_token: ${tokens.hsToken}`,
    `sender_localpart: '${spec.workstation}'`,
    'rate_limited: false',
    'namespaces:',
    '  users:',
    '    - exclusive: true',
    `      regex: '@${spec.workstation}\\..*:${serverRe}'`,
    // No aliases: the agent could read the VM token and create any free alias.
    '  aliases: []',
    '  rooms: []',
    '',
  ].join('\n')
}

async function createIfMissing(path: string, content: string, mode: number): Promise<void> {
  try {
    await writeFile(path, content, { flag: 'wx', mode })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
  }
}

const markerText = (workstation: string) =>
  `Admitted by the zooid daemon (VM management API). The tuwunel registration of '${workstation}' is in the tuwunel database, not in registrations/.\n` +
  `Remove it with: !admin appservices unregister ${workstation}\n`

/**
 * Create the bundle of a VM name, or complete one that an earlier try left unfinished: the marker and the
 * `.env`. Files that exist stay as they are, so the tokens never change under a running VM.
 */
export async function ensureVmBundle(dir: string, spec: VmBundleSpec): Promise<VmBundle> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  await chmod(dirname(dir), 0o700)
  await chmod(dir, 0o700)
  // The marker comes first: a bundle that exists was made here, even after a crash.
  await createIfMissing(join(dir, MARKER), markerText(spec.workstation), 0o600)
  const envPath = join(dir, '.env')
  let tokens = readTokens(envPath)
  if (!tokens) {
    tokens = {
      asToken: randomBytes(32).toString('hex'),
      hsToken: randomBytes(32).toString('hex'),
    }
    await writeFile(envPath, renderEnv(spec, tokens), { flag: 'wx', mode: 0o600 })
  }
  return { ...tokens, env: await readFile(envPath, 'utf8') }
}

const hasMarker = (dir: string) => access(join(dir, MARKER)).then(() => true, () => false)

/** The `.env` of a bundle that the VM API made, or null. */
export async function readBundleEnv(dir: string): Promise<string | null> {
  if (!(await hasMarker(dir))) return null
  return readFile(join(dir, '.env'), 'utf8').catch(() => null)
}

/** The VM names that have a bundle with the marker, sorted. */
export async function listBundleNames(root: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const names = entries.filter((e) => e.isDirectory() && VM_NAME_RE.test(e.name)).map((e) => e.name)
  const marked = await Promise.all(names.map((name) => hasMarker(join(root, name))))
  return names.filter((_, i) => marked[i]).sort()
}

export async function removeBundle(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

/** The last `KEY=value` line wins, as in the scripts (`tail -n 1`). */
export function envVar(env: string, key: string): string | undefined {
  let value: string | undefined
  for (const match of env.matchAll(new RegExp(`^${key}=(.*)$`, 'gm'))) value = match[1]
  return value || undefined
}
