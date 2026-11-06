import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAttachmentPath } from './attachment-path.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'zooid-attach-'))

describe('resolveAttachmentPath', () => {
  describe('local', () => {
    const dir = tmp()
    const base = { hostDir: dir, agentPath: dir, confined: false }
    it('resolves relative paths against the workdir', () => {
      expect(resolveAttachmentPath({ ...base, path: 'out/r.pdf' })).toBe(join(dir, 'out/r.pdf'))
    })
    it('passes absolute paths through', () => {
      expect(resolveAttachmentPath({ ...base, path: '/etc/hosts' })).toBe('/etc/hosts')
    })
    it('allows ..', () => {
      expect(resolveAttachmentPath({ ...base, path: '../x.txt' })).toBe(resolve(dir, '../x.txt'))
    })
  })

  describe('container', () => {
    const dir = tmp()
    const base = { hostDir: dir, agentPath: '/workspace', confined: true }
    const outside = (p: string) =>
      `${p} is outside /workspace; a container agent can only attach files under /workspace`

    it('maps relative paths', () => {
      expect(resolveAttachmentPath({ ...base, path: 'shot.png' })).toBe(join(dir, 'shot.png'))
    })
    it('maps absolute paths in the workspace', () => {
      expect(resolveAttachmentPath({ ...base, path: '/workspace/a/b.png' })).toBe(
        join(dir, 'a/b.png'),
      )
    })
    it('rejects a sibling sharing the prefix', () => {
      expect(() => resolveAttachmentPath({ ...base, path: '/workspace-evil/x' })).toThrow(
        'outside /workspace',
      )
    })
    it('rejects paths outside the workspace', () => {
      expect(() => resolveAttachmentPath({ ...base, path: '/etc/passwd' })).toThrow(
        outside('/etc/passwd'),
      )
    })
    it('rejects .. escapes', () => {
      expect(() =>
        resolveAttachmentPath({ ...base, path: '/workspace/../etc/passwd' }),
      ).toThrow('outside /workspace')
      expect(() => resolveAttachmentPath({ ...base, path: '../etc/passwd' })).toThrow(
        'outside /workspace',
      )
    })
    it('rejects a symlink that leaves the workspace', () => {
      const other = tmp()
      writeFileSync(join(other, 'secret.txt'), 'x')
      symlinkSync(join(other, 'secret.txt'), join(dir, 'link'))
      expect(() => resolveAttachmentPath({ ...base, path: 'link' })).toThrow('outside /workspace')
    })
    it('returns the realpath of a symlink that stays inside', () => {
      mkdirSync(join(dir, 'sub'), { recursive: true })
      writeFileSync(join(dir, 'real.txt'), 'x')
      symlinkSync(join(dir, 'real.txt'), join(dir, 'sub', 'ok'))
      expect(resolveAttachmentPath({ ...base, path: 'sub/ok' })).toBe(
        realpathSync(join(dir, 'real.txt')),
      )
    })
    it('confines by flag even when hostDir equals agentPath', () => {
      const same = tmp()
      expect(() =>
        resolveAttachmentPath({
          path: '/etc/passwd',
          hostDir: same,
          agentPath: same,
          confined: true,
        }),
      ).toThrow('outside')
    })
  })
})
