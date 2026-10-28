import { MatrixClient } from '@zooid/transport-matrix'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { requireRole, type AuthDeps, type Caller } from './auth.js'
import { apiErrorHandler } from './errors.js'
import { createFakeMatrix } from './fake-matrix.js'

const homeserver = 'http://tuwunel:8448'

function setup(opts: { now?: () => number; fetch?: typeof fetch; spaceKnown?: boolean } = {}) {
  const fake = createFakeMatrix()
  const deps: AuthDeps = {
    conn: { homeserver, fetch: opts.fetch ?? fake.fetch },
    client: new MatrixClient({ homeserver, asToken: fake.centralToken, fetch: fake.fetch }),
    serverName: 'example.org',
    asToken: fake.centralToken,
    asUserId: '@zooid:example.org',
    getSpaceRoomId: () => (opts.spaceKnown === false ? undefined : fake.spaceId),
    now: opts.now,
  }
  const app = new Hono<{ Variables: { caller: Caller } }>()
  app.onError(apiErrorHandler)
  app.use('*', requireRole(deps))
  app.get('/probe', (c) => c.json(c.get('caller')))
  const as = (token: string) =>
    app.request('/probe', { headers: { authorization: `Bearer ${token}` } })
  const count = (pathPrefix: string) =>
    fake.calls.filter((call) => call.path.startsWith(pathPrefix)).length
  return { fake, app, as, count }
}

const ann = '@ann:example.org'
const USERINFO = '/_matrix/federation/v1/openid/userinfo'

describe('OpenID token', () => {
  it('accepts a valid token and sets the caller', async () => {
    const { fake, as } = setup()
    fake.joinSpace(ann, 90)
    const res = await as(fake.openIdToken(ann))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: ann, role: 'admin' })
  })

  it('answers 401 for an unknown token', async () => {
    const { as } = setup()
    const res = await as('unknown')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'invalid token' })
  })

  it.each([undefined, 'Basic abc', 'Bearer', 'Bearer a b'])(
    'answers 401 for the Authorization header %j',
    async (header) => {
      const { app } = setup()
      const res = await app.request('/probe', { headers: header ? { authorization: header } : {} })
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'invalid token' })
    },
  )

  it('rejects a user of another server', async () => {
    const { fake, as } = setup()
    const res = await as(fake.openIdToken('@x:other.org'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'invalid token' })
  })

  it('caches a valid result for 5 minutes', async () => {
    let now = 1_000_000
    const { fake, as, count } = setup({ now: () => now })
    fake.joinSpace(ann, 90)
    const token = fake.openIdToken(ann)
    await as(token)
    await as(token)
    expect(count(USERINFO)).toBe(1)
    now += 5 * 60_000 - 1
    await as(token)
    expect(count(USERINFO)).toBe(1)
    now += 1
    await as(token)
    expect(count(USERINFO)).toBe(2)
  })

  it('does not cache an invalid token', async () => {
    const { as, count } = setup()
    await as('unknown')
    await as('unknown')
    expect(count(USERINFO)).toBe(2)
  })

  it('answers 502 when the homeserver is unreachable or fails', async () => {
    const down = setup({ fetch: () => Promise.reject(new TypeError('fetch failed')) })
    const res = await down.as('any')
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'homeserver unreachable' })

    const broken = setup()
    broken.fake.failOnce('GET', /openid\/userinfo/, 500)
    expect((await broken.as('any')).status).toBe(502)
  })
})

describe('role', () => {
  it.each([
    [90, 'admin'],
    [95, 'admin'],
    [100, 'owner'],
    [150, 'owner'],
  ])('gives power level %i the role %s', async (level, role) => {
    const { fake, as } = setup()
    fake.joinSpace(ann, level)
    const res = await as(fake.openIdToken(ann))
    expect(await res.json()).toEqual({ userId: ann, role })
  })

  it('gives owner to a v12 creator without a power level, and to an additional creator', async () => {
    const { fake, as } = setup()
    fake.setCreate(fake.spaceId, { room_version: '12', additional_creators: ['@bob:example.org'] }, ann)
    fake.joinSpace(ann)
    fake.joinSpace('@bob:example.org')
    expect(await (await as(fake.openIdToken(ann))).json()).toMatchObject({ role: 'owner' })
    expect(await (await as(fake.openIdToken('@bob:example.org'))).json()).toMatchObject({
      role: 'owner',
    })
  })

  it('refuses the creator of a v11 room who has no power level', async () => {
    const { fake, as } = setup()
    fake.setCreate(fake.spaceId, { room_version: '11' }, ann)
    fake.joinSpace(ann)
    expect((await as(fake.openIdToken(ann))).status).toBe(403)
  })

  it('reads the creators of the space once', async () => {
    const { fake, as, count } = setup()
    fake.setCreate(fake.spaceId, { room_version: '12' }, ann)
    fake.joinSpace(ann)
    const token = fake.openIdToken(ann)
    await as(token)
    await as(token)
    expect(count(`/_matrix/client/v3/rooms/${encodeURIComponent(fake.spaceId)}/state?`)).toBe(1)
  })

  it.each([50, 0])('refuses power level %i with 403', async (level) => {
    const { fake, as } = setup()
    fake.joinSpace(ann, level)
    const res = await as(fake.openIdToken(ann))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
  })

  it('refuses a user who is only in users_default, even at a high default', async () => {
    const { fake, as } = setup()
    fake.setPowerLevels(fake.spaceId, { users: {}, users_default: 50 })
    fake.joinSpace(ann)
    expect((await as(fake.openIdToken(ann))).status).toBe(403)
  })

  it.each(['leave', 'invite', 'ban'])('refuses a user whose membership is %s', async (membership) => {
    const { fake, as } = setup()
    fake.setLevel(fake.spaceId, ann, 100)
    fake.setMember(fake.spaceId, ann, membership)
    expect((await as(fake.openIdToken(ann))).status).toBe(403)
  })

  it('refuses a user who is not in the space', async () => {
    const { fake, as } = setup()
    fake.setLevel(fake.spaceId, ann, 100)
    expect((await as(fake.openIdToken(ann))).status).toBe(403)
  })

  it('reads the role at every request, also with a cached token', async () => {
    const { fake, as, count } = setup()
    fake.joinSpace(ann, 90)
    const token = fake.openIdToken(ann)
    expect((await as(token)).status).toBe(200)
    fake.setLevel(fake.spaceId, ann, 0)
    expect((await as(token)).status).toBe(403)
    expect(count(USERINFO)).toBe(1)
  })

  it('answers 503 while the workforce space is unknown', async () => {
    const { fake, as } = setup({ spaceKnown: false })
    const res = await as(fake.openIdToken(ann))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'workforce space is not ready' })
  })
})
