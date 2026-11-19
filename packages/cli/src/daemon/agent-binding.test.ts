import { describe, expect, it } from 'vitest'
import { loadZooidConfig, mergeCliFlags } from '@zooid/core'
import { buildWorkforceRoster } from '@zooid/transport-matrix'
import { toAgentBinding } from './agent-binding.js'

// The config goes through the same calls as in startDaemon.
function load(senders?: string) {
  const base = loadZooidConfig(`
runtime: local
transports:
  matrix:
    type: matrix
    homeserver: http://localhost:8448
    as_token: as-secret
    hs_token: hs-secret
    sender_localpart: zooid
    user_namespace: '@.*:example.org'
agents:
  reviewer:
    workdir: ./reviewer
    acp: { preset: claude }
    persona: Reviewer
    project: Payments
    matrix:
      user_id: '@reviewer:example.org'
      display_name: Rev
      rooms: ['!r:example.org']
${senders === undefined ? '' : `      senders: ${senders}`}
`)
  const config = mergeCliFlags(base, {})
  return toAgentBinding(config.agents.reviewer!, config, '/srv/agents')
}

describe('toAgentBinding', () => {
  it('copies senders to the binding', () => {
    expect(load(`['@ana:example.org']`).senders).toEqual(['@ana:example.org'])
  })

  it('leaves senders undefined without the setting', () => {
    expect('senders' in load()).toBe(false)
  })

  it('keeps every other field it built before', () => {
    expect(load()).toEqual({
      name: 'reviewer',
      userId: '@reviewer:example.org',
      rooms: [{ alias: '!r:example.org' }],
      trigger: 'mention',
      displayName: 'Rev',
      persona: 'Reviewer',
      project: 'Payments',
      workspaceDir: '/srv/agents/reviewer',
      agentWorkspacePath: '/srv/agents/reviewer',
    })
  })

  it('does not put senders in the workforce roster', () => {
    const roster = buildWorkforceRoster([load(`['@ana:example.org']`)])
    expect(roster.agents[0]).not.toHaveProperty('senders')
    expect(JSON.stringify(roster)).not.toContain('@ana:example.org')
  })
})
