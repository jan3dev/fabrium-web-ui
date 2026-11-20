import { isAbsolute, resolve } from 'node:path'
import { resolveAgentRuntime, type AgentConfig, type ZooidConfig } from '@zooid/core'
import type { AgentBinding } from '@zooid/transport-matrix'

/** The binding of one matrix agent: what start-daemon.ts built inline. Copies `senders`. */
export function toAgentBinding(a: AgentConfig, config: ZooidConfig, configDir: string): AgentBinding {
  const m = a.matrix
  if (!m) throw new Error(`agents.${a.name} has no matrix block`)
  const binding: AgentBinding = {
    name: a.name,
    userId: m.user_id,
    rooms: m.rooms,
    trigger: m.trigger,
  }
  if (m.display_name !== undefined) binding.displayName = m.display_name
  if (a.persona !== undefined) binding.persona = a.persona
  if (a.project !== undefined) binding.project = a.project
  // Resolve workspace dirs for media attachment routing.
  const workspaceDir = isAbsolute(a.workdir) ? a.workdir : resolve(configDir, a.workdir)
  binding.workspaceDir = workspaceDir
  // Containers see the workdir at /workspace.
  binding.agentWorkspacePath = resolveAgentRuntime(a, config) === 'local' ? workspaceDir : '/workspace'
  if (m.senders !== undefined) binding.senders = m.senders
  return binding
}
