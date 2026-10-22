import type { Id } from '@/convex/_generated/dataModel'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from '@/convex/_generated/api'
import { CASCADE_BATCH } from '@/convex/cascade'
import {
  modelOf,
  setup,
  signInAdmin,
  syncModels,
  type Test,
} from '@/convex/test.setup'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** A Thread with this many Prompts, each with one Attachment and its blob. */
async function threadWith(
  t: Test,
  userId: string,
  modelId: Id<'models'>,
  prompts: number,
) {
  return await t.run(async (ctx) => {
    const threadId = await ctx.db.insert('threads', {
      userId,
      title: 'Hello',
      titlePending: false,
      pinned: false,
      lastMessageAt: Date.now(),
      modelId,
    })
    for (let i = 0; i < prompts; i++) {
      const messageId = await ctx.db.insert('messages', {
        threadId,
        userId,
        role: 'user',
        parts: [{ type: 'text', text: `Prompt ${i}` }],
        searchText: `Prompt ${i}`,
      })
      await ctx.db.insert('attachments', {
        userId,
        messageId,
        storageId: await ctx.storage.store(new Blob([`file ${i}`])),
        name: `file-${i}.txt`,
        mediaType: 'text/plain',
        size: 6,
      })
    }
    return threadId
  })
}

const counts = (t: Test) =>
  t.run(async (ctx) => ({
    threads: (await ctx.db.query('threads').take(1000)).length,
    messages: (await ctx.db.query('messages').take(1000)).length,
    attachments: (await ctx.db.query('attachments').take(1000)).length,
    blobs: (await ctx.db.system.query('_storage').take(1000)).length,
    liveAnswers: (await ctx.db.query('liveAnswers').take(1000)).length,
  }))

test('deleting a Thread removes its Messages, Attachments and blobs over several batches', async () => {
  const t = setup()
  await syncModels(t)
  const { as, userId } = await signInAdmin(t)
  const { _id: modelId } = await modelOf(t, 'gpt-6.1-sol')
  const threadId = await threadWith(t, userId, modelId, CASCADE_BATCH * 2 + 1)
  await threadWith(t, userId, modelId, 1)
  await t.run((ctx) =>
    ctx.db.insert('liveAnswers', {
      threadId,
      userId,
      modelId,
      webSearch: false,
      parts: [],
      stopRequested: false,
      lastWriteAt: Date.now(),
    }),
  )

  await as.mutation(api.threads.remove, { threadId })
  // Gone from view before the batches run.
  expect(await as.query(api.threads.get, { threadId })).toBeNull()
  // Tabs still showing it get nothing rather than an error.
  expect(await as.query(api.threads.messages, { threadId })).toBeNull()
  expect(await as.query(api.liveAnswers.get, { threadId })).toBeNull()
  await t.finishAllScheduledFunctions(vi.runAllTimers)

  // Only the other Thread is left.
  expect(await counts(t)).toEqual({
    threads: 1,
    messages: 1,
    attachments: 1,
    blobs: 1,
    liveAnswers: 0,
  })
})

test("refuses another User's Thread", async () => {
  const t = setup()
  await syncModels(t)
  const { as } = await signInAdmin(t)
  const { _id: modelId } = await modelOf(t, 'gpt-6.1-sol')
  const threadId = await threadWith(t, 'someone-else', modelId, 1)

  await expect(as.mutation(api.threads.remove, { threadId })).rejects.toThrow(
    'Thread not found',
  )
  expect((await counts(t)).messages).toBe(1)
})
