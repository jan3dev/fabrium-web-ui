import { expect, it, vi } from 'vitest'
import { createModels } from './models.js'
import { jsonResponse } from './test-api.js'

const URL = 'https://haven.example.com/pricing/'
const LIST = [{ id: 'a' }, { id: 'b', status: 'deprecated' }, { id: 'c', capabilities: { tool_call: false } }]

it('keeps the models that are not deprecated and have tool calls', async () => {
  const fetch = vi.fn(async () => jsonResponse(200, LIST))
  expect(await createModels({ fetch: fetch as typeof globalThis.fetch, url: URL }).list()).toEqual(['a'])
  expect(fetch).toHaveBeenCalledWith(URL, expect.anything())
})

it('asks once in 5 minutes', async () => {
  let now = 1_000_000
  const fetch = vi.fn(async () => jsonResponse(200, LIST))
  const models = createModels({ fetch: fetch as typeof globalThis.fetch, url: URL, now: () => now })
  await models.list()
  now += 5 * 60_000 - 1
  await models.list()
  expect(fetch).toHaveBeenCalledTimes(1)
  now += 2
  await models.list()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('answers 502 when the list fails, and asks again at the next call', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockRejectedValueOnce(new TypeError('fetch failed'))
    .mockResolvedValueOnce(jsonResponse(500, { error: 'down' }))
    .mockResolvedValueOnce(new Response('<html>', { status: 200 }))
    .mockResolvedValue(jsonResponse(200, LIST))
  const models = createModels({ fetch, url: URL })
  for (let i = 0; i < 3; i++) {
    await expect(models.list()).rejects.toMatchObject({
      status: 502,
      body: { error: 'the Haven model list does not answer' },
    })
  }
  expect(await models.list()).toEqual(['a'])
  expect(fetch).toHaveBeenCalledTimes(4)
})
