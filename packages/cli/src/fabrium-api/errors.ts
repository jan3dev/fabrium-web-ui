import type { ErrorHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/** An error that the API answers as `{"error": ..., "step"?: ...}` with this status. */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly body: { error: string; step?: string },
  ) {
    super(body.error)
  }
}

export const apiErrorHandler: ErrorHandler = (err, c) => {
  if (err instanceof ApiError) return c.json(err.body, err.status)
  // The message only: a stack or a cause can hold a request URL with a token in it.
  console.error('[fabrium] unexpected error:', err.message)
  return c.json({ error: 'internal error' }, 500)
}
