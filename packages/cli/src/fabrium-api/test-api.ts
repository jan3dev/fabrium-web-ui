/**
 * Test helper: the whole VM API mounted on a Hono app, with a fake homeserver,
 * a scripted control plane, and a temporary ZOOID_HOME. Production code never
 * imports it.
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MatrixClient } from '@zooid/transport-matrix'
import { Hono } from 'hono'
import type { AgentRecord } from './agent-records.js'
import { MARKER, ensureBundle, type BundleSpec } from './bundle.js'
import { createFakeMatrix } from './fake-matrix.js'
import { mountFabriumApi, type FabriumApiDeps } from './index.js'

export const CONTROL_PLANE_URL = 'https://control.example.org'
export const CONTROL_PLANE_KEY = 'tenant-key-0123456789'
export const COMMIT = '0123456789abcdef0123456789abcdef01234567'
export const ADMIN = '@ann:example.org'
export const MEMBER = '@bob:example.org'

export interface ControlPlaneRequest {
  method: string
  /** Path and query, as sent. */
  path: string
  authorization: string | null
  body: unknown
  signal?: AbortSignal | null
}

type Reply = Response | ((req: ControlPlaneRequest) => Response | Promise<Response>)

export const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** An answer that sends its headers and the start of a body, then stalls until the request is aborted. */
export const stalledResponse =
  (status = 200) =>
  (req: ControlPlaneRequest): Response =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('[{"id":'))
          req.signal?.addEventListener('abort', () => controller.error(req.signal?.reason))
        },
      }),
      { status, headers: { 'content-type': 'application/json' } },
    )

/**
 * Serves the agent routes of contracts section 1 from memory on the fake control plane, with its two 409 rules.
 * A later `controlPlane.on` for the same route wins, so a test can still make one route fail.
 */
export function fakeAgentStore(controlPlane: ReturnType<typeof createTestApi>['controlPlane']): {
  records: AgentRecord[]
} {
  const records: AgentRecord[] = []
  const BY_ID = /^\/v1\/agents\/([^/]+)$/
  const find = (req: ControlPlaneRequest) => {
    const id = decodeURIComponent(BY_ID.exec(req.path.split('?')[0]!)?.[1] ?? '')
    return records.find((r) => r.id === id)
  }
  // SQLite treats each NULL vm as distinct: two profiles can share a name.
  const nameInUse = (name: string, vm: string | null, id?: string) =>
    vm !== null && records.some((r) => r.vm === vm && r.name === name && r.id !== id)
  type Body = Partial<AgentRecord>

  controlPlane.on('GET', '/v1/agents', () => jsonResponse(200, records))
  controlPlane.on('POST', '/v1/agents', (req) => {
    const b = req.body as Body
    const record: AgentRecord = {
      id: randomBytes(16).toString('hex'),
      name: b.name!,
      owner: b.owner!,
      description: b.description ?? '',
      model: b.model!,
      tag: b.tag || null,
      project: b.project || null,
      vm: b.vm ?? null,
      rooms: b.rooms ?? [],
    }
    if (nameInUse(record.name, record.vm)) return jsonResponse(409, { error: 'name in use' })
    records.push(record)
    return jsonResponse(201, record)
  })
  controlPlane.on('PUT', BY_ID, (req) => {
    const record = find(req)
    if (!record) return jsonResponse(404, { error: 'not found' })
    const b = req.body as Body
    if (b.vm !== undefined) {
      if (record.vm !== null) return jsonResponse(409, { error: 'vm already set' })
      if (nameInUse(record.name, b.vm, record.id)) return jsonResponse(409, { error: 'name in use' })
    }
    Object.assign(
      record,
      Object.fromEntries(Object.entries(b).filter(([, value]) => value !== undefined)),
      // "" clears tag and project.
      b.tag === undefined ? {} : { tag: b.tag || null },
      b.project === undefined ? {} : { project: b.project || null },
    )
    return jsonResponse(200, record)
  })
  controlPlane.on('DELETE', BY_ID, (req) => {
    const record = find(req)
    if (!record) return jsonResponse(404, { error: 'not found' })
    records.splice(records.indexOf(record), 1)
    return new Response(null, { status: 204 })
  })
  return { records }
}

