/**
 * Test helper: the whole VM API mounted on a Hono app, with a fake homeserver,
 * a scripted control plane, and a temporary ZOOID_HOME. Production code never
 * imports it.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MatrixClient } from '@zooid/transport-matrix'
import { Hono } from 'hono'
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
     * A bundle for `workstation`, as an earlier admission left it: marked, registered in the fake
     * homeserver, with the agent in the workforce space and its roster entry published.
     * `registered: false` is an admission that stopped before the registration loaded;
     * `admitted: false` one that stopped after it, before the agent joined and the roster entry;
     * `legacy: true` is a bundle of add-workstation.sh, which has no marker.
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
