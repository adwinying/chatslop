import type { Id } from '@/convex/_generated/dataModel'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from '@/convex/_generated/api'
import { STALE_MS } from '@/convex/liveAnswers'
import { setup, signInAdmin, type Test } from '@/convex/test.setup'

const answerParts = [
  { type: 'reasoning' as const, text: 'Hmm.', state: 'done' as const },
  { type: 'text' as const, text: 'Hello back.', state: 'done' as const },
]

async function sendFirstPrompt() {
  const t = setup()
  await t.mutation(internal.seed.providers, {})
  const { as, userId } = await signInAdmin(t)
  const threadId = await as.mutation(api.threads.send, { text: ' Hello ' })
  return { t, as, userId, threadId }
}

const liveAnswerOf = (t: Test, threadId: Id<'threads'>) =>
  t.run((ctx) =>
    ctx.db
      .query('liveAnswers')
      .withIndex('by_thread', (q) => q.eq('threadId', threadId))
      .unique(),
  )

const messagesOf = (t: Test, threadId: Id<'threads'>) =>
  t.run((ctx) =>
    ctx.db
      .query('messages')
      .withIndex('by_thread', (q) => q.eq('threadId', threadId))
      .take(100),
  )

// Fake timers keep scheduled functions, like the action, from running, so
// tests drive the Live answer by hand. setSystemTime moves the clock alone.
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const silentFor = (t: Test, threadId: Id<'threads'>, ms: number) =>
  liveAnswerOf(t, threadId).then((live) =>
    vi.setSystemTime(live!.lastWriteAt + ms),
  )

describe('threads.send', () => {
  test('starts a Thread with the Prompt and a Live answer', async () => {
    const { t, as, threadId } = await sendFirstPrompt()

    expect(await as.query(api.threads.messages, { threadId })).toMatchObject([
      { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
    ])
    expect(await as.query(api.liveAnswers.get, { threadId })).toMatchObject({
      parts: [],
      stopRequested: false,
    })
    const thread = await t.run((ctx) => ctx.db.get('threads', threadId))
    expect(thread).toMatchObject({ title: 'Hello', titlePending: true })
  })

  test('rejects a second Prompt while the Live answer streams', async () => {
    const { t, as, threadId } = await sendFirstPrompt()

    await expect(
      as.mutation(api.threads.send, { threadId, text: 'Again' }),
    ).rejects.toThrow('Wait for the Answer or stop it first')
    expect(await messagesOf(t, threadId)).toHaveLength(1)
  })

  test("refuses another User's Thread", async () => {
    const { t, as, threadId } = await sendFirstPrompt()
    await t.run((ctx) =>
      ctx.db.patch('threads', threadId, { userId: 'someone-else' }),
    )

    await expect(
      as.mutation(api.threads.send, { threadId, text: 'Hi' }),
    ).rejects.toThrow('Thread not found')
    await expect(as.query(api.threads.messages, { threadId })).rejects.toThrow(
      'Thread not found',
    )
    await expect(as.mutation(api.threads.stop, { threadId })).rejects.toThrow(
      'Thread not found',
    )
  })
})

describe('liveAnswers.finish', () => {
  test('inserts the Answer and deletes the Live answer together', async () => {
    const { t, as, threadId } = await sendFirstPrompt()
    const live = await liveAnswerOf(t, threadId)

    await t.mutation(internal.liveAnswers.finish, {
      liveAnswerId: live!._id,
      parts: answerParts,
    })

    expect(await liveAnswerOf(t, threadId)).toBeNull()
    expect(await as.query(api.threads.messages, { threadId })).toMatchObject([
      { role: 'user' },
      {
        role: 'assistant',
        status: 'complete',
        parts: answerParts,
        searchText: 'Hello back.',
        reasoningLevel: 'medium',
        webSearch: true,
      },
    ])
    // The Thread takes Prompts again.
    await as.mutation(api.threads.send, { threadId, text: 'Next' })
  })

  test('marks a stopped Answer as stopped', async () => {
    const { t, as, threadId } = await sendFirstPrompt()
    await as.mutation(api.threads.stop, { threadId })
    const live = await liveAnswerOf(t, threadId)

    expect(
      await t.mutation(internal.liveAnswers.save, {
        liveAnswerId: live!._id,
        parts: answerParts,
      }),
    ).toEqual({ stop: true })
    await t.mutation(internal.liveAnswers.finish, {
      liveAnswerId: live!._id,
      parts: answerParts,
    })

    const [, answer] = await messagesOf(t, threadId)
    expect(answer).toMatchObject({ status: 'stopped', parts: answerParts })
  })

  test('records an error', async () => {
    const { t, threadId } = await sendFirstPrompt()
    const live = await liveAnswerOf(t, threadId)

    await t.mutation(internal.liveAnswers.finish, {
      liveAnswerId: live!._id,
      parts: [],
      error: 'Bad gateway',
    })

    const [, answer] = await messagesOf(t, threadId)
    expect(answer).toMatchObject({ status: 'error', error: 'Bad gateway' })
  })
})

describe('liveAnswers.expire', () => {
  test('leaves a Live answer that still gets writes', async () => {
    const { t, threadId } = await sendFirstPrompt()
    const live = await liveAnswerOf(t, threadId)

    await silentFor(t, threadId, STALE_MS - 1000)
    await t.mutation(internal.liveAnswers.save, {
      liveAnswerId: live!._id,
      parts: answerParts,
    })
    await t.mutation(internal.liveAnswers.expire, { liveAnswerId: live!._id })

    expect(await liveAnswerOf(t, threadId)).not.toBeNull()
    expect(await messagesOf(t, threadId)).toHaveLength(1)
  })

  test('finalizes a silent Live answer with its parts, in one transaction', async () => {
    const { t, threadId } = await sendFirstPrompt()
    const live = await liveAnswerOf(t, threadId)
    await t.mutation(internal.liveAnswers.save, {
      liveAnswerId: live!._id,
      parts: answerParts,
    })

    await silentFor(t, threadId, STALE_MS)
    await t.mutation(internal.liveAnswers.expire, { liveAnswerId: live!._id })

    expect(await liveAnswerOf(t, threadId)).toBeNull()
    const [, answer] = await messagesOf(t, threadId)
    expect(answer).toMatchObject({
      status: 'error',
      error: 'The Answer was interrupted.',
      parts: answerParts,
    })

    // A late finish from the dead action changes nothing.
    await t.mutation(internal.liveAnswers.finish, {
      liveAnswerId: live!._id,
      parts: [],
    })
    expect(await messagesOf(t, threadId)).toHaveLength(2)
  })

  test('finalizes a silent Live answer the User stopped as stopped', async () => {
    const { t, as, threadId } = await sendFirstPrompt()
    await as.mutation(api.threads.stop, { threadId })
    const live = await liveAnswerOf(t, threadId)

    await silentFor(t, threadId, STALE_MS)
    await t.mutation(internal.liveAnswers.expire, { liveAnswerId: live!._id })

    const [, answer] = await messagesOf(t, threadId)
    expect(answer).toMatchObject({ status: 'stopped' })
    expect(answer).not.toHaveProperty('error')
  })
})
