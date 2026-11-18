import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { AGENT_NAME_RE, VM_NAME_RE } from './bundle.js'
import { readBody, type ControlPlane } from './control-plane.js'
import { ApiError } from './errors.js'

/** An agent of the control plane (contracts section 1). */
export interface AgentRecord {
  id: string
  name: string
  owner: string
  description: string
  model: string
  tag: string | null
  project: string | null
  vm: string | null
  rooms: string[]
}

const invalid = () => new ApiError(502, { error: 'control plane sent an invalid response' })
const recordPath = (id: string) => `/v1/agents/${encodeURIComponent(id)}`

const isText = (value: unknown) => value === null || typeof value === 'string'

/** The name and the VM become Matrix IDs and paths: a record outside their rules is not used. */
function isRecord(value: unknown): value is AgentRecord {
  const r = value as Partial<Record<keyof AgentRecord, unknown>> | null
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof r.id === 'string' &&
    typeof r.name === 'string' &&
    AGENT_NAME_RE.test(r.name) &&
    typeof r.owner === 'string' &&
    typeof r.description === 'string' &&
    typeof r.model === 'string' &&
    isText(r.tag) &&
    isText(r.project) &&
    (r.vm === null || (typeof r.vm === 'string' && VM_NAME_RE.test(r.vm))) &&
    Array.isArray(r.rooms) &&
    r.rooms.every((room) => typeof room === 'string')
  )
}

/** The JSON answer. A status below 500 passes on with its body. Any other failure is a 502. */
async function call(cp: ControlPlane, method: string, path: string, body?: unknown): Promise<unknown> {
  const upstream = await cp.request(method, path, body)
  const text = await readBody(upstream)
  let json: unknown
  try {
    json = text === '' ? undefined : JSON.parse(text)
  } catch {
    json = undefined
  }
  if (upstream.ok && (json !== undefined || upstream.status === 204)) return json
  const error = (json as { error?: unknown } | undefined)?.error
  if (!upstream.ok && upstream.status < 500 && typeof error === 'string') {
    throw new ApiError(upstream.status as ContentfulStatusCode, { error })
  }
  // The status only: the body is the upstream's.
  console.warn(`[fabrium] control plane answered ${upstream.status} to ${method} ${path}`)
  throw invalid()
}

function record(value: unknown): AgentRecord {
  if (!isRecord(value)) throw invalid()
  return value
}

export async function fetchRecords(cp: ControlPlane): Promise<AgentRecord[]> {
  const list = await call(cp, 'GET', '/v1/agents')
  if (!Array.isArray(list)) throw invalid()
  return list.map(record)
}

export async function createRecord(cp: ControlPlane, body: Record<string, unknown>): Promise<AgentRecord> {
  return record(await call(cp, 'POST', '/v1/agents', body))
}

export async function changeRecord(
  cp: ControlPlane,
  id: string,
  body: Record<string, unknown>,
): Promise<AgentRecord> {
  return record(await call(cp, 'PUT', recordPath(id), body))
}

/** A 404 counts as removed. */
export async function removeRecord(cp: ControlPlane, id: string): Promise<void> {
  try {
    await call(cp, 'DELETE', recordPath(id))
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) throw err
  }
}
