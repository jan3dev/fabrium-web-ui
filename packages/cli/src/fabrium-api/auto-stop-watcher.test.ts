import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const run = promisify(execFile)
const WATCHER = resolve(__dirname, '../../../../deploy/agent-vm/image/fabrium-auto-stop')
const TAG_PATH = '/latest/meta-data/tags/instance/fabrium:auto-stop-hours'

interface Reply {
  status: number
  body: string
}

/** One local server plays the control plane and IMDS. */
function fakeServer(cp: Reply, tag: Reply): Promise<{ server: Server; url: string; auth: string[] }> {
  const auth: string[] = []
  const server = createServer((req, res) => {
    let reply: Reply = { status: 404, body: '' }
    if (req.url === '/v1/vm/auto-stop') {
      auth.push(String(req.headers.authorization))
      reply = cp
    } else if (req.method === 'PUT' && req.url === '/latest/api/token') {
      reply = { status: 200, body: 'imds-token' }
    } else if (req.url === TAG_PATH) {
      reply = tag
    }
    res.writeHead(reply.status).end(reply.body)
  })
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      done({ server, url: `http://127.0.0.1:${port}`, auth })
    }),
  )
}

describe('fabrium-auto-stop', () => {
  let root: string
  let server: Server | undefined

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'auto-stop-'))
  })
  afterEach(() => {
    server?.close()
    server = undefined
    rmSync(root, { recursive: true, force: true })
  })

  const cacheFile = () => join(root, 'var/lib/fabrium/auto-stop-hours')

  function vmFiles(url: string): void {
    mkdirSync(join(root, 'etc/fabrium'), { recursive: true })
    writeFileSync(join(root, 'etc/fabrium/vm-token'), 'vm-secret')
    writeFileSync(join(root, 'etc/fabrium/control-plane-url'), url)
  }

  function cached(hours: string): void {
    mkdirSync(join(root, 'var/lib/fabrium'), { recursive: true })
    writeFileSync(cacheFile(), `${hours}\n`)
  }

  async function decide(cp: Reply, tag: Reply, setup: (url: string) => void): Promise<string> {
    const fake = await fakeServer(cp, tag)
    server = fake.server
    setup(fake.url)
    const { stdout } = await run('sh', [WATCHER, '--dry-run'], {
      env: {
        PATH: process.env.PATH,
        FABRIUM_AUTO_STOP_DIR: root,
        FABRIUM_AUTO_STOP_IMDS: `${fake.url}/latest`,
      },
    })
    return stdout
  }

  const ok = (body: string): Reply => ({ status: 200, body })
  const status = (code: number): Reply => ({ status: code, body: '' })

  it('takes the hours of the control plane, sends the VM token, and keeps the answer', async () => {
    const fake = await fakeServer(ok('{"auto_stop_hours":7}'), ok('9'))
    server = fake.server
    vmFiles(fake.url)
    const { stdout } = await run('sh', [WATCHER, '--dry-run'], {
      env: { PATH: process.env.PATH, FABRIUM_AUTO_STOP_DIR: root, FABRIUM_AUTO_STOP_IMDS: `${fake.url}/latest` },
    })
    expect(stdout).toContain('auto-stop hours: 7 (from the control plane)')
    expect(fake.auth).toEqual(['Bearer vm-secret'])
    expect(readFileSync(cacheFile(), 'utf8')).toBe('7\n')
  })

  it('keeps the last answer when the control plane fails', async () => {
    for (const cp of [status(500), status(404), status(401), ok('{"auto_stop_hours":"x"}'), ok('{}')]) {
      const out = await decide(cp, ok('9'), (url) => {
        vmFiles(url)
        cached('5')
      })
      expect(out, JSON.stringify(cp)).toContain('auto-stop hours: 5 (kept from the last control plane answer)')
      expect(readFileSync(cacheFile(), 'utf8')).toBe('5\n')
      server?.close()
    }
  })

  it('reads the instance tag without an answer to keep', async () => {
    const out = await decide(status(503), ok('9'), vmFiles)
    expect(out).toContain('auto-stop hours: 9 (from the instance tag)')
  })

  it('reads the instance tag on a VM without a VM token', async () => {
    const out = await decide(ok('{"auto_stop_hours":7}'), ok('9'), () => {})
    expect(out).toContain('auto-stop hours: 9 (from the instance tag)')
  })

  it('falls back to 12 when the tag is missing', async () => {
    const out = await decide(status(500), status(404), vmFiles)
    expect(out).toContain('auto-stop hours: 12 (default)')
  })

  it('skips the check when IMDS fails and nothing else answered', async () => {
    const out = await decide(status(500), status(500), vmFiles)
    expect(out).toContain('IMDS read failed (HTTP 500); check skipped')
    expect(out).not.toContain('auto-stop hours:')
  })

  it('treats 0 from the control plane as off', async () => {
    const out = await decide(ok('{"auto_stop_hours":0}'), ok('9'), vmFiles)
    expect(out).toContain('auto-stop is off')
  })
})
