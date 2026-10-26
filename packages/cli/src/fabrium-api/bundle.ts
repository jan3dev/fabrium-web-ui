import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { parse } from 'yaml'
import { readTokens } from '../bootstrap/tokens.js'

/**
 * A VM bundle is `workstations/<ws>/` on the central box: the `.env` and
 * `workforce/zooid.yaml` that the VM receives. The files follow
 * deploy/add-workstation.sh, so that script and the VM scripts read them alike.
 */

/** Marks a bundle admitted by the daemon: its registration lives in the tuwunel database. */
export const MARKER = '.runtime-registration'

export const VM_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/
export const AGENT_NAME_RE = /^[a-z][a-z0-9-]{0,31}$/

export interface BundleSpec {
  workstation: string
  agent: string
  serverName: string
  /** Public URL of the homeserver: the VM reaches it with this. */
  homeserverUrl: string
  /** Localpart of the workforce space. */
  space: string
  /** Rooms of the agent: `#alias`, `#alias:server`, or `!id:server`. */
  rooms: string[]
}

export interface Tokens {
  asToken: string
  hsToken: string
}

export interface BundleFiles {
  env: string
  yaml: string
}

export interface Bundle extends BundleFiles, Tokens {
  agentId: string
}

export interface BundleSummary {
  workstation: string
  agent: string
  agentId: string
  /** `acp.preset` of the agent in zooid.yaml; null for another kind of agent, such as the echo fixture. */
  preset: string | null
}

/** A room without a server part gets this server, as zooid.yaml does. */
export function withServer(room: string, serverName: string): string {
  return room.includes(':') ? room : `${room}:${serverName}`
}

export function renderEnv(spec: BundleSpec, tokens: Tokens): string {
  return [
    `# Agent VM environment for workstation ${spec.workstation}. Written by the zooid daemon (VM management API).`,
    '# Copy to the VM as ~/zooid/.env (mode 600). Format rules: deploy/README.md.',
    `WORKSTATION=${spec.workstation}`,
    `AGENT_NAME=${spec.agent}`,
    `SERVER_NAME=${spec.serverName}`,
    `HOMESERVER_URL=${spec.homeserverUrl}`,
    `WORKFORCE_SPACE=${spec.space}`,
    `MATRIX_AS_TOKEN=${tokens.asToken}`,
    `MATRIX_HS_TOKEN=${tokens.hsToken}`,
    '',
    '# Agent secrets go in ~/zooid/secrets.env on the VM, not here: a new copy of',
    '# the bundle replaces this file.',
    '',
  ].join('\n')
}

/** `deploy/agent-vm/zooid.yaml.example` for preset opencode. `${...}` stays for zooid to read from the VM environment. */
export function renderYaml(spec: BundleSpec): string {
  const rooms = spec.rooms.map((room) => `'${withServer(room, spec.serverName)}'`).join(', ')
  return [
    '# Agent VM config, written by the zooid daemon (VM management API) into ${ZOOID_HOME}/workstations/<workstation>/workforce/zooid.yaml',
    '# (delivered to the VM at first boot; see deploy/README.md). The quotes keep the names strings in YAML.',
    '# zooid reads "${HOMESERVER_URL}" from the daemon environment (~/zooid/.env, ~/zooid/secrets.env).',
    `workstation: '${spec.workstation}'`,
    '# The agent is a process of the VM, with the access of the VM user (Docker, sudo).',
    'runtime: local',
    'transports:',
    '  matrix:',
    '    homeserver: "${HOMESERVER_URL}"',
    '    # The VM reads with /sync and opens no port.',
    '    mode: client',
    `    sender_localpart: '${spec.workstation}'`,
    `    user_namespace: '@${spec.workstation}\\..*:${spec.serverName}'   # host part: SERVER_NAME, dots not escaped`,
    `    space: '${spec.space}'`,
    'agents:',
    '  # Persona and project are in the roster that the daemon publishes.',
    '  # The rooms must stay equal to the rooms of the roster entry.',
    `  '${spec.agent}':`,
    "    acp: { preset: 'opencode' }",
    `    matrix: { display_name: '${spec.agent}', rooms: [${rooms}], trigger: mention }`,
    '',
    '# Optional, not recommended: run the harness in a container to pin its version.',
    '# Replace `runtime: local` above with `runtime: docker` and add this block.',
    '# The agent then cannot use the VM directly or start other containers.',
    '# container:',
    '#   image: ghcr.io/zooid-ai/agent-claude-code@sha256:<digest>',
    '',
  ].join('\n')
}

