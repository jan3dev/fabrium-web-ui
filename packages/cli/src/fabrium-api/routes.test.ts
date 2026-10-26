import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONTROL_PLANE_KEY, createTestApi, jsonResponse } from './test-api.js'

const VM_ID = 'i-0123456789abcdef0'
const vm = (name: string, extra: Record<string, unknown> = {}) => ({
  id: VM_ID,
  name,
  state: 'running',
  instance_type: 't3a.medium',
  sev_snp: false,
  public_ip: '203.0.113.10',
  launched_at: '2026-10-26T19:00:00Z',
  setup: 'delivered',
  ...extra,
})

let api: ReturnType<typeof createTestApi>
beforeEach(() => {
  api = createTestApi()
})
afterEach(() => {
  api.cleanup()
  vi.restoreAllMocks()
})

describe('access', () => {
  it('returns the user and the role', async () => {
    const res = await api.request('GET', '/access')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user_id: '@ann:example.org', role: 'admin' })
  })

  it('answers 401 and 403 without calling the control plane', async () => {
    api.controlPlane.on('GET', '/v1/vms', jsonResponse(200, []))
    expect((await api.request('GET', '/vms', { token: null })).status).toBe(401)
    const forbidden = await api.request('GET', '/vms', { token: api.memberToken })
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toEqual({ error: 'forbidden' })
    expect(api.controlPlane.requests).toEqual([])
  })

  it('exists only under /_fabrium/v1', async () => {
    expect((await api.app.request('/vms')).status).toBe(404)
    expect((await api.app.request('/_fabrium/v1/vms')).status).toBe(401)
  })
})

describe('GET /vms', () => {
  it('adds agent_id from the bundle, and null without one', async () => {
    await api.bundle('lima', 'echo')
    api.controlPlane.on('GET', '/v1/vms', jsonResponse(200, [vm('lima'), vm('nobundle')]))
    const res = await api.request('GET', '/vms')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      vm('lima', { agent_id: '@lima.echo:example.org' }),
      vm('nobundle', { agent_id: null }),
    ])
  })

  it('sends the tenant key to the control plane and never returns or logs it', async () => {
    const logs = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
    ]
    api.controlPlane.on('GET', '/v1/vms', jsonResponse(200, [vm('lima')]))
    const res = await api.request('GET', '/vms')
    expect(api.controlPlane.requests[0]?.authorization).toBe(`Bearer ${CONTROL_PLANE_KEY}`)
    expect(await res.text()).not.toContain(CONTROL_PLANE_KEY)
    expect(JSON.stringify(logs.map((l) => l.mock.calls))).not.toContain(CONTROL_PLANE_KEY)
  })

  it('answers 502 when the control plane sends something that is not a list', async () => {
    api.controlPlane.on('GET', '/v1/vms', new Response('<html>', { status: 200 }))
    const res = await api.request('GET', '/vms')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'control plane sent an invalid response' })
  })
})

describe('control plane errors', () => {
  it.each([
    [404, { error: 'not found' }],
    [409, { error: 'vm is stopped' }],
    [502, { error: 'ec2 failed' }],
  ])('passes %i and its body through', async (status, body) => {
    api.controlPlane.on('GET', '/v1/vms', jsonResponse(status, body))
    api.controlPlane.on('POST', `/v1/vms/${VM_ID}/stop`, jsonResponse(status, body))
    for (const res of [
      await api.request('GET', '/vms'),
      await api.request('POST', `/vms/${VM_ID}/stop`),
    ]) {
      expect(res.status).toBe(status)
      expect(await res.json()).toEqual(body)
    }
  })

  it('relays a body that is not JSON untouched', async () => {
    api.controlPlane.on(
      'GET',
      '/v1/vms',
      new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
    )
    api.controlPlane.on(
      'DELETE',
      `/v1/vms/${VM_ID}`,
      new Response('Payload Too Large', { status: 413, headers: { 'content-type': 'text/plain' } }),
    )
    const html = await api.request('GET', '/vms')
    expect([html.status, html.headers.get('content-type'), await html.text()]).toEqual([
      502,
      'text/html',
      '<html>Bad gateway</html>',
    ])
    const plain = await api.request('DELETE', `/vms/${VM_ID}`)
    expect([plain.status, plain.headers.get('content-type'), await plain.text()]).toEqual([
      413,
      'text/plain',
      'Payload Too Large',
    ])
  })

  it('answers 502 when the control plane is unreachable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    api.controlPlane.on('GET', '/v1/vms', () => {
      throw new TypeError('fetch failed')
    })
    const res = await api.request('GET', '/vms')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'control plane unreachable' })
  })

  it('answers 502 when the control plane does not answer in time', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const slow = createTestApi({ controlPlaneTimeoutMs: 20 })
    try {
      slow.controlPlane.on(
        'GET',
        '/v1/vms',
        (req) =>
          new Promise<Response>((_, reject) =>
            req.signal?.addEventListener('abort', () => reject(req.signal?.reason)),
          ),
      )
      const res = await slow.request('GET', '/vms')
      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ error: 'control plane unreachable' })
    } finally {
      slow.cleanup()
    }
  })
})

