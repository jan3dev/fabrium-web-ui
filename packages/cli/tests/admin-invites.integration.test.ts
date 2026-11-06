// [[148]] against a real Tuwunel: under the `zooid start` provisioning path (no
// --admin-user, invite-only space) a user named in `transports.<name>.admins`
// ends up invited to the space, an agent room and #general; a restart over
// existing rooms neither fails nor re-invites; an admin added later is picked up.
//
// Replays the provisioning sequence start-daemon.ts runs (space → BotPool
// bootstrap → #general → ensureAdminsInvited) rather than booting the whole
// daemon, which also needs ACP agents. Not run in the sandbox it was written in.
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  BotPool,
  MatrixClient,
  ensureAdminsInvited,
  ensureDefaultChannel,
  ensureWorkforceSpace,
  type AgentBinding,
} from '@zooid/transport-matrix'
import { writeBootstrapConfigs } from '../src/bootstrap/configs.js'
import { resolvePaths } from '../src/bootstrap/paths.js'
import { ensureTokens } from '../src/bootstrap/tokens.js'
import { TuwunelService } from '../src/services/tuwunel.js'

function dockerAvailable(): boolean {
  try { execSync('docker info', { stdio: 'ignore' }); return true } catch { return false }
}

// 18448-18450 are taken by the other cli integration suites.
const HOST_PORT = 18451
const HS = `http://localhost:${HOST_PORT}`
const AS_USER = '@zooid:localhost'
const AGENT = '@arch:localhost'
const ALICE = '@alice:localhost'
const BOB = '@bob:localhost'

let workDir: string
let svc: TuwunelService
let client: MatrixClient

/** One `zooid start` provisioning pass. Returns the room IDs it covered. */
async function start(admins: string[]) {
  const spaceId = await ensureWorkforceSpace({
    client, asUserId: AS_USER, serverName: 'localhost', spaceLocalpart: 'dev',
    preset: 'public_chat', admins, joinRule: 'invite',
  })
  const binding: AgentBinding = {
    name: 'arch', userId: AGENT, trigger: 'mention', rooms: [{ alias: '#architecture:localhost' }],
  }
  await new BotPool(client, [binding]).bootstrap({ spaceRoomId: spaceId, asUserId: AS_USER, adminUserIds: admins })
  const generalId = await ensureDefaultChannel({
    client, asUserId: AS_USER, serverName: 'localhost', spaceId, admins,
  })
  const roomId = binding.rooms[0]!.alias
  expect(roomId.startsWith('!')).toBe(true)
  await ensureAdminsInvited({ client, asUserId: AS_USER, admins, roomIds: [spaceId, generalId, roomId] })
  return { spaceId, generalId, roomId }
}

async function membership(roomId: string, user: string): Promise<string | undefined> {
  const state = await client.fetchRoomState(roomId, AS_USER)
  const ev = state.find((e) => e.type === 'm.room.member' && e.state_key === user)
  return (ev?.content as { membership?: string } | undefined)?.membership
}

describe.skipIf(!dockerAvailable() && !process.env.CI)('config admins are invited on start ([[148]])', () => {
  beforeAll(async () => {
    if (!dockerAvailable()) throw new Error('Docker is required when CI is set; this suite must not pass by skipping')
    workDir = mkdtempSync(join(tmpdir(), 'zooid-admins-'))
    const paths = resolvePaths(join(workDir, 'data', 'matrix'))
    const tokens = ensureTokens(paths.envPath)
    writeBootstrapConfigs({
      paths, serverName: 'localhost', asToken: tokens.asToken, hsToken: tokens.hsToken,
      senderLocalpart: 'zooid', userNamespace: '@.*:localhost',
    })
    svc = new TuwunelService({ name: `zooid-tuwunel-admins-${Date.now()}`, hostPort: HOST_PORT, paths, engine: 'docker' })
    await svc.start()
    await svc.waitHealthy({ url: HS, timeoutMs: 60_000 })
    client = new MatrixClient({ homeserver: HS, asToken: tokens.asToken })
    for (const lp of ['zooid', 'arch', 'alice', 'bob']) await client.registerBot(lp)
  }, 90_000)

  afterAll(async () => {
    await svc?.stop().catch(() => {})
    rmSync(workDir, { recursive: true, force: true })
  })

  let rooms: { spaceId: string; generalId: string; roomId: string }

  it('invites a configured admin to the space, an agent room and #general', async () => {
    rooms = await start([ALICE])
    for (const id of [rooms.spaceId, rooms.generalId, rooms.roomId]) {
      expect(await membership(id, ALICE)).toBe('invite')
    }
  }, 60_000)

  it('a restart over existing rooms succeeds and leaves the invite in place', async () => {
    const again = await start([ALICE])
    expect(again).toEqual(rooms)
    for (const id of [rooms.spaceId, rooms.generalId, rooms.roomId]) {
      expect(await membership(id, ALICE)).toBe('invite')
    }
  }, 60_000)

  it('invites an admin added to the config after the rooms exist, without touching the first', async () => {
    await start([ALICE, BOB])
    for (const id of [rooms.spaceId, rooms.generalId, rooms.roomId]) {
      expect(await membership(id, BOB)).toBe('invite')
      expect(await membership(id, ALICE)).toBe('invite')
    }
  }, 60_000)

  it('leaves an admin who has joined alone on the next start', async () => {
    for (const id of [rooms.spaceId, rooms.generalId, rooms.roomId]) await client.joinRoom(id, ALICE)
    await start([ALICE, BOB])
    for (const id of [rooms.spaceId, rooms.generalId, rooms.roomId]) {
      expect(await membership(id, ALICE)).toBe('join')
    }
  }, 60_000)
})
