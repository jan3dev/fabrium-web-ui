import type { AgentConfig, RuntimeKind, ZooidConfig } from './types.js'

/** agent `runtime:` > workforce `runtime:` (which already defaulted to docker). [ZOD109] */
export function resolveAgentRuntime(
  agent: Pick<AgentConfig, 'runtime'>,
  cfg: Pick<ZooidConfig, 'runtime'>,
): RuntimeKind {
  return agent.runtime ?? cfg.runtime
}

/**
 * True when the agent gets the preview tools (PREVIEWS_SPEC.md §4.1): previews are on, it runs
 * on the host (v1), and `previews.agents` lists it when set.
 */
export function previewsFor(cfg: Pick<ZooidConfig, 'runtime' | 'agents' | 'previews'>, name: string): boolean {
  const agent = cfg.agents[name]
  if (!cfg.previews || !agent || resolveAgentRuntime(agent, cfg) !== 'local') return false
  return cfg.previews.agents?.includes(name) ?? true
}

export function isContainerRuntime(kind: RuntimeKind): kind is 'docker' | 'podman' {
  return kind === 'docker' || kind === 'podman'
}

/** The one container engine a workforce uses, or undefined when no agent runs in a container. */
export function containerEngineOf(
  cfg: Pick<ZooidConfig, 'runtime' | 'agents'>,
): 'docker' | 'podman' | undefined {
  for (const agent of Object.values(cfg.agents)) {
    const kind = resolveAgentRuntime(agent, cfg)
    if (isContainerRuntime(kind)) return kind
  }
  return undefined
}
