/**
 * Runtime admission of agent identities: a port of deploy/add-workstation.sh that registers the
 * appservice through the tuwunel admin room, so tuwunel does not restart. The tuwunel v1.9.3 behavior
 * it relies on is in deploy/README.md, "Make `@zooid` a tuwunel admin (once)".
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MatrixClient } from '@zooid/transport-matrix'
import {
  AGENT_NAME_RE,
  MARKER,
  VM_NAME_RE,
  ensureVmBundle,
  envVar,
  readBundleEnv,
  removeBundle,
  renderRegistration,
  withServer,
  type Tokens,
  type VmBundleSpec,
} from './bundle.js'
import { ApiError } from './errors.js'
import { stateEvent, tokenAccepted, usernameAvailable, whoami, type MatrixConn } from './matrix.js'

export const REGISTER_COMMAND = '!admin appservices register'
export const UNREGISTER_COMMAND = '!admin appservices unregister'

/** The admin room message: the command, then the registration in a code block. */
export function registerMessage(registrationYaml: string): string {
  return `${REGISTER_COMMAND}\n\`\`\`\n${registrationYaml.trimEnd()}\n\`\`\``
}

type Step = 'bundle' | 'register_appservice' | 'whoami' | 'register_user' | 'join' | 'leave' | 'unregister'
type RunStep = <T>(name: Step, fn: () => Promise<T>) => Promise<T>

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
  /** Rooms of a new agent: FABRIUM_VM_ROOMS. */
  rooms: string[]
  /** Live app previews are on: the bundle turns them on for the VM. */
  previews?: boolean
  workstationsDir: string
  registrationsDir: string
  whoamiTimeoutMs?: number
  pollIntervalMs?: number
}

/** One agent on a VM name. */
export interface Placement {
  workstation: string
  agent: string
}

export interface Admitted {
  agentId: string
  /** The rooms that the agent joined, with the server name: the `rooms` of the record. */
  rooms: string[]
  /** The bundle `.env`, for the payload of a VM. */
  env: string
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** The routes run `admit` and `remove` inside the one queue of every write. */
export function createAdmission(deps: AdmissionDeps): {
  /**
   * Grant `@<vm>.<agent>` on the bundle of the VM name, in `rooms` (default: FABRIUM_VM_ROOMS). Each step is
   * safe to repeat. No roster.
   */
  admit(p: Placement & { rooms?: string[] }): Promise<Admitted>
  /** Leave, and for the last agent of the name: unregister and remove the bundle. Safe to repeat. */
  remove(p: Placement & { rooms: string[]; last: boolean }): Promise<void>
} {
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

  /** A refusal passes on as it is. Any other failure is a 502 that names the step. */
  const stepsOf =
    (action: string, ws: string): RunStep =>
    async (name, fn) => {
      try {
        return await fn()
      } catch (err) {
        if (err instanceof ApiError && err.status < 500) throw err
        const message = (err as Error).message
        console.warn(`[fabrium] ${action} of ${ws} failed at ${name}: ${message}`)
        throw new ApiError(502, { error: message, step: name })
      }
    }

  /**
   * Refuse a VM name that something else owns. A bundle with the marker is an earlier try of ours: this one
   * resumes it, for any agent, because an agent does not own a VM name.
   */
  async function checkWorkstation(dir: string, ws: string, agent: string): Promise<void> {
    for (const ext of ['yaml', 'yml']) {
      if (existsSync(join(deps.registrationsDir, `${ws}.${ext}`))) {
        throw conflict(`workstation ${ws} has a registration file from deploy/add-workstation.sh`)
      }
    }
    if (existsSync(dir)) {
      if (!existsSync(join(dir, MARKER))) {
        throw conflict(`workstation ${ws} already has a bundle that the VM API did not make`)
      }
      return
    }
    // The appservice's sender is `@<ws>`: an existing user of that name would be taken over.
    if (!(await usernameAvailable(deps.conn, deps.asToken, ws))) {
      throw conflict(`@${ws}:${deps.serverName} is already a Matrix user; choose another name`)
    }
    // The appservice owns `@<ws>.*`: no space member may live there (limits: deploy/README.md).
    const agentId = `@${ws}.${agent}:${deps.serverName}`
    if (!(await usernameAvailable(deps.conn, deps.asToken, `${ws}.${agent}`))) {
      throw conflict(`${agentId} is already a Matrix user; choose another name`)
    }
    const { joined } = await deps.client.getJoinedMembers(requireSpace(), deps.asUserId)
    const captured = Object.keys(joined).find(
      (id) => id.startsWith(`@${ws}.`) && id.endsWith(`:${deps.serverName}`),
    )
    if (captured) {
      throw conflict(
        `${captured} is in the workforce space: a VM named ${ws} would act as that user. Choose another name`,
      )
    }
  }

  async function waitFor(done: () => Promise<boolean>, failure: string): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (!(await done())) {
      if (Date.now() >= deadline) throw new Error(failure)
      await sleep(intervalMs)
    }
  }

