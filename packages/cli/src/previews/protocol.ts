import { connect, type Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

// Wire format of the preview tunnel between a workstation and the gateway (PREVIEWS_SPEC.md §4.3).
// Control: one HTTP/1.1 upgrade, newline-delimited JSON both ways. Data: one upgrade per stream.

export const TUNNEL_PROTOCOL = 'fabrium-tunnel'
export const TUNNEL_PATH = '/_fabrium/v1/tunnel'
export const STREAM_PATH = '/_fabrium/v1/tunnel/stream/'

export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
/** Keep the last this many bytes of app output per preview. */
export const LOG_LIMIT = 64 * 1024

export type PreviewStatus = 'starting' | 'running' | 'crashed' | 'stopped' | 'offline'
/** `expo`: a React Native app that Expo Go also opens (§3.8). */
export type PreviewKind = 'web' | 'expo'

/** What the workstation reports about one preview. The port never leaves the workstation. */
export interface PreviewState {
  agent_id: string
  name: string
  title: string
  command: string
  kind: PreviewKind
  room_id: string
  thread_root: string
  status: PreviewStatus
  /** RFC 3339. */
  since: string
  exit_code: number | null
}

/** Workstation → gateway. */
export type UpMessage =
  /** `log`: the retained output, sent once per preview on a new connection. */
  | { t: 'state'; preview: PreviewState; log?: string }
  | { t: 'log'; agent_id: string; name: string; text: string }
  | { t: 'remove'; agent_id: string; name: string }

/** Gateway → workstation. */
export type DownMessage =
  | { t: 'open'; stream: string; agent_id: string; name: string }
  | { t: 'restart' | 'stop'; agent_id: string; name: string }

export const previewKey = (agentId: string, name: string): string => `${agentId}\n${name}`

/**
 * Call `onLine` per complete line; false when a line exceeds `max` characters (the peer is untrusted).
 * Takes raw chunks: an upgraded server socket refuses `setEncoding`.
 */
export function lineReader(onLine: (line: string) => void, max = 256 * 1024): (chunk: Buffer) => boolean {
  const decoder = new StringDecoder('utf8')
  let buf = ''
  return (chunk) => {
    buf += decoder.write(chunk)
    let idx: number
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx)
      buf = buf.slice(idx + 1)
      if (line) onLine(line)
    }
    return buf.length <= max
  }
}

const PING_MS = 20_000
const SILENCE_MS = 60_000

/**
 * Ping the peer and end the connection after 60 s without data from it. TCP keepalive
 * takes minutes to notice a NAT drop or a laptop that slept; the reconnect loop then dials again.
 */
export function heartbeat(socket: Duplex): void {
  let last = Date.now()
  socket.on('data', () => (last = Date.now()))
  const timer = setInterval(() => {
    if (Date.now() - last > SILENCE_MS) socket.destroy()
    else socket.write('{"t":"ping"}\n')
  }, PING_MS)
  timer.unref()
  socket.once('close', () => clearInterval(timer))
}

/** Connect to an app on loopback: 127.0.0.1 first, then ::1 (Vite may bind only `localhost`). */
export function dialLoopback(port: number, timeoutMs?: number): Promise<Socket> {
  const one = (host: string) =>
    new Promise<Socket>((resolve, reject) => {
      const socket = connect({ host, port })
      socket.once('connect', () => {
        socket.setTimeout(0)
        resolve(socket)
      })
      socket.once('error', reject)
      if (timeoutMs) socket.setTimeout(timeoutMs, () => socket.destroy(new Error('connect timeout')))
    })
  return one('127.0.0.1').catch(() => one('::1'))
}
