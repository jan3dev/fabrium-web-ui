/**
 * Runtime admission of a new agent identity: a port of deploy/add-workstation.sh
 * that registers the appservice through the tuwunel admin room, so tuwunel does
 * not restart and the chat does not stop.
 *
 * Verified against tuwunel v1.9.3 (https://github.com/matrix-construct/tuwunel/blob/v1.9.3/):
 * - The admin room has the alias `#admins:<server_name>` (src/service/admin/mod.rs).
 * - The command is `!admin appservices register` on the first line. The
 *   registration YAML follows in a Markdown code block: the second line starts
 *   with three backticks, the last line is three backticks. Blank lines are
 *   dropped (src/admin/appservice/register.rs, src/service/admin/processor.rs).
 * - A user is a server admin when joined to the admin room. There is no power
 *   level check (`user_is_admin`). One-time setup: an existing admin sends
 *   `!admin users make-user-admin zooid` in that room (src/admin/user/make_user_admin.rs).
 * - The reply is an `m.notice` of the server user in the admin room, as a reply
 *   to the command: `Appservice registered with ID: <id>`, or `Command failed
 *   with error:` and a code block (src/service/admin/respond.rs).
 * - A registration ID that is loaded already fails with `Duplicate id`, so a
 *   retry checks `whoami` first (src/service/appservice/mod.rs).
 * - `!admin appservices unregister <id>` removes a registration made this way.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { MatrixClient } from '@zooid/transport-matrix'
import {
  MARKER,
  bundleAgent,
  ensureBundle,
  renderRegistration,
  withServer,
  type Bundle,
  type BundleSpec,
} from './bundle.js'
import { ApiError } from './errors.js'
import { stateEvent, usernameAvailable, whoami, type MatrixConn } from './matrix.js'

export const REGISTER_COMMAND = '!admin appservices register'

/** The admin room message: the command, then the registration in a code block. */
export function registerMessage(registrationYaml: string): string {
  return `${REGISTER_COMMAND}\n\`\`\`\n${registrationYaml.trimEnd()}\n\`\`\``
}

type Step = 'bundle' | 'register_appservice' | 'whoami' | 'register_user' | 'join' | 'roster'

export interface AdmissionDeps {
  conn: MatrixConn
  /** Central appservice client, `@zooid`: it must be a server admin. */
  client: MatrixClient
  asToken: string
  asUserId: string
  serverName: string
  /** Public URL of the homeserver, for the bundle of the VM. */
  homeserverUrl: string
  /** Localpart of the workforce space. */
  workforceSpace: string
  getSpaceRoomId(): string | undefined
  /** Rooms of the new agent. */
  rooms: string[]
  workstationsDir: string
  registrationsDir: string
  whoamiTimeoutMs?: number
  pollIntervalMs?: number
}

export interface NewAgent {
  workstation: string
  agent: string
  persona?: string
  project?: string
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function createAdmission(deps: AdmissionDeps): { admitNew(agent: NewAgent): Promise<Bundle> } {
  const timeoutMs = deps.whoamiTimeoutMs ?? 30_000
  const intervalMs = deps.pollIntervalMs ?? 500
  const adminAlias = `#admins:${deps.serverName}`
  const setupHint = `Check that @zooid is a server admin: an admin sends "!admin users make-user-admin zooid" in ${adminAlias} (deploy/README.md).`

  const conflict = (message: string) => new ApiError(409, { error: message })

  function requireSpace(): string {
    const spaceId = deps.getSpaceRoomId()
    if (!spaceId) throw new Error('the workforce space is not ready')
    return spaceId
  }

  /**
   * Refuse a workstation that something else owns. Returns true when an earlier
   * try of this admission made the bundle, so this one resumes.
   */
  async function checkWorkstation(dir: string, a: NewAgent): Promise<boolean> {
    const { workstation: ws } = a
    for (const ext of ['yaml', 'yml']) {
      if (existsSync(join(deps.registrationsDir, `${ws}.${ext}`))) {
        throw conflict(`workstation ${ws} has a registration file from deploy/add-workstation.sh`)
      }
    }
    if (existsSync(dir)) {
      if (!existsSync(join(dir, MARKER))) {
        throw conflict(`workstation ${ws} already has a bundle that the VM API did not make`)
      }
      const other = await bundleAgent(dir)
      if (other && other !== a.agent) throw conflict(`workstation ${ws} belongs to agent ${other}`)
      return true
    }
    // The sender of the new appservice is always in its namespace. If @<ws> exists
    // already, the VM token would act as that user.
    if (!(await usernameAvailable(deps.conn, deps.asToken, ws))) {
      throw conflict(`@${ws}:${deps.serverName} is already a Matrix user; choose another name`)
    }
    return false
  }

  async function pollWhoami(token: string, expected: string): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while ((await whoami(deps.conn, token)) !== expected) {
      if (Date.now() >= deadline) {
        throw new Error(
          `tuwunel did not load the registration within ${Math.round(timeoutMs / 1000)} s. ` +
            `Read the reply in ${adminAlias}. ${setupHint}`,
        )
      }
      await sleep(intervalMs)
    }
  }

