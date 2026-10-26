import { describe, expect, it, vi } from 'vitest'
import { loadFabriumApiConfig } from './config.js'

const base = {
  FABRIUM_CONTROL_PLANE_URL: 'https://control.example.org',
  FABRIUM_CONTROL_PLANE_KEY_FILE: '/run/control-plane.key',
  ZOOID_HOME: '/srv/zooid',
  HOMESERVER_URL: 'https://chat.example.org',
}
const KEY = 'tenant-key-0123456789'
const reader = (content = `${KEY}\n`) => vi.fn((_path: string) => content)

describe('loadFabriumApiConfig', () => {
  it.each([
    ['nothing is set', {}],
    ['only the URL is set', { FABRIUM_CONTROL_PLANE_URL: base.FABRIUM_CONTROL_PLANE_URL }],
    ['only the key file is set', { FABRIUM_CONTROL_PLANE_KEY_FILE: base.FABRIUM_CONTROL_PLANE_KEY_FILE }],
    ['both are empty', { FABRIUM_CONTROL_PLANE_URL: '', FABRIUM_CONTROL_PLANE_KEY_FILE: '' }],
  ])('returns undefined, and reads no file, when %s', (_name, env) => {
    const read = reader()
    expect(loadFabriumApiConfig(env, read)).toBeUndefined()
    expect(read).not.toHaveBeenCalled()
  })

  it('reads the key file once and trims the key', () => {
    const read = reader()
    const config = loadFabriumApiConfig(base, read)
    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith('/run/control-plane.key')
    expect(config).toEqual({
      controlPlaneUrl: 'https://control.example.org',
      controlPlaneKey: KEY,
      vmRooms: ['#general'],
      homeserverUrl: 'https://chat.example.org',
      zooidHome: '/srv/zooid',
      havenModel: undefined,
      zooidCommit: undefined,
    })
  })

  it('fails when the key file cannot be read, naming the variable and the path', () => {
    const read = vi.fn(() => {
      throw new Error("ENOENT: no such file or directory, open '/run/control-plane.key'")
    })
    expect(() => loadFabriumApiConfig(base, read)).toThrow(
      /FABRIUM_CONTROL_PLANE_KEY_FILE.*\/run\/control-plane\.key/,
    )
  })

  it('fails when the key file is empty', () => {
    expect(() => loadFabriumApiConfig(base, reader('  \n'))).toThrow(/is empty/)
  })

  it.each([
    ['a URL that is not http or https', { FABRIUM_CONTROL_PLANE_URL: 'ftp://control.example.org' }],
    ['a URL that is not a URL', { FABRIUM_CONTROL_PLANE_URL: 'control' }],
    ['a room with a space', { FABRIUM_VM_ROOMS: '#a b' }],
    ['a room with a quote', { FABRIUM_VM_ROOMS: "#a'b" }],
    ['a room with a backslash', { FABRIUM_VM_ROOMS: '#a\\b' }],
    ['a room without # or !', { FABRIUM_VM_ROOMS: 'general' }],
    ['no ZOOID_HOME', { ZOOID_HOME: '' }],
    ['no HOMESERVER_URL', { HOMESERVER_URL: '' }],
    ['a HOMESERVER_URL that is not a URL', { HOMESERVER_URL: 'chat.example.org' }],
    ['a HOMESERVER_URL with a quote', { HOMESERVER_URL: "https://chat.example.org/'x" }],
    ['a HOMESERVER_URL with a newline', { HOMESERVER_URL: 'https://chat.example.org\nX=1' }],
  ])('fails for %s, and the message never holds the key', (_name, over) => {
    let message = ''
    try {
      loadFabriumApiConfig({ ...base, ...over }, reader())
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).not.toBe('')
    expect(message).not.toContain(KEY)
  })

  it.each([
    ['http://control.example.org', /https/],
    ['http://10.0.0.5:8080', /https/],
  ])('refuses the plain-http control plane URL %s: the payload holds secrets', (url, message) => {
    expect(() =>
      loadFabriumApiConfig({ ...base, FABRIUM_CONTROL_PLANE_URL: url }, reader()),
    ).toThrow(message)
  })

  it.each(['http://localhost:8080', 'http://127.0.0.1:29100', 'http://[::1]:29100'])(
    'accepts %s for a control plane on this host',
    (url) => {
      expect(
        loadFabriumApiConfig({ ...base, FABRIUM_CONTROL_PLANE_URL: url }, reader())
          ?.controlPlaneUrl,
      ).toBe(url)
    },
  )

  it('strips trailing slashes from the control plane URL', () => {
    const config = loadFabriumApiConfig(
      { ...base, FABRIUM_CONTROL_PLANE_URL: 'https://control.example.org//' },
      reader(),
    )
    expect(config?.controlPlaneUrl).toBe('https://control.example.org')
  })

  it.each([
    [undefined, ['#general']],
    ['', ['#general']],
    [' , ', ['#general']],
    ['#general', ['#general']],
    [' #a , #b:other.org,,!c:example.org ', ['#a', '#b:other.org', '!c:example.org']],
  ])('reads FABRIUM_VM_ROOMS %j as %j', (rooms, expected) => {
    const env = rooms === undefined ? base : { ...base, FABRIUM_VM_ROOMS: rooms }
    expect(loadFabriumApiConfig(env, reader())?.vmRooms).toEqual(expected)
  })

  it('reads FABRIUM_HAVEN_MODEL and ZOOID_COMMIT, and takes an empty value as unset', () => {
    const commit = '0123456789abcdef0123456789abcdef01234567'
    const set = loadFabriumApiConfig(
      { ...base, FABRIUM_HAVEN_MODEL: 'glm-5-3', ZOOID_COMMIT: commit },
      reader(),
    )
    expect([set?.havenModel, set?.zooidCommit]).toEqual(['glm-5-3', commit])
    const empty = loadFabriumApiConfig({ ...base, FABRIUM_HAVEN_MODEL: ' ', ZOOID_COMMIT: '' }, reader())
    expect([empty?.havenModel, empty?.zooidCommit]).toEqual([undefined, undefined])
  })
})