/** `deploy/templates/registration-workstation.yaml`: the YAML that `!admin appservices register` takes. */
export function renderRegistration(spec: BundleSpec, tokens: Tokens): string {
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

/**
 * Create the bundle, or complete one that an earlier try left unfinished. Files
 * that exist stay as they are, so the tokens never change under a running VM.
 */
export async function ensureBundle(dir: string, spec: BundleSpec): Promise<Bundle> {
  await mkdir(join(dir, 'workforce'), { recursive: true, mode: 0o700 })
  await chmod(dirname(dir), 0o700)
  await chmod(dir, 0o700)
  // The marker comes first: a bundle that exists was made here, even after a crash.
  await createIfMissing(
    join(dir, MARKER),
    `Admitted by the zooid daemon (VM management API). The tuwunel registration of '${spec.workstation}' is in the tuwunel database, not in registrations/.\n` +
      `Remove it with: !admin appservices unregister ${spec.workstation}\n`,
    0o600,
  )
  const envPath = join(dir, '.env')
  let tokens = readTokens(envPath)
  if (!tokens) {
    tokens = {
      asToken: randomBytes(32).toString('hex'),
      hsToken: randomBytes(32).toString('hex'),
    }
    await writeFile(envPath, renderEnv(spec, tokens), { flag: 'wx', mode: 0o600 })
  }
  const yamlPath = join(dir, 'workforce', 'zooid.yaml')
  await createIfMissing(yamlPath, renderYaml(spec), 0o644)
  return {
    agentId: `@${spec.workstation}.${spec.agent}:${spec.serverName}`,
    ...tokens,
    env: await readFile(envPath, 'utf8'),
    yaml: await readFile(yamlPath, 'utf8'),
  }
}

/** The last `KEY=value` line wins, as in the scripts (`tail -n 1`). */
function envVar(env: string, key: string): string | undefined {
  let value: string | undefined
  for (const match of env.matchAll(new RegExp(`^${key}=(.*)$`, 'gm'))) value = match[1]
  return value || undefined
}

function presetOf(yaml: string, agent: string): string | null {
  try {
    const doc = parse(yaml) as { agents?: Record<string, { acp?: { preset?: unknown } }> } | null
    const preset = doc?.agents?.[agent]?.acp?.preset
    return typeof preset === 'string' ? preset : null
  } catch {
    return null
  }
}

/** Both files and the agent and server of the `.env` must be there; otherwise it is not a bundle. */
export async function readBundle(
  dir: string,
): Promise<(BundleFiles & { summary: BundleSummary }) | null> {
  let env: string
  let yaml: string
  try {
    ;[env, yaml] = await Promise.all([
      readFile(join(dir, '.env'), 'utf8'),
      readFile(join(dir, 'workforce', 'zooid.yaml'), 'utf8'),
    ])
  } catch {
    return null
  }
  const agent = envVar(env, 'AGENT_NAME')
  const serverName = envVar(env, 'SERVER_NAME')
  if (!agent || !serverName) return null
  const workstation = basename(dir)
  return {
    env,
    yaml,
    summary: {
      workstation,
      agent,
      agentId: `@${envVar(env, 'WORKSTATION') ?? workstation}.${agent}:${serverName}`,
      preset: presetOf(yaml, agent),
    },
  }
}

export async function listBundles(root: string): Promise<BundleSummary[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const bundles = await Promise.all(
    entries.filter((e) => e.isDirectory()).map((e) => readBundle(join(root, e.name))),
  )
  return bundles
    .flatMap((b) => (b ? [b.summary] : []))
    .sort((a, b) => (a.workstation < b.workstation ? -1 : a.workstation > b.workstation ? 1 : 0))
}