  // The central token invites; the VM token joins.
  async function ensureMember(vm: MatrixClient, roomId: string, userId: string, label: string) {
    const current = (await stateEvent(deps.conn, deps.asToken, roomId, 'm.room.member', userId))
      ?.membership
    if (current === 'join') return
    if (current === 'ban') throw new Error(`${userId} is banned from ${label}`)
    // A restricted room lets space members join without an invite: ignore a refused invite.
    if (current !== 'invite') {
      await deps.client
        .invite({ roomId, asUserId: deps.asUserId, targetUserId: userId })
        .catch(() => {})
    }
    try {
      await vm.joinRoom(roomId, userId)
    } catch (err) {
      throw new Error(`${userId} cannot join ${label}: ${(err as Error).message}`)
    }
  }

  async function admit(a: NewAgent): Promise<Bundle> {
    const { workstation: ws, agent } = a
    const sender = `@${ws}:${deps.serverName}`
    const agentId = `@${ws}.${agent}:${deps.serverName}`
    const spec: BundleSpec = {
      workstation: ws,
      agent,
      serverName: deps.serverName,
      homeserverUrl: deps.homeserverUrl,
      space: deps.workforceSpace,
      rooms: deps.rooms,
    }
    const step = async <T>(name: Step, fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn()
      } catch (err) {
        // A refusal is for the caller as it is; everything else is a failed step.
        if (err instanceof ApiError && err.status < 500) throw err
        const message = (err as Error).message
        console.warn(`[fabrium] admission of ${ws} failed at ${name}: ${message}`)
        throw new ApiError(502, { error: message, step: name })
      }
    }

    const dir = join(deps.workstationsDir, ws)
    const bundle = await step('bundle', async () => {
      await checkWorkstation(dir, a)
      return ensureBundle(dir, spec)
    })
    const vm = new MatrixClient({
      homeserver: deps.conn.homeserver,
      asToken: bundle.asToken,
      fetch: deps.conn.fetch,
    })

    await step('register_appservice', async () => {
      // Loaded already (an earlier try): a second register would fail with "Duplicate id".
      if ((await whoami(deps.conn, bundle.asToken)) === sender) return
      const adminRoom = await deps.client.resolveAlias(adminAlias)
      if (!adminRoom) throw new Error(`the admin room ${adminAlias} does not exist`)
      try {
        await deps.client.sendMessage({
          roomId: adminRoom,
          asUserId: deps.asUserId,
          content: { msgtype: 'm.text', body: registerMessage(renderRegistration(spec, bundle)) },
        })
      } catch (err) {
        throw new Error(`cannot send to the admin room (${(err as Error).message}). ${setupHint}`)
      }
    })

    await step('whoami', () => pollWhoami(bundle.asToken, sender))

    await step('register_user', async () => {
      await vm.registerBot(`${ws}.${agent}`)
    })

    const roomIds: string[] = []
    await step('join', async () => {
      const spaceId = requireSpace()
      for (const room of deps.rooms) {
        const alias = withServer(room, deps.serverName)
        const roomId = alias.startsWith('!') ? alias : await deps.client.resolveAlias(alias)
        if (!roomId) throw new Error(`room ${alias} does not exist; create it first`)
        roomIds.push(roomId)
      }
      await ensureMember(vm, spaceId, sender, 'the workforce space')
      await ensureMember(vm, spaceId, agentId, 'the workforce space')
      for (const roomId of roomIds) await ensureMember(vm, roomId, agentId, roomId)
    })

    await step('roster', async () => {
      const spaceId = requireSpace()
      // The shape of buildWorkforceRoster (packages/transport-matrix/src/workforce-publisher.ts).
      const roster = {
        version: 1,
        agents: [
          {
            user_id: agentId,
            name: agent,
            rooms: roomIds,
            ...(a.persona ? { persona: a.persona } : {}),
            ...(a.project ? { project: a.project } : {}),
          },
        ],
      }
      const current = await stateEvent(deps.conn, deps.asToken, spaceId, 'dev.zooid.workforce', ws)
      if (isDeepStrictEqual(current, roster)) return
      await deps.client.sendStateEvent({
        roomId: spaceId,
        asUserId: deps.asUserId,
        eventType: 'dev.zooid.workforce',
        stateKey: ws,
        content: roster,
      })
    })

    return bundle
  }

  // ponytail: one queue for every admission; per-name locks only if admissions must run in parallel.
  let queue: Promise<unknown> = Promise.resolve()
  return {
    admitNew(agent) {
      const run = queue.then(() => admit(agent))
      queue = run.catch(() => {})
      return run
    },
  }
}
