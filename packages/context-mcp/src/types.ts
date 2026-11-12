import type { TransportContextProvider, ThreadRef } from '@zooid/core'

/**
 * Daemon-internal record keyed by spawn-id. One per ACP session that has
 * a TransportContextProvider attached.
 */
export interface SpawnBinding {
  spawnId: string
  agentName: string
  threadRef: ThreadRef
  provider: TransportContextProvider
  /** Exact ACP session key; the thread reference remains the context root. */
  sessionKey?: string
}

/** Shape we pass into ACP `session/new mcpServers[]`. */
export interface ZooidContextServerSpec {
  name: 'zooid-context'
  command: string
  args: string[]
  env: Array<{ name: string; value: string }>
}

/** Who calls a preview tool: from the authenticated spawn binding, never from the model. */
export interface PreviewCallerRef {
  agentName: string
  channelId: string
  threadId: string
}

/**
 * The daemon's preview supervisor, as the socket sees it. Inputs are the
 * model's raw tool arguments; the supervisor validates them.
 */
export interface PreviewActions {
  start(caller: PreviewCallerRef, input: Record<string, unknown>): Promise<unknown>
  stop(caller: PreviewCallerRef, input: Record<string, unknown>): Promise<unknown>
  logs(caller: PreviewCallerRef, input: Record<string, unknown>): unknown
}