describe('proxy routes', () => {
  it('GET /instance-types returns the list of the control plane', async () => {
    const types = [{ name: 't3a.medium', vcpus: 2, memory_mib: 4096, sev_snp: false, default: true }]
    api.controlPlane.on('GET', '/v1/instance-types', jsonResponse(200, types))
    const res = await api.request('GET', '/instance-types')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(types)
  })

  it.each(['start', 'stop', 'reboot'])('POST /vms/:id/%s proxies and returns 202', async (action) => {
    api.controlPlane.on('POST', `/v1/vms/${VM_ID}/${action}`, jsonResponse(202, vm('lima')))
    const res = await api.request('POST', `/vms/${VM_ID}/${action}`)
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual(vm('lima'))
    expect(api.controlPlane.requests.at(-1)).toMatchObject({
      method: 'POST',
      path: `/v1/vms/${VM_ID}/${action}`,
    })
  })

  it('DELETE /vms/:id proxies and returns an empty 202', async () => {
    api.controlPlane.on('DELETE', `/v1/vms/${VM_ID}`, new Response(null, { status: 202 }))
    const res = await api.request('DELETE', `/vms/${VM_ID}`)
    expect(res.status).toBe(202)
    expect(await res.text()).toBe('')
  })

  it('encodes the VM id in the upstream path', async () => {
    await api.request('POST', '/vms/a%2F..%2Fb/start')
    expect(api.controlPlane.requests.at(-1)?.path).toBe('/v1/vms/a%2F..%2Fb/start')
  })
})

describe('GET /agents', () => {
  it('lists every bundle sorted by workstation, with the free rule', async () => {
    await api.bundle('c-echo', 'echo')
    await api.bundle('a-free', 'amy')
    await api.bundle('b-used', 'bob')
    writeFileSync(
      join(api.workstationsDir, 'c-echo', 'workforce', 'zooid.yaml'),
      "agents:\n  echo:\n    acp: { command: sh, args: ['-c', 'true'] }\n",
    )
    api.controlPlane.on('GET', '/v1/vms', jsonResponse(200, [vm('b-used')]))
    const res = await api.request('GET', '/agents')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      { workstation: 'a-free', agent_id: '@a-free.amy:example.org', preset: 'opencode', free: true },
      { workstation: 'b-used', agent_id: '@b-used.bob:example.org', preset: 'opencode', free: false },
      { workstation: 'c-echo', agent_id: '@c-echo.echo:example.org', preset: null, free: false },
    ])
  })

  it('passes a control plane failure through', async () => {
    api.controlPlane.on('GET', '/v1/vms', jsonResponse(502, { error: 'ec2 failed' }))
    const res = await api.request('GET', '/agents')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'ec2 failed' })
  })

  const whoamiCalls = () =>
    api.fake.calls.filter((c) => c.path.startsWith('/_matrix/client/v3/account/whoami')).length

  it('lists an agent as not free when its admission stopped before tuwunel loaded the registration', async () => {
    await api.bundle('half', 'amy', {}, { registered: false })
    await api.bundle('whole', 'bob')
    api.controlPlane.on('GET', '/v1/vms', jsonResponse(200, []))
    const res = await api.request('GET', '/agents')
    expect(await res.json()).toEqual([
      expect.objectContaining({ workstation: 'half', preset: 'opencode', free: false }),
      expect.objectContaining({ workstation: 'whole', preset: 'opencode', free: true }),
    ])
  })

  it('asks tuwunel only about the bundles that the VM API made', async () => {
    await api.bundle('one', 'amy')
    await api.bundle('two', 'bob')
    await api.bundle('legacy', 'cat', {}, { legacy: true })
    api.controlPlane.on('GET', '/v1/vms', jsonResponse(200, []))
    const before = whoamiCalls()
    const res = await api.request('GET', '/agents')
    expect((await res.json()).map((a: { free: boolean }) => a.free)).toEqual([true, true, true])
    expect(whoamiCalls() - before).toBe(2)
  })

  it('does not list an agent as free when tuwunel answers an error to whoami', async () => {
    await api.bundle('lima', 'amy')
    api.controlPlane.on('GET', '/v1/vms', jsonResponse(200, []))
    api.fake.failOnce('GET', /account\/whoami/, 500)
    const res = await api.request('GET', '/agents')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([expect.objectContaining({ workstation: 'lima', free: false })])
  })
})
