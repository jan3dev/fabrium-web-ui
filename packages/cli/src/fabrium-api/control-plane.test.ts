import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createControlPlane, readBody, relay } from './control-plane.js'

afterEach(() => {
  vi.restoreAllMocks()
})

const logged = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((c) => c.join(' ')).join('\n')

describe('createControlPlane', () => {
  it('logs the name and the code of a failure, never its message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failing = (() =>
      Promise.reject(
        Object.assign(new TypeError('fetch failed: Bearer SECRETKEY'), { cause: { code: 'ECONNREFUSED' } }),
      )) as typeof fetch
    const cp = createControlPlane({ baseUrl: 'https://control.example.org', apiKey: 'k', fetch: failing })
    await expect(cp.request('GET', '/v1/vms')).rejects.toMatchObject({
      status: 502,
      body: { error: 'control plane unreachable' },
    })
    expect(logged(warn)).toBe('[fabrium] control plane unreachable: TypeError ECONNREFUSED')
  })

  it('logs only the name when the failure has no code', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failing = (() => Promise.reject(new Error('boom SECRETKEY'))) as typeof fetch
    const cp = createControlPlane({ baseUrl: 'https://control.example.org', apiKey: 'k', fetch: failing })
    await cp.request('GET', '/v1/vms').catch(() => {})
    expect(logged(warn)).toBe('[fabrium] control plane unreachable: Error')
  })

  describe('a control plane that stalls after its headers', () => {
    // The real thing: a socket that sends the headers and the start of a body, then nothing.
    const stalled = async () => {
      const server = createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.write('[{"id":')
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const { port } = server.address() as AddressInfo
      return {
        cp: createControlPlane({ baseUrl: `http://127.0.0.1:${port}`, apiKey: 'k', timeoutMs: 150 }),
        close: () => {
          server.closeAllConnections()
          server.close()
        },
      }
    }

    it('readBody gives 502 control plane unreachable', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { cp, close } = await stalled()
      try {
        const upstream = await cp.request('GET', '/v1/vms')
        await expect(readBody(upstream)).rejects.toMatchObject({
          status: 502,
          body: { error: 'control plane unreachable' },
        })
      } finally {
        close()
      }
    })

    it('relay gives 502 control plane unreachable', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { cp, close } = await stalled()
      try {
        const upstream = await cp.request('GET', '/v1/vms')
        await expect(relay(upstream)).rejects.toMatchObject({
          status: 502,
          body: { error: 'control plane unreachable' },
        })
      } finally {
        close()
      }
    })
  })

  it('keeps the key out of the log when the real fetch refuses the header (RF5)', async () => {
    // Node puts the whole header value, with the key, into the message of this error.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const cp = createControlPlane({ baseUrl: 'https://127.0.0.1:1', apiKey: 'line-one-SECRETKEY\nline-two' })
    await expect(cp.request('GET', '/v1/vms')).rejects.toMatchObject({ status: 502 })
    expect(warn).toHaveBeenCalled()
    expect(logged(warn)).not.toContain('SECRETKEY')
  })
})
