/**
 * The roster of a VM name: the state event `dev.zooid.workforce` of the workforce space, with the VM name as
 * state key (contracts section 3). The central daemon builds it from the agent records and is its only writer.
 */
import { isDeepStrictEqual } from 'node:util'
import type { MatrixClient } from '@zooid/transport-matrix'
import type { AgentRecord } from './agent-records.js'
import { listBundleNames, withServer } from './bundle.js'
import { stateEvent, type MatrixConn } from './matrix.js'
import type { Project } from './project-records.js'

export interface RosterDeps {
  conn: MatrixConn
  /** Central appservice client, `@zooid`. */
  client: MatrixClient
  asToken: string
  asUserId: string
  serverName: string
  getSpaceRoomId(): string | undefined
  workstationsDir: string
}

export function createRoster(deps: RosterDeps): {
  /** Builds the event of section 3 from the records whose vm is `vm`, and sends it only when it differs. */
  rebuild(vm: string, records: AgentRecord[], projects: readonly Project[]): Promise<void>
  /** Every VM name with a bundle or a record. One failure does not stop the others. */
  rebuildAll(records: AgentRecord[], projects: readonly Project[]): Promise<void>
} {
  async function rebuild(vm: string, records: AgentRecord[], projects: readonly Project[]): Promise<void> {
    const spaceId = deps.getSpaceRoomId()
    if (!spaceId) throw new Error('the workforce space is not ready')
    const mine = records
      .filter((r) => r.vm === vm)
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    const agents = []
    for (const r of mine) {
      const rooms: string[] = []
      for (const room of r.rooms) {
        const alias = withServer(room, deps.serverName)
        // A room that is gone is left out.
        const roomId = alias.startsWith('!') ? alias : await deps.client.resolveAlias(alias)
        if (roomId) rooms.push(roomId)
      }
      // The name of the project. The text label of phase 1 never goes in.
      const project = r.project_id === null ? undefined : projects.find((p) => p.id === r.project_id)?.name
      agents.push({
        user_id: `@${vm}.${r.name}:${deps.serverName}`,
        name: r.name,
        rooms,
        ...(r.tag ? { persona: r.tag } : {}),
        ...(project === undefined ? {} : { project }),
      })
    }
    const content = { version: 1, agents }
    const current = await stateEvent(deps.conn, deps.asToken, spaceId, 'dev.zooid.workforce', vm)
    if (isDeepStrictEqual(current, content)) return
    await deps.client.sendStateEvent({
      roomId: spaceId,
      asUserId: deps.asUserId,
      eventType: 'dev.zooid.workforce',
      stateKey: vm,
      content,
    })
  }

  return {
    rebuild,
    async rebuildAll(records, projects) {
      const names = new Set(await listBundleNames(deps.workstationsDir))
      for (const r of records) if (r.vm !== null) names.add(r.vm)
      for (const vm of [...names].sort()) {
        try {
          await rebuild(vm, records, projects)
        } catch (err) {
          // Our own messages: a status, a room, or an event type. Never a token.
          console.warn(`[fabrium] the roster of ${vm} was not rebuilt: ${(err as Error).message}`)
        }
      }
    },
  }
}
