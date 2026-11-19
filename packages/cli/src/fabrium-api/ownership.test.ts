import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ADMIN, createTestApi, fakeAgentStore, jsonResponse } from './test-api.js'

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
  api = createTestApi()
  fakeAgentStore(api.controlPlane)
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
  it('is level 70 to 89 of the workforce space; 69 is an agents-manager', async () => {
    const res = await api.request('GET', '/access', { token: cara })
    expect(await res.json()).toEqual({ user_id: CARA, role: 'vm-creator' })
    const dan = api.fake.openIdToken(DAN)
    expect(await (await api.request('GET', '/access', { token: dan })).json()).toEqual({
      user_id: DAN,
      role: 'agents-manager',
    })
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
