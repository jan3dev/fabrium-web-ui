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
import { createAdmission } from './admission.js'
import type { AgentRecord } from './agent-records.js'
import { createFakeMatrix } from './fake-matrix.js'
import { mountFabriumApi, type FabriumApiDeps } from './index.js'
import { HAVEN_PRICING_URL } from './models.js'
import type { Project } from './project-records.js'

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
 * Serves the agent routes of contracts section 1 from memory on the fake control plane, with its two 409 rules
 * and the 400 of an unknown project. A later `controlPlane.on` for the same route wins, so a test can still make
 * one route fail.
 */
export function fakeAgentStore(
  controlPlane: ReturnType<typeof createTestApi>['controlPlane'],
  projects: Project[] = [],
): {
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
  // Only a PUT reads "" as "clear": in a POST it is an unknown project.
  const unknownProject = (b: Body, put: boolean) =>
    b.project_id !== undefined &&
    b.project_id !== null &&
    !(put && b.project_id === '') &&
    !projects.some((p) => p.id === b.project_id)

  controlPlane.on('GET', '/v1/agents', () => jsonResponse(200, records))
  controlPlane.on('POST', '/v1/agents', (req) => {
    const b = req.body as Body
    if (unknownProject(b, false)) return jsonResponse(400, { error: 'unknown project' })
    const record: AgentRecord = {
      id: randomBytes(16).toString('hex'),
      name: b.name!,
      owner: b.owner!,
      description: b.description ?? '',
      model: b.model!,
      tag: b.tag || null,
      project: b.project || null,
      project_id: b.project_id ?? null,
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
    if (unknownProject(b, true)) return jsonResponse(400, { error: 'unknown project' })
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
      b.project_id === undefined ? {} : { project_id: b.project_id || null },
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

/**
 * Serves the project routes of contracts section 1 and `PUT /v1/vms/{id}/owner` from memory. A project is in use
 * while a record of `world.records` or a VM of `world.vms` has it. The owner route changes the entry of
 * `world.vms` with that id; `registered: false` stands for a VM without a registry row.
 */
export function fakeProjectStore(
  controlPlane: ReturnType<typeof createTestApi>['controlPlane'],
  projects: Project[],
  world: { records: AgentRecord[]; vms: Record<string, unknown>[] },
): void {
  const BY_ID = /^\/v1\/projects\/([^/]+)$/
  const idOf = (req: ControlPlaneRequest) => decodeURIComponent(BY_ID.exec(req.path.split('?')[0]!)?.[1] ?? '')
  const lower = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase())
  const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
  /** The 400 or 409 answer of a name, or undefined when `{"name"}` is fine for the project `id`. */
  function refuse(body: unknown, id?: string): Response | undefined {
    const b = body as { name?: unknown } | null
    if (typeof b !== 'object' || b === null || Object.keys(b).join() !== 'name' || typeof b.name !== 'string') {
      return jsonResponse(400, { error: 'invalid request body' })
    }
    const name = b.name
    const length = [...name].length
    if (length < 1 || length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(name) || name.trim() !== name) {
      return jsonResponse(400, { error: 'invalid project name' })
    }
    if (projects.some((p) => p.id !== id && lower(p.name) === lower(name))) {
      return jsonResponse(409, { error: 'name in use' })
    }
    return undefined
  }
  const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z')

  controlPlane.on('GET', '/v1/projects', () =>
    jsonResponse(
      200,
      [...projects].sort((a, b) => order(lower(a.name), lower(b.name)) || order(a.id, b.id)),
    ),
  )
  controlPlane.on('POST', '/v1/projects', (req) => {
    const refused = refuse(req.body)
    if (refused) return refused
    const at = now()
    const name = (req.body as { name: string }).name
    const made = { id: randomBytes(16).toString('hex'), name, created_at: at, updated_at: at }
    projects.push(made)
    return jsonResponse(201, made)
  })
  controlPlane.on('PUT', BY_ID, (req) => {
    const project = projects.find((p) => p.id === idOf(req))
    if (!project) return jsonResponse(404, { error: 'not found' })
    const refused = refuse(req.body, project.id)
    if (refused) return refused
    Object.assign(project, { name: (req.body as { name: string }).name, updated_at: now() })
    return jsonResponse(200, project)
  })
  controlPlane.on('DELETE', BY_ID, (req) => {
    const project = projects.find((p) => p.id === idOf(req))
    if (!project) return jsonResponse(404, { error: 'not found' })
    const has = (x: { project_id?: unknown }) => x.project_id === project.id
    if (world.records.some(has) || world.vms.some(has)) return jsonResponse(409, { error: 'project in use' })
    projects.splice(projects.indexOf(project), 1)
    return new Response(null, { status: 204 })
  })
  controlPlane.on('PUT', /^\/v1\/vms\/[^/]+\/owner$/, (req) => {
    const b = req.body as { project_id?: unknown; creator?: unknown } | null
    const keys = typeof b === 'object' && b !== null ? Object.keys(b) : []
    if (keys.length === 0 || keys.some((k) => k !== 'project_id' && k !== 'creator')) {
      return jsonResponse(400, { error: 'invalid request body' })
    }
    if (b!.project_id !== undefined && b!.project_id !== '' && !projects.some((p) => p.id === b!.project_id)) {
      return jsonResponse(400, { error: 'unknown project' })
    }
    const id = decodeURIComponent(req.path.split('/')[3]!)
    const vm = world.vms.find((v) => v.id === id)
    if (!vm) return jsonResponse(404, { error: 'not found' })
    if (vm.registered === false) return jsonResponse(409, { error: 'vm has no registry row' })
    if (b!.project_id !== undefined) vm.project_id = b!.project_id || null
    if (b!.creator !== undefined) vm.creator = b!.creator
    return jsonResponse(200, vm)
  })
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
  // A tenant without projects, until a test installs the route.
  controlPlane.on('GET', '/v1/projects', () => jsonResponse(200, []))

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
  /** The public Haven model list. With `up` false it answers 503. No test reaches the network. */
  const haven = { up: true, models: [{ id: 'glm-5-3' }] as unknown[] }
  const fetchAll = ((input: string, init?: RequestInit) =>
    input.startsWith(CONTROL_PLANE_URL)
      ? controlPlaneFetch(input, init)
      : input.startsWith(HAVEN_PRICING_URL)
        ? Promise.resolve(haven.up ? jsonResponse(200, haven.models) : jsonResponse(503, {}))
        : fake.fetch(input, init)) as typeof fetch

  const homeserver = 'http://tuwunel:8448'
  /** The central appservice client, `@zooid`, without the timeout of the API. */
  const client = new MatrixClient({ homeserver, asToken: fake.centralToken, fetch: fetchAll })
  const deps: FabriumApiDeps = {
    controlPlaneUrl: CONTROL_PLANE_URL,
    controlPlaneKey: CONTROL_PLANE_KEY,
    havenModel: 'glm-5-3',
    vmRooms: ['#general'],
    zooidCommit: COMMIT,
    homeserverUrl: 'https://chat.example.org',
    zooidHome,
    previews: false,
    conn: { homeserver, fetch: fetchAll },
    asToken: fake.centralToken,
    asUserId: '@zooid:example.org',
    serverName: 'example.org',
    workforceSpace: 'dev',
    getSpaceRoomId: () => fake.spaceId,
    ...overrides,
  }
  const app = new Hono()
  const { rebuildRosters } = mountFabriumApi(app, deps)

  fake.joinSpace(ADMIN, 90)
  fake.joinSpace(MEMBER, 0)
  const adminToken = fake.openIdToken(ADMIN)
  const memberToken = fake.openIdToken(MEMBER)

  return {
    app,
    fake,
    deps,
    client,
    controlPlane,
    haven,
    zooidHome,
    workstationsDir,
    registrationsDir,
    adminToken,
    memberToken,
    rebuildRosters,
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
    /** Admit `agent` on the VM name `vm`, as an assign does before it writes the record. */
    admit(vm: string, agent: string) {
      return createAdmission({
        conn: deps.conn,
        client,
        asToken: deps.asToken,
        asUserId: deps.asUserId,
        serverName: deps.serverName,
        homeserverUrl: deps.homeserverUrl,
        workforceSpace: deps.workforceSpace,
        getSpaceRoomId: deps.getSpaceRoomId,
        rooms: deps.vmRooms,
        workstationsDir,
        registrationsDir,
      }).admit({ workstation: vm, agent })
    },
    cleanup() {
      rmSync(zooidHome, { recursive: true, force: true })
    },
  }
}
