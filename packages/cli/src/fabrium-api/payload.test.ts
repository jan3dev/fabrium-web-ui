import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPayload, FULL_COMMIT_RE, shellQuote } from './payload.js'

const commit = '0123456789abcdef0123456789abcdef01234567'
const input = {
  env: 'WORKSTATION=lima\n',
  yaml: "workstation: 'lima'\n",
  havenApiKey: 'hk',
  havenModel: 'glm-5-3',
  githubToken: 'gh',
  commit,
}

// The script of contracts section 3, one array entry per line.
const expectedScript = (ref: string) =>
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
    `as_ubuntu bash -lc 'bash ~/fabrium-web-ui/deploy/agent-vm/provision.sh --ref ${ref}'`,
    "as_ubuntu bash -lc 'set -a; . /run/fabrium-agent-secrets.env; set +a; bash ~/fabrium-web-ui/deploy/agent-vm/configure-agent.sh'",
    '',
  ].join('\n')

describe('buildPayload', () => {
  it('lists the three files with owner ubuntu and mode 600', () => {
    const { files } = buildPayload(input)
    expect(files.map((f) => f.path)).toEqual([
      '/home/ubuntu/zooid/.env',
      '/home/ubuntu/zooid/workforce/zooid.yaml',
      '/run/fabrium-agent-secrets.env',
    ])
    expect(files.every((f) => f.owner === 'ubuntu' && f.mode === '600')).toBe(true)
    expect(files[0]!.content).toBe(input.env)
    expect(files[1]!.content).toBe(input.yaml)
  })

  it("writes the secrets as KEY='value' lines", () => {
    const secrets = buildPayload(input).files[2]!.content
    expect(secrets).toBe("HAVEN_API_KEY='hk'\nHAVEN_MODEL='glm-5-3'\nGH_TOKEN='gh'\n")
  })

  it.each(['', undefined])('omits GH_TOKEN when the token is %j', (githubToken) => {
    const secrets = buildPayload({ ...input, githubToken }).files[2]!.content
    expect(secrets).toBe("HAVEN_API_KEY='hk'\nHAVEN_MODEL='glm-5-3'\n")
  })

  it('builds the script of contracts section 3 with the commit', () => {
    expect(buildPayload(input).script).toBe(expectedScript(commit))
  })

  it.each(['', 'abc123', 'main', `${'a'.repeat(40)};id`, 'A'.repeat(40)])(
    'rejects the commit %j',
    (bad) => {
      expect(() => buildPayload({ ...input, commit: bad })).toThrow(/commit/)
    },
  )
})

describe('shellQuote', () => {
  it("quotes a single quote as '\\''", () => {
    expect(shellQuote("a'b")).toBe("'a'\\''b'")
  })

  it.each([
    `it's $HOME "x" \`id\` \\ end`,
    'line one\nline two',
    "'",
    '',
  ])('survives sourcing in bash: %j', (value) => {
    const dir = mkdtempSync(join(tmpdir(), 'fabrium-payload-'))
    try {
      const file = join(dir, 'secrets.env')
      writeFileSync(
        file,
        buildPayload({ ...input, havenApiKey: value, githubToken: value }).files[2]!.content,
      )
      const read = (name: string) =>
        execFileSync('bash', ['-c', `set -a; . "$0"; set +a; printf %s "$${name}"`, file], {
          encoding: 'utf8',
        })
      expect(read('HAVEN_API_KEY')).toBe(value)
      expect(read('GH_TOKEN')).toBe(value)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('FULL_COMMIT_RE', () => {
  it('matches 40 lowercase hex characters only', () => {
    expect(FULL_COMMIT_RE.test(commit)).toBe(true)
    expect(FULL_COMMIT_RE.test(commit.slice(0, 12))).toBe(false)
  })
})