  async function sendAdminCommand(body: string): Promise<void> {
    const adminRoom = await deps.client.resolveAlias(adminAlias)
    if (!adminRoom) throw new Error(`the admin room ${adminAlias} does not exist`)
    try {
      await deps.client.sendMessage({
        roomId: adminRoom,
        asUserId: deps.asUserId,
        content: { msgtype: 'm.text', body },
      })
    } catch (err) {
      throw new Error(`cannot send to the admin room (${(err as Error).message}). ${setupHint}`)
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

  // The central token reads the membership; the VM token leaves. A user who is not in the room is done.
  async function ensureLeft(vm: MatrixClient, roomId: string, userId: string): Promise<void> {
    const current = (await stateEvent(deps.conn, deps.asToken, roomId, 'm.room.member', userId))
      ?.membership
    if (current === 'join' || current === 'invite') await vm.leaveRoom(roomId, userId)
  }

  /** The steps from register_appservice to join, each safe to repeat. Returns the room IDs of the agent. */
  async function grant(
    spec: VmBundleSpec,
    tokens: Tokens,
    agent: string,
    rooms: string[],
    step: RunStep,
  ): Promise<string[]> {
    const ws = spec.workstation
    const sender = `@${ws}:${deps.serverName}`
    const agentId = `@${ws}.${agent}:${deps.serverName}`
    const vm = new MatrixClient({
      homeserver: deps.conn.homeserver,
      asToken: tokens.asToken,
      fetch: deps.conn.fetch,
    })

    await step('register_appservice', async () => {
      // Loaded already (an earlier try): a second register would fail with "Duplicate id".
      if ((await whoami(deps.conn, tokens.asToken)) === sender) return
      await sendAdminCommand(registerMessage(renderRegistration(spec, tokens)))
    })

    await step('whoami', () =>
      waitFor(
        async () => (await whoami(deps.conn, tokens.asToken)) === sender,
        `tuwunel did not load the registration within ${Math.round(timeoutMs / 1000)} s. ` +
          `Read the reply in ${adminAlias}. ${setupHint}`,
      ),
    )

    await step('register_user', async () => {
      await vm.registerBot(`${ws}.${agent}`)
    })

    const roomIds: string[] = []
    await step('join', async () => {
      const spaceId = requireSpace()
      for (const room of rooms) {
        const alias = withServer(room, deps.serverName)
        const roomId = alias.startsWith('!') ? alias : await deps.client.resolveAlias(alias)
        if (!roomId) throw new Error(`room ${alias} does not exist; create it first`)
        roomIds.push(roomId)
      }
      await ensureMember(vm, spaceId, sender, 'the workforce space')
      await ensureMember(vm, spaceId, agentId, 'the workforce space')
      for (const roomId of roomIds) await ensureMember(vm, roomId, agentId, roomId)
    })
    return roomIds
  }

  // The routes check the names first. This is the last check before a path, a Matrix ID, and an `rm`.
  function placement({ workstation: ws, agent }: Placement) {
    if (!VM_NAME_RE.test(ws) || !AGENT_NAME_RE.test(agent)) throw new Error('invalid VM or agent name')
    return {
      ws,
      dir: join(deps.workstationsDir, ws),
      sender: `@${ws}:${deps.serverName}`,
      agentId: `@${ws}.${agent}:${deps.serverName}`,
    }
  }

  return {
    async admit(p) {
      const { ws, dir, agentId } = placement(p)
      const spec: VmBundleSpec = {
        workstation: ws,
        serverName: deps.serverName,
        homeserverUrl: deps.homeserverUrl,
        space: deps.workforceSpace,
        previews: deps.previews,
      }
      const step = stepsOf('admission', ws)
      const bundle = await step('bundle', async () => {
        await checkWorkstation(dir, ws, p.agent)
        return ensureVmBundle(dir, spec)
      })
      const rooms = p.rooms ?? deps.rooms
      await grant(spec, bundle, p.agent, rooms, step)
      return {
        agentId,
        rooms: rooms.map((room) => withServer(room, deps.serverName)),
        env: bundle.env,
      }
    },

    async remove(p) {
      const { ws, dir, sender, agentId } = placement(p)
      const env = await readBundleEnv(dir)
      if (env === null) return
      const token = envVar(env, 'MATRIX_AS_TOKEN')
      if (!token) throw new Error(`the bundle of ${ws} has no MATRIX_AS_TOKEN`)
      const vm = new MatrixClient({ homeserver: deps.conn.homeserver, asToken: token, fetch: deps.conn.fetch })
      const step = stepsOf('removal', ws)

      await step('leave', async () => {
        for (const room of p.rooms) {
          const alias = withServer(room, deps.serverName)
          const roomId = alias.startsWith('!') ? alias : await deps.client.resolveAlias(alias)
          // A room that is gone has no member to remove.
          if (roomId) await ensureLeft(vm, roomId, agentId)
        }
        await ensureLeft(vm, requireSpace(), agentId)
      })
      if (!p.last) return

      await step('unregister', async () => {
        // The sender leaves first: its token stops working below.
        await ensureLeft(vm, requireSpace(), sender)
        // Only a 401 counts as gone: the bundle holds the only copy of the token.
        if (await tokenAccepted(deps.conn, token)) {
          await sendAdminCommand(`${UNREGISTER_COMMAND} ${ws}`)
          await waitFor(
            async () => !(await tokenAccepted(deps.conn, token)),
            `tuwunel did not unregister ${ws} within ${Math.round(timeoutMs / 1000)} s. ` +
              `Read the reply in ${adminAlias}. ${setupHint}`,
          )
        }
        await removeBundle(dir)
      })
    },
  }
}
