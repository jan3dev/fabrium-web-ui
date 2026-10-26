export interface BootstrapFile {
  path: string
  mode: string
  owner: string
  content: string
}

export interface BootstrapPayload {
  files: BootstrapFile[]
  script: string
}

export interface PayloadInput {
  /** The bundle `.env` and `workforce/zooid.yaml`, as written on the central box. */
  env: string
  yaml: string
  havenApiKey: string
  havenModel: string
  githubToken?: string
  /** Full commit of the running zooid image; the VM checks it out. */
  commit: string
}

export const FULL_COMMIT_RE = /^[0-9a-f]{40}$/

// configure-agent.sh stores each secret as KEY=value in secrets.env, which systemd reads. It refuses a value
// with a line break, a backslash, or a leading quote (the `for key in $VARS` loop of deploy/agent-vm/configure-agent.sh).
const VM_REFUSES = /[\n\r\\]|^["']/

/** Why the VM script would refuse this secret, in the words of the script, or undefined. `name` is the field or variable. */
export function secretProblem(value: string, name: string): string | undefined {
  return VM_REFUSES.test(value)
    ? `${name} has a line break, a backslash or a leading quote: secrets.env cannot hold it as KEY=value`
    : undefined
}

const ZOOID_DIR = '/home/ubuntu/zooid'
const SECRETS_PATH = '/run/fabrium-agent-secrets.env'

/** `'value'` for a shell `source`: each `'` in the value becomes `'\''`. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

// One array entry per line: a template literal would expand `${uid}` and drop the `\` continuation.
const setupScript = (commit: string): string =>
  [
    '#!/bin/bash',
    'set -euo pipefail',
    'uid="$(id -u ubuntu)"',
    'for _ in $(seq 60); do',
    '  systemctl is-active --quiet "user@${uid}.service" && break',
    '  sleep 2',
    'done',
    'as_ubuntu() {',
    '  sudo -u ubuntu -H env XDG_RUNTIME_DIR="/run/user/${uid}" \\',
    '    DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/${uid}/bus" "$@"',
    '}',
    "trap 'rm -f /run/fabrium-agent-secrets.env' EXIT",
    `as_ubuntu bash -lc 'bash ~/fabrium-web-ui/deploy/agent-vm/provision.sh --ref ${commit}'`,
    "as_ubuntu bash -lc 'set -a; . /run/fabrium-agent-secrets.env; set +a; bash ~/fabrium-web-ui/deploy/agent-vm/configure-agent.sh'",
    '',
  ].join('\n')

export function buildPayload(input: PayloadInput): BootstrapPayload {
  // The commit goes into a shell command: only a full hash may pass.
  if (!FULL_COMMIT_RE.test(input.commit)) {
    throw new Error('commit must be a full 40-character commit hash')
  }
  const secrets: [string, string][] = [
    ['HAVEN_API_KEY', input.havenApiKey],
    ['HAVEN_MODEL', input.havenModel],
  ]
  if (input.githubToken) secrets.push(['GH_TOKEN', input.githubToken])

  const file = (path: string, content: string): BootstrapFile => ({
    path,
    mode: '600',
    owner: 'ubuntu',
    content,
  })
  return {
    files: [
      file(`${ZOOID_DIR}/.env`, input.env),
      file(`${ZOOID_DIR}/workforce/zooid.yaml`, input.yaml),
      file(SECRETS_PATH, secrets.map(([key, value]) => `${key}=${shellQuote(value)}\n`).join('')),
    ],
    script: setupScript(input.commit),
  }
}
