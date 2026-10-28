import { describe, it, expect } from 'vitest'
import { loadZooidConfig } from './config.js'

function cfg(transportExtra = '', rooms = '["#team"]', agentName = 'dev-agent'): string {
  return `
runtime: local
transports:
  matrix:
    type: matrix
    homeserver: http://localhost:8448
    as_token: t
    hs_token: h
    user_namespace: '@.*:example.org'
${transportExtra}
agents:
  ${agentName}:
    acp: { preset: opencode }
    matrix:
      rooms: ${rooms}
`
}

describe('transports.<name>.admins', () => {
  it('parses a list of MXIDs, deduped', () => {
    const c = loadZooidConfig(
      cfg("    admins: ['@alice:example.org', '@bob:other.org', '@alice:example.org']"),
    )
    const t = c.transports.matrix!
    expect(t.type === 'matrix' && t.admins).toEqual(['@alice:example.org', '@bob:other.org'])
  })

  it('is absent when not declared', () => {
    const t = loadZooidConfig(cfg()).transports.matrix!
    expect(t.type === 'matrix' && t.admins).toBeUndefined()
  })

  it('rejects a non-array, naming the field', () => {
    expect(() => loadZooidConfig(cfg("    admins: '@alice:example.org'"))).toThrow(
      /transports\.matrix\.admins must be an array/,
    )
  })

  it.each(['alice', '@alice', 'alice:example.org', '@:example.org', ''])(
    'rejects malformed MXID %j, naming the entry',
    (bad) => {
      expect(() => loadZooidConfig(cfg(`    admins: ['${bad}']`))).toThrow(
        /transports\.matrix\.admins\[0\] must look like @localpart:server/,
      )
    },
  )

  it('rejects a non-string entry', () => {
    expect(() => loadZooidConfig(cfg('    admins: [42]'))).toThrow(
      /transports\.matrix\.admins\[0\] must look like @localpart:server/,
    )
  })
})

describe('agent room alias vs the workforce space alias', () => {
  it('rejects #dev under the default space, naming agent, room and space', () => {
    expect(() => loadZooidConfig(cfg('', '["#dev"]', 'cp-dev'))).toThrow(
      'agents.cp-dev.matrix.rooms[0]: "#dev" collides with the workforce space alias ' +
        '(transports.matrix.space = "dev"); rename the room or set transports.matrix.space',
    )
  })

  it('rejects the fully-qualified form too', () => {
    expect(() => loadZooidConfig(cfg('', '["#dev:example.org"]'))).toThrow(/collides/)
  })

  it('accepts #dev on another server, which cannot resolve to the space', () => {
    expect(() => loadZooidConfig(cfg('', '["#dev:other.org"]'))).not.toThrow()
  })

  it('rejects the alias of an explicit space', () => {
    expect(() => loadZooidConfig(cfg('    space: acme', '["#team", "#acme"]'))).toThrow(
      /rooms\[1\]: "#acme" collides with the workforce space alias \(transports\.matrix\.space = "acme"\)/,
    )
  })

  it('allows #dev once the space is renamed', () => {
    expect(() => loadZooidConfig(cfg('    space: acme', '["#dev"]'))).not.toThrow()
  })
})
