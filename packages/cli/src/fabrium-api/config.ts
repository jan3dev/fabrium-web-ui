import { readFileSync } from 'node:fs'

export interface FabriumApiConfig {
  /** Base URL of the control plane, without a trailing slash. */
  controlPlaneUrl: string
  /** The tenant API key. It never leaves the daemon. */
  controlPlaneKey: string
  havenModel?: string
  /** Rooms of a new agent: `#alias`, `#alias:server`, or `!id:server`. */
  vmRooms: string[]
  /** Full commit of the running image (`ZOOID_COMMIT`). */
  zooidCommit?: string
  /** Public URL of the homeserver, for the bundle of a VM. */
  homeserverUrl: string
  /** The instance directory: it holds `workstations/` and the tuwunel registrations. */
  zooidHome: string
}

// The rules of deploy/add-workstation.sh for --room.
const ROOM_RE = /^[#!][^\s'",\\]+$/
// The URL goes into the bundle `.env` as it is: no whitespace, quote, `$`, or backtick.
const SAFE_URL_RE = /^https?:\/\/[^\s'"\\$`]+$/

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** The create request sends the Haven and GitHub secrets: plain http is for a control plane on this host only. */
function controlPlaneUrl(value: string, name: string): void {
  let url: URL | undefined
  try {
    url = new URL(value)
  } catch {
    // reported below
  }
  if (url?.protocol !== 'https:' && !(url?.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new Error(`${name} must be an https URL (http only for localhost): the payload holds secrets`)
  }
}

/**
 * The VM management settings from the environment, or undefined when the
 * control plane URL or its key file is not set (the API is then not mounted).
 * A setting that is wrong stops the daemon at start. Messages never hold the key.
 */
export function loadFabriumApiConfig(
  env: NodeJS.ProcessEnv = process.env,
  readFile: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): FabriumApiConfig | undefined {
  const url = env.FABRIUM_CONTROL_PLANE_URL
  const keyFile = env.FABRIUM_CONTROL_PLANE_KEY_FILE
  if (!url || !keyFile) return undefined

  controlPlaneUrl(url, 'FABRIUM_CONTROL_PLANE_URL')
  const zooidHome = env.ZOOID_HOME
  if (!zooidHome) throw new Error('VM management needs ZOOID_HOME, the instance directory')
  const homeserverUrl = env.HOMESERVER_URL
  if (!homeserverUrl || !SAFE_URL_RE.test(homeserverUrl)) {
    throw new Error('VM management needs HOMESERVER_URL, the public URL of the homeserver')
  }
  const rooms = (env.FABRIUM_VM_ROOMS ?? '')
    .split(',')
    .map((room) => room.trim())
    .filter(Boolean)
  for (const room of rooms) {
    if (!ROOM_RE.test(room)) {
      throw new Error(
        `FABRIUM_VM_ROOMS: "${room}" is not a room. Use #alias or !id, without spaces, quotes, commas, or backslashes`,
      )
    }
  }

  let key: string
  try {
    key = readFile(keyFile).trim()
  } catch (err) {
    throw new Error(`FABRIUM_CONTROL_PLANE_KEY_FILE: cannot read ${keyFile}: ${(err as Error).message}`)
  }
  if (!key) throw new Error(`FABRIUM_CONTROL_PLANE_KEY_FILE: ${keyFile} is empty`)

  return {
    controlPlaneUrl: url.replace(/\/+$/, ''),
    controlPlaneKey: key,
    havenModel: env.FABRIUM_HAVEN_MODEL?.trim() || undefined,
    vmRooms: rooms.length > 0 ? rooms : ['#general'],
    zooidCommit: env.ZOOID_COMMIT?.trim() || undefined,
    homeserverUrl,
    zooidHome,
  }
}
