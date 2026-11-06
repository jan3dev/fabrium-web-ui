// End-to-end test for MatrixContextProvider.sendAttachment against a real
// Tuwunel ([[ZOD068]]): the file is uploaded as the agent and lands as a
// threaded m.image / m.file, followed by the caption notice.
//
// Skipped without Docker. Not run in the sandbox this was written in; CI's
// test-infra job runs it via the `test:infra` script.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { MatrixClient } from '../src/matrix-client.js'
import { MediaClient } from '../src/media-client.js'
import { MatrixContextProvider } from '../src/context-provider.js'
import { startTuwunel, type TuwunelHandle } from './fixtures/tuwunel-fixture.js'

const here = dirname(fileURLToPath(import.meta.url))
const regDir = resolve(here, 'fixtures', 'registrations')

const AS_TOKEN = 'as-attach-' + randomUUID()
const HS_TOKEN = 'hs-attach-' + randomUUID()
const AGENT = '@attach-agent:localhost'

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function dockerAvailable() {
  try {
    execSync('docker info', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

let tuwunel: TuwunelHandle | undefined
let HS = ''

describe.skipIf(!dockerAvailable())('MatrixContextProvider.sendAttachment against tuwunel', () => {
  let client: MatrixClient
  let media: MediaClient
  let workdir: string
  let provider: MatrixContextProvider
  let roomId: string
  let rootId: string

  beforeAll(async () => {
    mkdirSync(regDir, { recursive: true })
    writeFileSync(
      resolve(regDir, 'zooid-attach.yaml'),
      [
        'id: zooid-attach',
        'url: http://host.docker.internal:9097',
        `as_token: ${AS_TOKEN}`,
        `hs_token: ${HS_TOKEN}`,
        'sender_localpart: zooid-attach',
        'rate_limited: false',
        'namespaces:',
        '  users:',
        '    - exclusive: true',
        "      regex: '@attach.*:localhost'",
        '  aliases: []',
        '  rooms: []',
      ].join('\n'),
    )
    tuwunel = await startTuwunel()
    HS = tuwunel.homeserver

    const reg = await fetch(`${HS}/_matrix/client/v3/register`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${AS_TOKEN}` },
      body: JSON.stringify({ type: 'm.login.application_service', username: 'attach-agent' }),
    })
    if (!reg.ok) throw new Error(`AS register failed: ${reg.status} ${await reg.text()}`)

    // The agent creates its own room and posts the thread root, so no invite dance.
    const asHeaders = { Authorization: `Bearer ${AS_TOKEN}`, 'content-type': 'application/json' }
    const created = await fetch(
      `${HS}/_matrix/client/v3/createRoom?user_id=${encodeURIComponent(AGENT)}`,
      { method: 'POST', headers: asHeaders, body: JSON.stringify({ name: 'attach-test' }) },
    )
    if (!created.ok) throw new Error(`createRoom failed: ${created.status} ${await created.text()}`)
    roomId = ((await created.json()) as { room_id: string }).room_id

    client = new MatrixClient({ homeserver: HS, asToken: AS_TOKEN })
    media = new MediaClient({ homeserver: HS, asToken: AS_TOKEN })
    rootId = (
      await client.sendMessage({
        roomId,
        asUserId: AGENT,
        content: { msgtype: 'm.text', body: 'thread root' },
      })
    ).event_id

    workdir = mkdtempSync(join(tmpdir(), 'zooid-attach-it-'))
    provider = new MatrixContextProvider({
      client,
      asUserId: AGENT,
      agentBots: new Map([[AGENT, 'attach-agent']]),
      media,
      workspace: { hostDir: workdir, agentPath: workdir, confined: false },
    })
  }, 120_000)

  afterAll(async () => {
    await tuwunel?.down()
  }, 120_000)

  it('lands an image as a threaded m.image from the agent, then the caption', async () => {
    writeFileSync(join(workdir, 'shot.png'), TINY_PNG)
    const res = await provider.sendAttachment!(roomId, rootId, {
      path: 'shot.png',
      caption: 'look',
    })

    const ev = await client.fetchEvent(roomId, res.event_id, AGENT)
    const content = ev!.content as Record<string, any>
    expect(ev!.sender).toBe(AGENT)
    expect(content.msgtype).toBe('m.image')
    expect(content.url).toBe(res.mxc_uri)
    expect(content['m.relates_to']).toMatchObject({ rel_type: 'm.thread', event_id: rootId })

    const down = await media.download({ mxcUri: res.mxc_uri, asUserId: AGENT })
    expect(Buffer.from(down.data).equals(TINY_PNG)).toBe(true)

    const thread = await client.fetchThreadRelations({
      roomId,
      rootEventId: rootId,
      asUserId: AGENT,
    })
    const ids = thread.chunk.map((e) => e.event_id)
    const caption = thread.chunk.find((e) => (e.content as { body?: string }).body === 'look')
    expect((caption!.content as { msgtype: string }).msgtype).toBe('m.notice')
    expect(ids.indexOf(caption!.event_id as string)).toBeGreaterThan(ids.indexOf(res.event_id))
  }, 60_000)

  it('lands a text file as a threaded m.file', async () => {
    writeFileSync(join(workdir, 'report.txt'), Buffer.alloc(600 * 1024, 'a'))
    const res = await provider.sendAttachment!(roomId, rootId, { path: 'report.txt' })
    const ev = await client.fetchEvent(roomId, res.event_id, AGENT)
    const content = ev!.content as Record<string, any>
    expect(content.msgtype).toBe('m.file')
    expect(content.info).toMatchObject({ mimetype: 'text/plain', size: 614400 })
  }, 60_000)
})
