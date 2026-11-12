// Workstation side of the preview tunnel (PREVIEWS_SPEC.md §4.3). It only dials out,
// so it works from a VM that accepts no connections, also behind NAT.
import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import type { Socket } from 'node:net'
import {
  STREAM_PATH,
  TUNNEL_PATH,
  TUNNEL_PROTOCOL,
  dialLoopback,
  heartbeat,
  lineReader,
  type DownMessage,
  type PreviewState,
  type UpMessage,
} from './protocol.js'

const UPGRADE_TIMEOUT_MS = 15_000

export interface TunnelClientDeps {
  /** Origin of the gateway, e.g. `https://fabrium.example.net` or `http://127.0.0.1:9000`. */
  url: string
  /** The workstation's appservice token: the gateway checks it may act as each agent. */
  asToken: string
  snapshot(): Array<{ preview: PreviewState; log: string }>
  port(agentId: string, name: string): number | undefined
  restart(agentId: string, name: string): Promise<void>
  stop(agentId: string, name: string): Promise<void>
}

export interface TunnelClient {
  send(message: UpMessage): void
  close(): void
}

function upgrade(url: string, path: string, token: string): Promise<Socket> {
  const target = new URL(path, url)
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    const req: ClientRequest = request(target, {
      headers: { Connection: 'Upgrade', Upgrade: TUNNEL_PROTOCOL, Authorization: `Bearer ${token}` },
    })
    // A gateway that takes the connection but never answers would stall the reconnect loop.
    const timer = setTimeout(() => req.destroy(new Error('the gateway did not answer')), UPGRADE_TIMEOUT_MS)
    req.once('upgrade', (_res: IncomingMessage, socket: Socket, head: Buffer) => {
      clearTimeout(timer)
      if (head.length > 0) socket.unshift(head)
      resolve(socket)
    })
    req.once('response', (res: IncomingMessage) => {
      clearTimeout(timer)
      res.resume()
      reject(new Error(`gateway answered ${res.statusCode}`))
    })
    req.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    req.end()
  })
}

export function startTunnelClient(deps: TunnelClientDeps): TunnelClient {
  let control: Socket | undefined
  let closed = false
  let delay = 1000
  let warned = false

  const send = (message: UpMessage) => {
    if (control && !control.destroyed) control.write(JSON.stringify(message) + '\n')
  }

  async function openStream(stream: string, agentId: string, name: string): Promise<void> {
    const port = deps.port(agentId, name)
    if (port === undefined) return
    let app: Socket | undefined
    try {
      app = await dialLoopback(port)
      const pipe = await upgrade(deps.url, STREAM_PATH + encodeURIComponent(stream), deps.asToken)
      app.pipe(pipe).pipe(app)
      const end = () => {
        app?.destroy()
        pipe.destroy()
      }
      app.once('error', end).once('close', end)
      pipe.once('error', end).once('close', end)
    } catch {
      // The gateway times the stream out and answers 502 to the browser.
      app?.destroy()
    }
  }

  function onMessage(line: string): void {
    let msg: DownMessage
    try {
      msg = JSON.parse(line) as DownMessage
    } catch {
      return
    }
    if (typeof msg.agent_id !== 'string' || typeof msg.name !== 'string') return
    if (msg.t === 'open' && typeof msg.stream === 'string') void openStream(msg.stream, msg.agent_id, msg.name)
    else if (msg.t === 'restart' || msg.t === 'stop') {
      deps[msg.t](msg.agent_id, msg.name).catch((err: Error) => console.warn(`[previews] ${msg.t} ${msg.name}: ${err.message}`))
    }
  }

  async function run(): Promise<void> {
    while (!closed) {
      try {
        const socket = await upgrade(deps.url, TUNNEL_PATH, deps.asToken)
        control = socket
        delay = 1000
        warned = false
        heartbeat(socket)
        for (const { preview, log } of deps.snapshot()) send({ t: 'state', preview, log })
        const read = lineReader(onMessage)
        socket.on('data', (chunk: Buffer) => {
          if (!read(chunk)) socket.destroy()
        })
        await new Promise<void>((done) => {
          socket.once('close', () => done())
          socket.once('error', () => done())
        })
        control = undefined
      } catch (err) {
        if (!warned) console.warn(`[previews] tunnel to ${deps.url}: ${(err as Error).message}; retrying`)
        warned = true
      }
      if (closed) break
      await new Promise((r) => setTimeout(r, delay))
      delay = Math.min(delay * 2, 30_000)
    }
  }
  void run()

  return {
    send,
    close() {
      closed = true
      control?.destroy()
    },
  }
}