export function createTestApi(overrides: Partial<FabriumApiDeps> = {}) {
  const fake = createFakeMatrix()
  const zooidHome = mkdtempSync(join(tmpdir(), 'fabrium-api-'))
  const workstationsDir = join(zooidHome, 'workstations')
  const registrationsDir = join(zooidHome, 'data', 'matrix', 'config', 'registrations')
  mkdirSync(registrationsDir, { recursive: true })

  const requests: ControlPlaneRequest[] = []
  const replies: { method: string; path: string | RegExp; reply: Reply }[] = []
  const controlPlane = {
    requests,
    /** Answer `method path` (`path` without the query) with `reply`. A later call for the same route wins. */
    on(method: string, path: string | RegExp, reply: Reply) {
      replies.push({ method, path, reply })
    },
  }

  const controlPlaneFetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const parsed = new URL(url)
    const req: ControlPlaneRequest = {
      method: init?.method ?? 'GET',
      path: parsed.pathname + parsed.search,
      authorization: new Headers(init?.headers).get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      signal: init?.signal,
    }
    requests.push(req)
    const match = [...replies]
      .reverse()
      .find(
        (r) =>
          r.method === req.method &&
          (typeof r.path === 'string' ? r.path === parsed.pathname : r.path.test(parsed.pathname)),
      )
    if (!match) return jsonResponse(404, { error: 'not found' })
    return typeof match.reply === 'function' ? match.reply(req) : match.reply.clone()
  }
  const fetchAll = ((input: string, init?: RequestInit) =>
    input.startsWith(CONTROL_PLANE_URL)
      ? controlPlaneFetch(input, init)
      : fake.fetch(input, init)) as typeof fetch

  const homeserver = 'http://tuwunel:8448'
  const deps: FabriumApiDeps = {
    controlPlaneUrl: CONTROL_PLANE_URL,
    controlPlaneKey: CONTROL_PLANE_KEY,
    havenModel: 'glm-5-3',
    vmRooms: ['#general'],
    zooidCommit: COMMIT,
    homeserverUrl: 'https://chat.example.org',
    zooidHome,
    conn: { homeserver, fetch: fetchAll },
    client: new MatrixClient({ homeserver, asToken: fake.centralToken, fetch: fetchAll }),
    asToken: fake.centralToken,
    asUserId: '@zooid:example.org',
    serverName: 'example.org',
    workforceSpace: 'dev',
    getSpaceRoomId: () => fake.spaceId,
    ...overrides,
  }
  const app = new Hono()
  mountFabriumApi(app, deps)

  fake.joinSpace(ADMIN, 90)
  fake.joinSpace(MEMBER, 0)
  const adminToken = fake.openIdToken(ADMIN)
  const memberToken = fake.openIdToken(MEMBER)

  return {
    app,
    fake,
    deps,
    controlPlane,
    zooidHome,
    workstationsDir,
    registrationsDir,
    adminToken,
    memberToken,
    /** A request under /_fabrium/v1, as the admin unless `token` says otherwise (`null`: no header). */
    request(method: string, path: string, o: { token?: string | null; json?: unknown } = {}) {
      const token = o.token === undefined ? adminToken : o.token
      return app.request(`/_fabrium/v1${path}`, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(o.json !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: o.json === undefined ? undefined : JSON.stringify(o.json),
      })
    },
    /**
     * A bundle for `workstation` as a finished admission leaves it. `registered: false` stops it before the
     * registration loads, `admitted: false` before the join and the roster; `legacy: true` is add-workstation.sh's.
     */
    async bundle(
      workstation: string,
      agent: string,
      spec: Partial<BundleSpec> = {},
      opts: { registered?: boolean; admitted?: boolean; legacy?: boolean } = {},
    ) {
      const dir = join(workstationsDir, workstation)
      const bundle = await ensureBundle(dir, {
        workstation,
        agent,
        serverName: 'example.org',
        homeserverUrl: 'https://chat.example.org',
        space: 'dev',
        rooms: ['#general'],
        ...spec,
      })
      if (opts.legacy) rmSync(join(dir, MARKER))
      if (opts.registered !== false) {
        fake.registerAppservice({
          id: workstation,
          asToken: bundle.asToken,
          senderLocalpart: workstation,
          users: `@${workstation}\\..*:example\\.org`,
        })
        if (opts.admitted !== false) {
          fake.joinSpace(`@${workstation}:example.org`)
          fake.joinSpace(bundle.agentId)
          fake.setState(fake.spaceId, 'dev.zooid.workforce', workstation, {
            version: 1,
            agents: [{ user_id: bundle.agentId, name: agent, rooms: [fake.generalRoomId] }],
          })
        }
      }
      return bundle
    },
    cleanup() {
      rmSync(zooidHome, { recursive: true, force: true })
    },
  }
}
