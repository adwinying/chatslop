import type { Id } from '@/convex/_generated/dataModel'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from '@/convex/_generated/api'
import { STALE_MS } from '@/convex/liveAnswers'
import {
  modelOf,
  setup,
  signInAdmin,
  syncModels,
  type Test,
} from '@/convex/test.setup'

const answerParts = [
  { type: 'reasoning' as const, text: 'Hmm.', state: 'done' as const },
  { type: 'text' as const, text: 'Hello back.', state: 'done' as const },
]

async function sendFirstPrompt() {
  const t = setup()
  await syncModels(t)
  const { as, userId } = await signInAdmin(t)
  const { _id: modelId } = await modelOf(t, 'gpt-6.1-sol')
  const threadId = await as.mutation(api.threads.send, {
    text: ' Hello ',
    modelId,
    webSearch: true,
  })
  return { t, as, userId, threadId, modelId }
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
    const { t, as, threadId, modelId } = await sendFirstPrompt()

    await expect(
      as.mutation(api.threads.send, {
        threadId,
        text: 'Again',
        modelId,
        webSearch: true,
      }),
    ).rejects.toThrow('Wait for the Answer or stop it first')
    expect(await messagesOf(t, threadId)).toHaveLength(1)
  })

  test("refuses another User's Thread", async () => {
    const { t, as, threadId, modelId } = await sendFirstPrompt()
    await t.run((ctx) =>
      ctx.db.patch('threads', threadId, { userId: 'someone-else' }),
    )

    await expect(
      as.mutation(api.threads.send, {
        threadId,
        text: 'Hi',
        modelId,
        webSearch: true,
      }),
    ).rejects.toThrow('Thread not found')
    await expect(as.query(api.threads.messages, { threadId })).rejects.toThrow(
      'Thread not found',
    )
    await expect(as.mutation(api.threads.stop, { threadId })).rejects.toThrow(
      'Thread not found',
    )
  })

  // The client briefly reruns queries signed out after a reload.
  test('shows nothing, rather than failing, while signed out', async () => {
    const { t, threadId } = await sendFirstPrompt()

    expect(await t.query(api.threads.messages, { threadId })).toBeNull()
    expect(await t.query(api.liveAnswers.get, { threadId })).toBeNull()
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
    // The Thread takes Prompts again, and keeps the Model picked last.
    const luna = await modelOf(t, 'gpt-6-luna')
    await as.mutation(api.threads.send, {
      threadId,
      text: 'Next',
      modelId: luna._id,
      webSearch: true,
    })
    expect(await t.run((ctx) => ctx.db.get('threads', threadId))).toMatchObject(
      { modelId: luna._id },
    )
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

/** Finishes the Thread's Live answer, by default as complete. */
async function finishLive(
  t: Test,
  threadId: Id<'threads'>,
  outcome: { error?: string } = {},
) {
  const live = await liveAnswerOf(t, threadId)
  await t.mutation(internal.liveAnswers.finish, {
    liveAnswerId: live!._id,
    parts: answerParts,
    ...outcome,
  })
}

/** Prompt, Answer, Prompt, Answer. */
async function twoExchanges() {
  const sent = await sendFirstPrompt()
  const { t, as, threadId, modelId } = sent
  await finishLive(t, threadId)
  await as.mutation(api.threads.send, {
    threadId,
    text: 'Second',
    modelId,
    webSearch: false,
  })
  await finishLive(t, threadId)
  return { ...sent, messages: await messagesOf(t, threadId) }
}

describe('threads.regenerate', () => {
  test('deletes everything after the Prompt and answers it again with the same choices', async () => {
    const { t, as, threadId, modelId, messages } = await twoExchanges()

    const removed = await as.mutation(api.threads.regenerate, {
      answerId: messages[1]!._id,
    })

    expect(removed).toBe(3)
    expect(await messagesOf(t, threadId)).toMatchObject([
      { _id: messages[0]!._id },
    ])
    expect(await liveAnswerOf(t, threadId)).toMatchObject({
      modelId,
      reasoningLevel: 'medium',
      webSearch: true,
    })
  })

  test('with another Model re-resolves the Reasoning level for it', async () => {
    const { t, as, threadId, messages } = await twoExchanges()
    const haiku = await modelOf(t, 'claude-haiku-5-5')

    const removed = await as.mutation(api.threads.regenerate, {
      answerId: messages[3]!._id,
      modelId: haiku._id,
    })

    expect(removed).toBe(1)
    expect(await messagesOf(t, threadId)).toHaveLength(3)
    expect(await liveAnswerOf(t, threadId)).toMatchObject({
      modelId: haiku._id,
      // It has no `medium`, so its lowest level.
      reasoningLevel: 'off',
      webSearch: false,
    })
  })

  test('is refused while the Thread has a Live answer', async () => {
    const { t, as, threadId, modelId, messages } = await twoExchanges()
    await as.mutation(api.threads.send, {
      threadId,
      text: 'Third',
      modelId,
      webSearch: false,
    })

    await expect(
      as.mutation(api.threads.regenerate, { answerId: messages[1]!._id }),
    ).rejects.toThrow('Wait for the Answer or stop it first')
    expect(await messagesOf(t, threadId)).toHaveLength(5)
  })
})

describe('threads.edit', () => {
  test('patches the Prompt, deletes what follows with its Attachments, and resends with the picked choices', async () => {
    const { t, as, userId, threadId, messages } = await twoExchanges()
    const [first, , second] = messages
    const storageId = await t.run(async (ctx) => {
      const id = await ctx.storage.store(new Blob(['notes']))
      await ctx.db.insert('attachments', {
        userId,
        messageId: second!._id,
        storageId: id,
        name: 'notes.txt',
        mediaType: 'text/plain',
        size: 5,
      })
      return id
    })
    const luna = await modelOf(t, 'gpt-6-luna')

    const removed = await as.mutation(api.threads.edit, {
      promptId: first!._id,
      text: ' Hello again ',
      modelId: luna._id,
      reasoningLevel: 'high',
      webSearch: false,
    })

    expect(removed).toBe(3)
    expect(await messagesOf(t, threadId)).toMatchObject([
      {
        _id: first!._id,
        parts: [{ type: 'text', text: 'Hello again' }],
        searchText: 'Hello again',
      },
    ])
    expect(
      await t.run(async (ctx) => ({
        attachments: await ctx.db.query('attachments').take(1),
        blob: await ctx.storage.get(storageId),
      })),
    ).toEqual({ attachments: [], blob: null })
    expect(await liveAnswerOf(t, threadId)).toMatchObject({
      modelId: luna._id,
      reasoningLevel: 'high',
      webSearch: false,
    })
    expect(await t.run((ctx) => ctx.db.get('threads', threadId))).toMatchObject(
      { modelId: luna._id },
    )
  })

  test('refuses an empty Prompt and an Answer', async () => {
    const { as, modelId, messages } = await twoExchanges()
    const choices = { modelId, webSearch: false }

    await expect(
      as.mutation(api.threads.edit, {
        promptId: messages[0]!._id,
        text: '  ',
        ...choices,
      }),
    ).rejects.toThrow('Write a Prompt first')
    await expect(
      as.mutation(api.threads.edit, {
        promptId: messages[1]!._id,
        text: 'Hi',
        ...choices,
      }),
    ).rejects.toThrow('Prompt not found')
  })
})
