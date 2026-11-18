import { ApiError } from './errors.js'

/** The public Haven model list: HAVEN_PRICING_URL of deploy/agent-vm/configure-agent.sh. */
export const HAVEN_PRICING_URL = 'https://ankara.aquabtc.com/api/v1/haven/pricing/'

const TTL_MS = 5 * 60_000
const TIMEOUT_MS = 15_000

export interface Models {
  /** The IDs of the models that an agent can use. Throws `ApiError` 502 when the list does not answer. */
  list(): Promise<string[]>
}

/** Not deprecated, with tool calls: the jq filter of configure-agent.sh. Cached for 5 minutes. */
export function createModels(opts: { fetch: typeof fetch; url?: string; now?: () => number }): Models {
  const now = opts.now ?? Date.now
  let cached: { expires: number; models: string[] } | undefined
  return {
    async list() {
      if (cached && cached.expires > now()) return cached.models
      let body: unknown
      try {
        // The timeout covers the body too.
        const r = await opts.fetch(opts.url ?? HAVEN_PRICING_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) })
        body = r.ok ? await r.json() : undefined
      } catch {
        body = undefined
      }
      if (!Array.isArray(body)) throw new ApiError(502, { error: 'the Haven model list does not answer' })
      const models = (body as { id?: unknown; status?: unknown; capabilities?: { tool_call?: unknown } }[])
        .filter((m) => m?.status !== 'deprecated' && m?.capabilities?.tool_call !== false)
        .flatMap((m) => (typeof m?.id === 'string' ? [m.id] : []))
      cached = { expires: now() + TTL_MS, models }
      return models
    },
  }
}
