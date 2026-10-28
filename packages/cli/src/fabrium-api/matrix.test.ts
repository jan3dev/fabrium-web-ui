import { describe, expect, it } from 'vitest'
import { ApiError } from './errors.js'
import { createFakeMatrix } from './fake-matrix.js'
import { openIdSub, stateEvent, usernameAvailable, whoami } from './matrix.js'

const homeserver = 'http://tuwunel:8448'

function setup() {
  const fake = createFakeMatrix()
  return { fake, conn: { homeserver, fetch: fake.fetch } }
}

const rejects502 = async (promise: Promise<unknown>, error: string) => {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(ApiError)
  expect(err).toMatchObject({ status: 502, body: { error } })
}

describe('openIdSub', () => {
  it('returns the user of a valid token and null for an unknown one', async () => {
    const { fake, conn } = setup()
    expect(await openIdSub(conn, fake.openIdToken('@ann:example.org'))).toBe('@ann:example.org')
    expect(await openIdSub(conn, 'unknown')).toBeNull()
  })

  it('sends the token as a query parameter, encoded', async () => {
    const { fake, conn } = setup()
    await openIdSub(conn, 'a b&c')
    expect(fake.calls.at(-1)?.path).toBe(
      '/_matrix/federation/v1/openid/userinfo?access_token=a%20b%26c',
    )
  })

  it('answers 502 when the homeserver fails or is unreachable', async () => {
    const { fake, conn } = setup()
    fake.failOnce('GET', /openid\/userinfo/, 500)
    await rejects502(openIdSub(conn, 'x'), 'homeserver unreachable')
    const down = { homeserver, fetch: () => Promise.reject(new TypeError('fetch failed')) }
    await rejects502(openIdSub(down, 'secret-token'), 'homeserver unreachable')
  })
})

describe('whoami', () => {
  it('returns the user of an accepted token and null otherwise', async () => {
    const { fake, conn } = setup()
    expect(await whoami(conn, fake.centralToken)).toBe('@zooid:example.org')
    expect(await whoami(conn, 'unknown')).toBeNull()
  })
})

describe('stateEvent', () => {
  it('returns the content, and null when the event does not exist', async () => {
    const { fake, conn } = setup()
    fake.setMember(fake.spaceId, '@ann:example.org', 'join')
    expect(
      await stateEvent(conn, fake.centralToken, fake.spaceId, 'm.room.member', '@ann:example.org'),
    ).toEqual({ membership: 'join' })
    expect(
      await stateEvent(conn, fake.centralToken, fake.spaceId, 'm.room.member', '@bob:example.org'),
    ).toBeNull()
  })

  it('encodes the room, the type, and the state key', async () => {
    const { fake, conn } = setup()
    await stateEvent(conn, fake.centralToken, '!a/b:example.org', 'dev.zooid.workforce', 'k y')
    expect(fake.calls.at(-1)?.path).toBe(
      '/_matrix/client/v3/rooms/!a%2Fb%3Aexample.org/state/dev.zooid.workforce/k%20y',
    )
  })

  it('answers 502 for any other failure', async () => {
    const { fake, conn } = setup()
    fake.failOnce('GET', /\/state\//, 403)
    await rejects502(
      stateEvent(conn, fake.centralToken, fake.spaceId, 'm.room.create', ''),
      'homeserver answered 403',
    )
  })
})

describe('usernameAvailable', () => {
  it('is true for a free name and false for a user that exists', async () => {
    const { fake, conn } = setup()
    fake.addUser('@ann:example.org')
    expect(await usernameAvailable(conn, fake.centralToken, 'lima')).toBe(true)
    expect(await usernameAvailable(conn, fake.centralToken, 'ann')).toBe(false)
    expect(await usernameAvailable(conn, fake.centralToken, 'zooid')).toBe(false)
  })

  it('is false when the homeserver forbids the name', async () => {
    const { fake, conn } = setup()
    fake.failOnce('GET', /register\/available/, 403)
    expect(await usernameAvailable(conn, fake.centralToken, 'lima')).toBe(false)
  })

  it.each([401, 500])('answers 502 when the homeserver answers %i', async (status) => {
    const { fake, conn } = setup()
    fake.failOnce('GET', /register\/available/, status)
    await rejects502(
      usernameAvailable(conn, fake.centralToken, 'lima'),
      `cannot check that @lima is free (homeserver answered ${status})`,
    )
  })
})
