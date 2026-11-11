import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recordCreator } from './bundle.js'
import { ADMIN, createTestApi, jsonResponse } from './test-api.js'

const CARA = '@cara:example.org'
const DAN = '@dan:example.org'

const vm = (id: string, name: string, creator: string | null) => ({
  id,
  name,
  state: 'stopped',
  instance_type: 't3a.medium',
  auto_stop_hours: 12,
  creator,
  registered: creator !== null,
})
const OWN = vm('i-00000000000000001', 'lima', CARA)
const OTHER = vm('i-00000000000000002', 'kilo', ADMIN)
const OLD = vm('i-00000000000000003', 'juliet', null)

let api: ReturnType<typeof createTestApi>
let cara: string

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  api = createTestApi({ agentNames: ['s-meow'] })
  api.fake.joinSpace(CARA, 70)
  api.fake.joinSpace(DAN, 69)
  cara = api.fake.openIdToken(CARA)
  api.controlPlane.on('GET', '/v1/vms', jsonResponse(200, [OWN, OTHER, OLD]))
})
afterEach(() => {
  api.cleanup()
  vi.restoreAllMocks()
})

const writes = () => api.controlPlane.requests.filter((r) => r.method !== 'GET')

describe('the vm-creator role', () => {
  it('is level 70 to 89 of the workforce space', async () => {
    const res = await api.request('GET', '/access', { token: cara })
    expect(await res.json()).toEqual({ user_id: CARA, role: 'vm-creator' })
    const dan = api.fake.openIdToken(DAN)
    expect((await api.request('GET', '/access', { token: dan })).status).toBe(403)
  })

  it('lists only the VMs that the caller created', async () => {
    const mine = await (await api.request('GET', '/vms', { token: cara })).json()
    expect(mine.map((v: { name: string }) => v.name)).toEqual(['lima'])
    const all = await (await api.request('GET', '/vms')).json()
    expect(all.map((v: { name: string }) => v.name)).toEqual(['lima', 'kilo', 'juliet'])
    expect(all[0]).toMatchObject({ creator: CARA, registered: true })
  })

  it.each([
    ['POST', '/start'],
    ['POST', '/stop'],
    ['POST', '/reboot'],
    ['DELETE', ''],
  ])('answers 404 for %s %s on a VM of someone else, without a write', async (method, action) => {
    for (const other of [OTHER, OLD]) {
      const res = await api.request(method, `/vms/${other.id}${action}`, { token: cara })
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'not found' })
    }
    expect(writes()).toEqual([])
  })

  it('acts on its own VM', async () => {
    api.controlPlane.on('POST', /\/start$/, jsonResponse(202, { ...OWN, state: 'pending' }))
    const res = await api.request('POST', `/vms/${OWN.id}/start`, { token: cara })
    expect(res.status).toBe(202)
    expect(writes().map((r) => r.path)).toEqual([`/v1/vms/${OWN.id}/start`])
  })

  it('sees only its own agents', async () => {
    await api.bundle('kilo', 'delta')
    await api.bundle('lima', 'echo')
    await recordCreator(join(api.workstationsDir, 'lima'), CARA)
    const mine = await (await api.request('GET', '/agents', { token: cara })).json()
    expect(mine.map((a: { workstation: string }) => a.workstation)).toEqual(['lima'])
    const all = await (await api.request('GET', '/agents')).json()
    expect(all).toHaveLength(2)
  })
})

describe('PUT /vms/:id/auto-stop', () => {
  it('relays the hours to the control plane', async () => {
    api.controlPlane.on('PUT', /\/auto-stop$/, jsonResponse(200, { ...OWN, auto_stop_hours: 3 }))
    const res = await api.request('PUT', `/vms/${OWN.id}/auto-stop`, { json: { auto_stop_hours: 3 } })
    expect(res.status).toBe(200)
    expect(writes()).toMatchObject([
      { method: 'PUT', path: `/v1/vms/${OWN.id}/auto-stop`, body: { auto_stop_hours: 3 } },
    ])
  })

  it('refuses hours out of range and a body that is not an object', async () => {
    for (const json of [{ auto_stop_hours: 0 }, { auto_stop_hours: 169 }, {}, [3]]) {
      const res = await api.request('PUT', `/vms/${OWN.id}/auto-stop`, { json })
      expect(res.status, JSON.stringify(json)).toBe(400)
    }
    expect(writes()).toEqual([])
  })

  it('answers 404 to a vm-creator for a VM of someone else', async () => {
    const res = await api.request('PUT', `/vms/${OTHER.id}/auto-stop`, {
      token: cara,
      json: { auto_stop_hours: 3 },
    })
    expect(res.status).toBe(404)
    expect(writes()).toEqual([])
  })
})

describe('create', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    name: 'mike',
    agent: { mode: 'new', name: 'foxtrot' },
    haven_api_key: 'hk-secret-1',
    ...over,
  })
  const created = vm('i-00000000000000009', 'mike', CARA)

  beforeEach(() => {
    api.controlPlane.on('POST', '/v1/vms', jsonResponse(201, created))
  })

  it('sends the creator and records it in the bundle', async () => {
    const res = await api.request('POST', '/vms', { token: cara, json: body() })
    expect(res.status).toBe(201)
    expect(writes()[0].body).toMatchObject({ name: 'mike', creator: CARA })
    expect(readFileSync(join(api.workstationsDir, 'mike', '.creator'), 'utf8')).toBe(`${CARA}\n`)
  })

  it('refuses an agent name that another workstation has', async () => {
    // A free agent: november has no VM.
    await api.bundle('november', 'foxtrot')
    const res = await api.request('POST', '/vms', { json: body() })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: 'agent name foxtrot is in use; pick it as an existing agent',
    })
    expect(writes()).toEqual([])
    // An agent with a live VM is not offered as an existing agent.
    await api.bundle('kilo', 'golf')
    const busy = await api.request('POST', '/vms', { json: body({ agent: { mode: 'new', name: 'golf' } }) })
    expect(await busy.json()).toEqual({ error: 'agent name golf is in use' })
  })

  it('refuses an agent name of the daemon config', async () => {
    const res = await api.request('POST', '/vms', {
      json: body({ agent: { mode: 'new', name: 's-meow' } }),
    })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'agent name s-meow is in use' })
  })

  it('still resumes the same VM name with the same agent', async () => {
    await api.bundle('mike', 'foxtrot', {}, { admitted: false })
    const res = await api.request('POST', '/vms', { json: body() })
    expect(res.status).toBe(201)
  })

  it('lets a vm-creator move only its own free agent', async () => {
    await api.bundle('kilo-old', 'delta')
    await api.bundle('lima-old', 'echo')
    await recordCreator(join(api.workstationsDir, 'lima-old'), CARA)
    const other = await api.request('POST', '/vms', {
      token: cara,
      json: body({ name: 'kilo-old', agent: { mode: 'existing' } }),
    })
    expect(other.status).toBe(400)
    expect(await other.json()).toEqual({ error: 'kilo-old is not a free agent' })
    const own = await api.request('POST', '/vms', {
      token: cara,
      json: body({ name: 'lima-old', agent: { mode: 'existing' } }),
    })
    expect(own.status).toBe(201)
  })
})
