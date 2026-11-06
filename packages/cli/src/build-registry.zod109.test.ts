import { describe, it, expect } from 'vitest'
import { LocalAcpRuntime } from '@zooid/runtime-local'
import { DockerAcpRuntime } from '@zooid/runtime-docker'
import type { AgentConfig, ZooidConfig } from '@zooid/core'
import { buildAcpRegistry, containerAgentNames } from './build-registry.js'

const CONFIG_DIR = '/tmp/zod109-workforce'

function agent(name: string, over: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name,
    workdir: `./agents/${name}`,
    hooks: {},
    acp: { command: 'node', args: ['agent.mjs'] },
    approval_timeout_ms: 0,
    session_idle_timeout_ms: 0,
    http: { transport: 'http-local' },
    ...over,
  }
}

function cfg(agents: Record<string, AgentConfig>, over: Partial<ZooidConfig> = {}): ZooidConfig {
  return {
    runtime: 'local',
    transports: { 'http-local': { type: 'http', port: 8080 } },
    agents,
    hooks: {},
    ...over,
  } as ZooidConfig
}

describe('buildAcpRegistry — mixed fleet (ZOD109)', () => {
  const mixed = () =>
    cfg({
      lead: agent('lead'),
      coder: agent('coder', { runtime: 'docker', container: { image: 'img:1' } }),
    })

  it('gives each agent the runtime its resolved kind calls for', () => {
    const reg = buildAcpRegistry(mixed(), { configDir: CONFIG_DIR, log: () => {} })
    expect(reg.runtimeFor('lead')).toBeInstanceOf(LocalAcpRuntime)
    expect(reg.runtimeFor('coder')).toBeInstanceOf(DockerAcpRuntime)
  })

  it('a docker agent in a local workforce still gets the workspace mount', () => {
    const reg = buildAcpRegistry(mixed(), { configDir: CONFIG_DIR, log: () => {} })
    expect(reg.resolveSpawnMounts('coder').map((m) => m.target)).toContain('/workspace')
    expect(reg.resolveSpawnCwd('lead')).toBe('./agents/lead')
  })

  it('containerAgentNames lists only docker/podman agents (the prepull set)', () => {
    expect(containerAgentNames(mixed())).toEqual(['coder'])
  })
})
