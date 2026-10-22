import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api, internal } from '@/convex/_generated/api'
import { modelOf, setup, signInAdmin, syncModels } from '@/convex/test.setup'

// Fake timers keep send's scheduled Answer and title from running on their own.
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

async function newThread() {
  const t = setup()
  await syncModels(t)
  const { as } = await signInAdmin(t)
  const { _id: modelId } = await modelOf(t, 'gpt-6.1-sol')
  const threadId = await as.mutation(api.threads.send, {
    text: 'Hello there',
    modelId,
    webSearch: true,
  })
  const thread = () => as.query(api.threads.get, { threadId })
  return { t, as, threadId, thread }
}

test("writes the Title Model's title over the truncated Prompt", async () => {
  const { t, threadId, thread } = await newThread()
  expect(await thread()).toMatchObject({
    title: 'Hello there',
    titlePending: true,
  })

  vi.stubEnv('MOCK_MODEL', '1')
  await t.action(internal.titles.generate, { threadId, prompt: 'Hello there' })

  expect(await thread()).toMatchObject({
    title: 'Mock title',
    titlePending: false,
  })
})

test("a title can't overwrite a rename", async () => {
  const { t, as, threadId, thread } = await newThread()

  await as.mutation(api.threads.rename, { threadId, title: ' Mine ' })
  expect(await thread()).toMatchObject({ title: 'Mine', titlePending: false })
  vi.stubEnv('MOCK_MODEL', '1')
  await t.action(internal.titles.generate, { threadId, prompt: 'Hello there' })

  expect(await thread()).toMatchObject({ title: 'Mine' })
})

test('keeps the truncated title when the Title Model fails', async () => {
  const { t, threadId, thread } = await newThread()

  vi.stubGlobal('fetch', async () => new Response('bad', { status: 400 }))
  try {
    await t.action(internal.titles.generate, {
      threadId,
      prompt: 'Hello there',
    })
  } finally {
    vi.unstubAllGlobals()
  }

  expect(await thread()).toMatchObject({
    title: 'Hello there',
    titlePending: false,
  })
})
