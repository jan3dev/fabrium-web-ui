import { describe, it, expect } from 'vitest'
import { loadZooidConfig, mergeCliFlags } from './config.js'

const BASE = `
runtime: local
transports:
  http-local: { type: http, port: 8080 }
agents:
  qa:
    workdir: ./qa
    acp: { preset: claude }
    http: { transport: http-local }
`

describe('previews config', () => {
  it('is off when absent', () => {
    expect(loadZooidConfig(BASE).previews).toBeUndefined()
  })

  it('takes true and a mapping', () => {
    expect(loadZooidConfig(`${BASE}previews: true\n`).previews).toEqual({ max: 3 })
    const cfg = loadZooidConfig(
      `${BASE}previews:\n  origin: https://*.fabrium-preview.net\n  tunnel_url: https://fabrium.example.net/\n  max: 5\n  agents: [qa]\n`,
    )
    expect(cfg.previews).toEqual({
      origin: 'https://*.fabrium-preview.net',
      tunnel_url: 'https://fabrium.example.net',
      max: 5,
      agents: ['qa'],
    })
    expect(mergeCliFlags(cfg, {}).previews).toEqual(cfg.previews)
  })

  it('rejects a bad origin, tunnel url, or max', () => {
    expect(() => loadZooidConfig(`${BASE}previews: { origin: https://preview.example.net }\n`)).toThrow(/previews.origin/)
    expect(() => loadZooidConfig(`${BASE}previews: { tunnel_url: ftp://x }\n`)).toThrow(/previews.tunnel_url/)
    expect(() => loadZooidConfig(`${BASE}previews: { max: 0 }\n`)).toThrow(/previews.max/)
    expect(() => loadZooidConfig(`${BASE}previews: { agents: [ghost] }\n`)).toThrow(/no agent "ghost"/)
  })
})
