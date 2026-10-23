import type { Id } from '@/convex/_generated/dataModel'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from '@/convex/_generated/api'
import {
  modelOf,
  setup,
  signInAdmin,
  signInUser,
  syncModels,
  type Test,
} from '@/convex/test.setup'

// Fake timers keep the scheduled Answer and title actions from running.
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

async function signedIn() {
  const t = setup()
  await syncModels(t)
  const { as, userId } = await signInAdmin(t)
  const { _id: modelId } = await modelOf(t, 'gpt-6.1-sol')
  return { t, as, userId, modelId }
}

type Session = Awaited<ReturnType<typeof signedIn>>

/** Sends the Prompt, in a new Thread unless given one, and finishes its Answer. */
async function converse(
  { t, as, modelId }: Session,
  prompt: string,
  answer: string,
  threadId?: Id<'threads'>,
) {
  threadId = await as.mutation(api.threads.send, {
    threadId,
    text: prompt,
    modelId,
    webSearch: false,
  })
  await finishAnswer(t, threadId, answer)
  return threadId
}

async function finishAnswer(t: Test, threadId: Id<'threads'>, text: string) {
  const live = await t.run((ctx) =>
    ctx.db
      .query('liveAnswers')
      .withIndex('by_thread', (q) => q.eq('threadId', threadId))
      .unique(),
  )
  await t.mutation(internal.liveAnswers.finish, {
    liveAnswerId: live!._id,
    parts: [{ type: 'text', text, state: 'done' }],
  })
}

describe('search.threads', () => {
  test('finds an Answer by a word prefix', async () => {
    const session = await signedIn()
    const threadId = await converse(
      session,
      'Tell me about hooks',
      'React hooks let components keep state.',
    )
    await converse(session, 'Something else', 'Nothing to see.')

    expect(
      await session.as.query(api.search.threads, { query: 'compon' }),
    ).toMatchObject([
      {
        _id: threadId,
        message: { snippet: 'React hooks let components keep state.' },
      },
    ])
  })

  test('finds kanji in the middle of a Japanese sentence', async () => {
    const session = await signedIn()
    const threadId = await converse(
      session,
      '今日は良い天気ですね',
      'そうですね。',
    )

    expect(
      await session.as.query(api.search.threads, { query: '天気' }),
    ).toMatchObject([
      { _id: threadId, message: { snippet: '今日は良い天気ですね' } },
    ])
  })

  test('finds part of a long Japanese clause, but not its scattered bigrams', async () => {
    const session = await signedIn()
    // One 30-character clause: 90 bytes, which Convex would drop as one term.
    const clause =
      '吾輩は猫である名前はまだ無いどこで生れたかとんと見当がつかぬ'
    const threadId = await converse(session, '猫の話', clause)
    await converse(session, '東京と京都', 'どちらも良い街です。')

    const { as } = session
    expect(
      await as.query(api.search.threads, {
        query: '名前はまだ無いどこで生れたかとんと見当',
      }),
    ).toMatchObject([{ _id: threadId, message: { snippet: clause } }])
    expect(await as.query(api.search.threads, { query: '東京都' })).toEqual([])
  })

  test('lists Threads with a matching Japanese title first, once each', async () => {
    const session = await signedIn()
    const { t, as } = session
    const later = await converse(
      session,
      '来月京都旅行に行きます',
      'いいですね。',
    )
    await as.mutation(api.threads.rename, {
      threadId: later,
      title: '来月の予定',
    })
    const titled = await converse(
      session,
      '紅葉の京都旅行について',
      '十一月です。',
    )
    await converse(session, 'もう一度、京都旅行の話', '何でしょう。', titled)
    await t.mutation(internal.titles.save, {
      threadId: titled,
      title: '秋の京都旅行の計画',
    })

    expect(await as.query(api.search.threads, { query: '京都旅行' })).toEqual([
      {
        _id: titled,
        title: '秋の京都旅行の計画',
        message: { _id: expect.any(String), snippet: '紅葉の京都旅行について' },
      },
      {
        _id: later,
        title: '来月の予定',
        message: { _id: expect.any(String), snippet: '来月京都旅行に行きます' },
      },
    ])
  })

  test("finds only the User's own Threads", async () => {
    const session = await signedIn()
    await converse(session, 'Secret plans', 'Keep them secret.')
    const other = await signInUser(session.t)

    expect(
      await other.as.query(api.search.threads, { query: 'secret' }),
    ).toEqual([])
    expect(
      await session.t.query(api.search.threads, { query: 'secret' }),
    ).toEqual([])
  })

  test('matches and quotes Markdown as plain text, code included', async () => {
    const session = await signedIn()
    await converse(
      session,
      'Show me',
      '## Steps\n\n- Run **pnpm build** first\n\n```sh\npnpm start\n```',
    )

    const [hit] = await session.as.query(api.search.threads, {
      query: 'pnpm build first',
    })
    expect(hit?.message?.snippet).toBe('Steps Run pnpm build first pnpm start')
  })

  test('caps the hits at 20 Threads', async () => {
    const session = await signedIn()
    for (let i = 0; i < 25; i++)
      await converse(session, `Thread ${i}`, `Bananas, take ${i}`)

    expect(
      await session.as.query(api.search.threads, { query: 'bananas' }),
    ).toHaveLength(20)
  })
})

describe('search.reindex', () => {
  test('makes Threads from before Thread search findable', async () => {
    const { t, as, userId, modelId } = await signedIn()
    const threadId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('threads', {
        userId,
        title: '古い天気の話',
        titlePending: false,
        pinned: false,
        lastMessageAt: Date.now(),
        modelId,
      })
      await ctx.db.insert('messages', {
        threadId: id,
        userId,
        role: 'user',
        parts: [{ type: 'text', text: '明日は雨が降りますか' }],
        searchText: '明日は雨が降りますか',
      })
      return id
    })
    const search = (query: string) => as.query(api.search.threads, { query })
    expect(await search('天気')).toEqual([])

    await t.mutation(internal.search.reindex, {})
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    expect(await search('天気')).toMatchObject([{ _id: threadId }])
    expect(await search('雨')).toMatchObject([{ _id: threadId }])
  })
})
