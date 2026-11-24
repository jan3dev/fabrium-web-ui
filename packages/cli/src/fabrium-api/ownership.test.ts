import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureVmBundle } from './bundle.js'
import { ADMIN, createTestApi, fakeAgentStore, jsonResponse } from './test-api.js'

const CARA = '@cara:example.org'
const DAN = '@dan:example.org'

const PAYMENTS = {
  id: '9a1c0e2b4c6d8a0f5f0c2d7a9b3e4c1d',
  name: 'Payments',
  created_at: '2026-11-19T19:00:00Z',
  updated_at: '2026-11-19T19:00:00Z',
}
const vm = (id: string, name: string, creator: string | null, projectId?: string) => ({
  id,
  name,
  state: 'stopped',
  instance_type: 't3a.medium',
  auto_stop_hours: 12,
  creator,
  registered: creator !== null,
  ...(projectId === undefined ? {} : { project_id: projectId }),
})
const OWN = vm('i-00000000000000001', 'lima', CARA)
const OTHER = vm('i-00000000000000002', 'kilo', ADMIN)
const OLD = vm('i-00000000000000003', 'juliet', null)
// A project VM of another creator.
const HUB = vm('i-00000000000000004', 'hub', DAN, PAYMENTS.id)
/** The three fields of the VM view. */
const viewed = (v: Record<string, unknown>, setProject: boolean) => ({
  ...v,
  project_id: v.project_id ?? null,
  project: v.project_id === PAYMENTS.id ? 'Payments' : null,
  can: { set_project: setProject },
})

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
  api.controlPlane.on('GET', '/v1/vms', jsonResponse(200, [OWN, OTHER, OLD, HUB]))
  api.controlPlane.on('GET', '/v1/projects', jsonResponse(200, [PAYMENTS]))
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

  it('GET /vms gives a vm-creator their VMs and every project VM', async () => {
    const mine = await (await api.request('GET', '/vms', { token: cara })).json()
    expect(mine.map((v: { name: string }) => v.name)).toEqual(['lima', 'hub'])
    const all = await (await api.request('GET', '/vms')).json()
    expect(all.map((v: { name: string }) => v.name)).toEqual(['lima', 'kilo', 'juliet', 'hub'])
    expect(all[0]).toMatchObject({ creator: CARA, registered: true })
  })

  it('each VM has project_id, project, and can.set_project', async () => {
    const mine = await (await api.request('GET', '/vms', { token: cara })).json()
    expect(mine).toEqual([
      { ...viewed(OWN, true), agents: [] },
      { ...viewed(HUB, false), agents: [] },
    ])
    const all = await (await api.request('GET', '/vms')).json()
    expect(all.find((v: { name: string }) => v.name === 'hub')).toEqual({ ...viewed(HUB, true), agents: [] })
  })

  it.each([
    ['POST', '/start'],
    ['POST', '/stop'],
    ['POST', '/reboot'],
    ['DELETE', ''],
    ['PUT', '/auto-stop', { auto_stop_hours: 3 }],
    ['POST', '/recreate', { haven_api_key: 'hk-new' }],
  ])('answers 404 for %s %s on a VM of someone else, without a write', async (method, action, json?: unknown) => {
    for (const other of [OTHER, OLD]) {
      const res = await api.request(method, `/vms/${other.id}${action}`, { token: cara, json })
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

  describe('on a project VM of someone else', () => {
    const answer = { ...HUB, state: 'pending' }
    beforeEach(async () => {
      // recreate reads the bundle of the VM name.
      await ensureVmBundle(join(api.workstationsDir, 'hub'), {
        workstation: 'hub',
        serverName: 'example.org',
        homeserverUrl: 'https://chat.example.org',
        space: 'dev',
      })
      for (const action of ['start', 'stop', 'reboot', 'recreate']) {
        api.controlPlane.on('POST', `/v1/vms/${HUB.id}/${action}`, jsonResponse(202, answer))
      }
      api.controlPlane.on('PUT', `/v1/vms/${HUB.id}/auto-stop`, jsonResponse(200, answer))
    })
    const routes = {
      start: ['POST', '/start'],
      stop: ['POST', '/stop'],
      reboot: ['POST', '/reboot'],
      'auto-stop': ['PUT', '/auto-stop', { auto_stop_hours: 3 }],
      recreate: ['POST', '/recreate', { haven_api_key: 'hk-new' }],
    } as const

    it.each(Object.keys(routes))('%s works for a vm-creator, with the three fields in the answer', async (name) => {
      const [method, action, json] = routes[name as keyof typeof routes] as readonly [string, string, unknown?]
      const res = await api.request(method, `/vms/${HUB.id}${action}`, { token: cara, json })
      expect(res.status).toBeLessThan(300)
      expect(await res.json()).toEqual(viewed(answer, false))
      expect(writes().map((r) => r.path)).toEqual([`/v1/vms/${HUB.id}${action}`])
      // An admin can set the project of the VM.
      expect(await (await api.request(method, `/vms/${HUB.id}${action}`, { json })).json()).toEqual(viewed(answer, true))
    })

    it('an agents-manager still gets 403', async () => {
      const dan = api.fake.openIdToken(DAN)
      for (const [method, action, json] of Object.values(routes) as (readonly [string, string, unknown?])[]) {
        const res = await api.request(method, `/vms/${HUB.id}${action}`, { token: dan, json })
        expect([res.status, await res.json()], action).toEqual([403, { error: 'forbidden' }])
      }
      expect(writes()).toEqual([])
    })

    it('a 202 without a body and a body that is not a VM object pass on unchanged', async () => {
      api.controlPlane.on('DELETE', `/v1/vms/${HUB.id}`, new Response(null, { status: 202 }))
      const deleted = await api.request('DELETE', `/vms/${HUB.id}`, { token: cara })
      expect([deleted.status, await deleted.text()]).toEqual([202, ''])
      api.controlPlane.on('POST', `/v1/vms/${HUB.id}/stop`, new Response(null, { status: 202 }))
      const empty = await api.request('POST', `/vms/${HUB.id}/stop`, { token: cara })
      expect([empty.status, await empty.text()]).toEqual([202, ''])
      for (const [reply, body] of [
        [new Response('accepted', { status: 202, headers: { 'content-type': 'text/plain' } }), 'accepted'],
        [jsonResponse(202, [HUB]), JSON.stringify([HUB])],
        [jsonResponse(202, { state: 'pending' }), JSON.stringify({ state: 'pending' })],
      ] as const) {
        api.controlPlane.on('POST', `/v1/vms/${HUB.id}/reboot`, reply)
        const res = await api.request('POST', `/vms/${HUB.id}/reboot`, { token: cara })
        expect([res.status, await res.text()]).toEqual([202, body])
      }
    })

    it('a delete decides inside the write queue, after a change of the owner', async () => {
      // A list that the owner route changes. The change ends only when the test lets it.
      const list = [OWN, OTHER, OLD, HUB]
      api.controlPlane.on('GET', '/v1/vms', () => jsonResponse(200, list))
      let release!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      api.controlPlane.on('PUT', `/v1/vms/${HUB.id}/owner`, async () => {
        await gate
        list[3] = { ...HUB, project_id: null }
        return jsonResponse(200, list[3])
      })
      api.controlPlane.on('DELETE', `/v1/vms/${HUB.id}`, new Response(null, { status: 202 }))
      // An admin takes hub out of its project: it becomes a personal VM of @dan.
      const out = api.request('PUT', `/vms/${HUB.id}/owner`, { json: { project_id: '' } })
      await vi.waitFor(() => expect(writes().map((r) => r.path)).toContain(`/v1/vms/${HUB.id}/owner`))
      const deleted = api.request('DELETE', `/vms/${HUB.id}`, { token: cara })
      await new Promise((resolve) => setTimeout(resolve, 30))
      release()
      expect((await out).status).toBe(200)
      const res = await deleted
      expect([res.status, await res.text()]).toEqual([404, JSON.stringify({ error: 'not found' })])
      expect(writes().map((r) => r.method)).toEqual(['PUT'])
    })

    it('a failed project list is 502 and nothing is written', async () => {
      api.controlPlane.on('GET', '/v1/projects', jsonResponse(500, { error: 'database is locked' }))
      for (const [method, action, json] of Object.values(routes) as (readonly [string, string, unknown?])[]) {
        const res = await api.request(method, `/vms/${HUB.id}${action}`, { token: cara, json })
        expect([res.status, await res.json()], action).toEqual([502, { error: 'control plane sent an invalid response' }])
      }
      expect(writes()).toEqual([])
    })
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
