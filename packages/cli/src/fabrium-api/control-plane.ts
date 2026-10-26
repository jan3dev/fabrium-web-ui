import { ApiError } from './errors.js'

export interface ControlPlane {
  /** Throws `ApiError` 502 when the control plane cannot be reached or does not answer in time. */
  request(method: string, path: string, body?: unknown): Promise<Response>
}

export interface ControlPlaneOptions {
  baseUrl: string
  /** The tenant API key. It only goes into the Authorization header. */
  apiKey: string
  fetch?: typeof fetch
  timeoutMs?: number
}

/**
 * What a log may say about a failed request: the error name and its code. Never the message: when Node
 * refuses a header, the message holds the header value, and that is the tenant key.
 */
export function describeFailure(err: unknown): string {
  const { name, cause } = err as { name?: string; cause?: { code?: unknown } }
  return [name ?? 'Error', typeof cause?.code === 'string' ? cause.code : undefined]
    .filter(Boolean)
    .join(' ')
}

export function createControlPlane(opts: ControlPlaneOptions): ControlPlane {
  const doFetch = opts.fetch ?? fetch
  return {
    async request(method, path, body) {
      try {
        return await doFetch(`${opts.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
        })
      } catch (err) {
        console.warn(`[fabrium] control plane unreachable: ${describeFailure(err)}`)
        throw new ApiError(502, { error: 'control plane unreachable' })
      }
    },
  }
}

/**
 * The body of an answer. The timeout of the request covers the body too, so a control plane that sends its
 * headers and then stalls ends here: the same failure as one that cannot be reached.
 */
export async function readBody(upstream: Response): Promise<string> {
  try {
    return await upstream.text()
  } catch (err) {
    console.warn(`[fabrium] control plane unreachable: ${describeFailure(err)}`)
    throw new ApiError(502, { error: 'control plane unreachable' })
  }
}

/** The answer of the control plane as the browser gets it: same status, body, and content type. */
export async function relay(upstream: Response): Promise<Response> {
  const text = await readBody(upstream)
  if (text === '') return new Response(null, { status: upstream.status })
  return new Response(text, {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
  })
}
