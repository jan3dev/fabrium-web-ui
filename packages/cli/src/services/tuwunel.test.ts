import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildRunArgs, TuwunelService } from './tuwunel.js'

describe('buildRunArgs', () => {
  const base = {
    name: 'zooid-tuwunel',
    image: 'ghcr.io/matrix-construct/tuwunel:latest',
    hostPort: 8448,
    paths: {
      dataDir: '/abs/data/matrix',
      dbDir: '/abs/data/matrix/db',
      mediaDir: '/abs/data/matrix/media',
      configDir: '/abs/data/matrix/config',
      registrationsDir: '/abs/data/matrix/config/registrations',
      tuwunelTomlPath: '/abs/data/matrix/config/tuwunel.toml',
      appserviceYamlPath: '/abs/data/matrix/config/registrations/zooid.yaml',
      envPath: '/abs/data/matrix/config/.env',
    },
  }

  it('uses docker by default, mounts persistent volumes and config read-only', () => {
    const args = buildRunArgs({ ...base, engine: 'docker' })
    expect(args[0]).toBe('run')
    expect(args).toContain('--rm')
    // Foregrounded so the parent process owns Tuwunel's stdio (logs).
    expect(args).not.toContain('-d')
    expect(args).toContain('--name')
    expect(args).toContain('zooid-tuwunel')
    expect(args).toContain('-p')
    expect(args).toContain('8448:8448')
    expect(args).toContain('/abs/data/matrix/db:/var/lib/tuwunel/db')
    expect(args).toContain('/abs/data/matrix/media:/var/lib/tuwunel/media')
    expect(args).toContain(
      '/abs/data/matrix/config/tuwunel.toml:/etc/tuwunel/tuwunel.toml:ro',
    )
    expect(args).toContain(
      '/abs/data/matrix/config/registrations:/var/lib/tuwunel/registrations:ro',
    )
    // ZOD041 deliberately does NOT mount ${dataRoot}/logs into the container.
    // Today the daemon captures tuwunel's stdout/stderr via captureChildToFile
    // — there's no internal tuwunel log directive yet. A future cycle that flips
    // tuwunel.toml to write its own logs can add the mount alongside that change.
    expect(args.some((a) => a.endsWith(':/var/log/tuwunel'))).toBe(false)
    expect(args).toContain('TUWUNEL_CONFIG=/etc/tuwunel/tuwunel.toml')
    expect(args[args.length - 1]).toBe(base.image)
  })

  it('engine: podman switches the binary (caller chooses), args are identical', () => {
    const docker = buildRunArgs({ ...base, engine: 'docker' })
    const podman = buildRunArgs({ ...base, engine: 'podman' })
    expect(podman).toEqual(docker)
  })

  it('honors a custom container name and host port', () => {
    const args = buildRunArgs({
      ...base,
      name: 'my-zooid-tuwunel',
      hostPort: 9000,
      engine: 'docker',
    })
    expect(args).toContain('my-zooid-tuwunel')
    expect(args).toContain('9000:8448')
  })
})

describe('TuwunelService.waitHealthy', () => {
  it('fails fast with the engine error when `run` exits (e.g. port taken)', async () => {
    // A stand-in engine: `run` fails like docker on a taken port; `inspect` knows no container.
    const engine = join(mkdtempSync(join(tmpdir(), 'zooid-engine-')), 'engine')
    writeFileSync(
      engine,
      '#!/bin/sh\necho "Bind for 0.0.0.0:8448 failed: port is already allocated" >&2\nexit 125\n',
    )
    chmodSync(engine, 0o755)
    const svc = new TuwunelService({
      name: 'zooid-tuwunel-test',
      hostPort: 8448,
      paths: {} as never,
      engine: engine as 'docker',
    })
    svc.start()
    const started = Date.now()
    await expect(
      svc.waitHealthy({ url: 'http://127.0.0.1:9', timeoutMs: 30_000 }),
    ).rejects.toThrow(/exited \(125\).*port is already allocated/)
    expect(Date.now() - started).toBeLessThan(10_000)
  })
})
