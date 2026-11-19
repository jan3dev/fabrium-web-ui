/**
 * The person rule (contracts section 2, "Person"): a joined member of the workforce space, on this server, who is
 * not an agent. One read of the space state gives the members, their names, and every roster.
 */
import { fetchRecords } from './agent-records.js'
import type { AgentContext } from './agents.js'
import { listBundleNames } from './bundle.js'
import { describeFailure } from './control-plane.js'
import { ApiError } from './errors.js'

export interface Person {
  user_id: string
  name: string
}

const notMember = () => new ApiError(400, { error: 'owner must be a member of the workspace' })

/** `@<local>:<this server>`, at most 255 printable characters. */
const onServer = (ctx: AgentContext, userId: string) =>
  /^@[^:]+:(.+)$/.exec(userId)?.[1] === ctx.serverName && userId.length <= 255 && /^[\x21-\x7e]+$/.test(userId)

const order = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** The joined members of this server with their names, and those of them that are not people. */
async function readSpace(ctx: AgentContext): Promise<{ members: Map<string, string>; agents: Set<string> }> {
  const spaceId = ctx.getSpaceRoomId()
  if (!spaceId) throw new ApiError(503, { error: 'workforce space is not ready' })
  const [state, records, bundles] = await Promise.all([
    ctx.client.fetchRoomState(spaceId, ctx.asUserId),
    fetchRecords(ctx.controlPlane),
    listBundleNames(ctx.workstationsDir),
  ]).catch((err: unknown) => {
    // A control plane failure is a 502 of its own already.
    if (err instanceof ApiError) throw err
    console.warn(`[fabrium] the workforce space was not read: ${describeFailure(err)}`)
    throw new ApiError(502, { error: 'homeserver unreachable' })
  })
  const vms = new Set(bundles)
  for (const r of records) if (r.vm !== null) vms.add(r.vm)
  const agents = new Set([ctx.asUserId, ...ctx.instanceAgents.map((a) => a.userId)])
  const members = new Map<string, string>()
  for (const event of state) {
    const content = (event.content ?? {}) as { membership?: unknown; displayname?: unknown; agents?: unknown }
    if (event.type === 'dev.zooid.workforce' && Array.isArray(content.agents)) {
      for (const a of content.agents as { user_id?: unknown }[]) {
        if (typeof a?.user_id === 'string') agents.add(a.user_id)
      }
    }
    const id = event.state_key
    if (event.type !== 'm.room.member' || content.membership !== 'join' || !id || !onServer(ctx, id)) continue
    const local = id.slice(1, id.indexOf(':'))
    // A VM name has no dot: `@<vm>` and `@<vm>.<anything>` both start with it.
    if (vms.has(local.split('.')[0]!)) agents.add(id)
    const name = typeof content.displayname === 'string' ? content.displayname.trim() : ''
    members.set(id, name || local)
  }
  return { members, agents }
}

/** Every person, sorted by name, then user_id, in code unit order. */
export async function listPeople(ctx: AgentContext): Promise<Person[]> {
  const { members, agents } = await readSpace(ctx)
  return [...members]
    .filter(([id]) => !agents.has(id))
    .map(([user_id, name]) => ({ user_id, name }))
    .sort((a, b) => order(a.name, b.name) || order(a.user_id, b.user_id))
}

/** Resolves for a person. The two 400 answers of "Person", the 503 of a space that is not ready, or a 502. */
export async function checkPerson(ctx: AgentContext, userId: string): Promise<void> {
  if (!onServer(ctx, userId)) throw notMember()
  const { members, agents } = await readSpace(ctx)
  if (!members.has(userId)) throw notMember()
  if (agents.has(userId)) throw new ApiError(400, { error: 'owner must be a person' })
}
