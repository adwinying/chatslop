import type { Id } from '@/convex/_generated/dataModel'
import type { QueryCtx } from '@/convex/_generated/server'
import { ConvexError, v } from 'convex/values'
import { internal } from '@/convex/_generated/api'
import { mutation, query } from '@/convex/_generated/server'
import { authComponent } from '@/convex/auth'
import { STALE_MS } from '@/convex/liveAnswers'
import { usableModel } from '@/convex/models'
import { reasoningLevelFor } from '@/convex/reasoning'
import { updateSettings } from '@/convex/userSettings'

/** Messages per Thread that the view shows and the Context holds, newest kept. */
export const MAX_MESSAGES = 500
const TITLE_LENGTH = 80

export const liveAnswerOf = (ctx: QueryCtx, threadId: Id<'threads'>) =>
  ctx.db
    .query('liveAnswers')
    .withIndex('by_thread', (q) => q.eq('threadId', threadId))
    .unique()

/** The newest Messages, oldest first. */
export async function latestMessages(ctx: QueryCtx, threadId: Id<'threads'>) {
  const newest = await ctx.db
    .query('messages')
    .withIndex('by_thread', (q) => q.eq('threadId', threadId))
    .order('desc')
    .take(MAX_MESSAGES)
  return newest.toReversed()
}

export async function ownThread(
  ctx: QueryCtx,
  threadId: Id<'threads'>,
  userId: string,
) {
  const thread = await ctx.db.get('threads', threadId)
  if (thread?.userId !== userId) throw new ConvexError('Thread not found')
  return thread
}

/** The Thread's finished Messages, oldest first, Answers with their Model's name. Null while signed out. */
export const messages = query({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    const user = await authComponent.safeGetAuthUser(ctx)
    if (!user) return null
    await ownThread(ctx, threadId, user._id)
    const latest = await latestMessages(ctx, threadId)
    const names = new Map<Id<'models'>, string>()
    for (const m of latest)
      if (m.role === 'assistant' && !names.has(m.modelId))
        // A referenced Model can't be deleted.
        names.set(
          m.modelId,
          (await ctx.db.get('models', m.modelId))?.name ?? '',
        )
    return latest.map((m) =>
      m.role === 'assistant' ? { ...m, modelName: names.get(m.modelId)! } : m,
    )
  },
})

/**
 * Inserts the Prompt and a Live answer, then starts the Answer with the
 * picked choices, which the User's next Thread starts from. Without a
 * `threadId`, starts a new Thread.
 */
export const send = mutation({
  args: {
    threadId: v.optional(v.id('threads')),
    text: v.string(),
    modelId: v.id('models'),
    reasoningLevel: v.optional(v.string()),
    webSearch: v.boolean(),
  },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx)
    const text = args.text.trim()
    if (!text) throw new ConvexError('Write a Prompt first')
    const model = await usableModel(ctx, args.modelId, user.role === 'admin')
    const modelId = model._id
    // The Model may have lost the level since the composer resolved it.
    const reasoningLevel = reasoningLevelFor(
      model.reasoningLevels,
      args.reasoningLevel,
    )
    const { webSearch } = args
    const now = Date.now()

    let threadId = args.threadId
    if (threadId) {
      const thread = await ownThread(ctx, threadId, user._id)
      if (await liveAnswerOf(ctx, thread._id))
        throw new ConvexError('Wait for the Answer or stop it first')
      await ctx.db.patch('threads', thread._id, { lastMessageAt: now, modelId })
    } else {
      threadId = await ctx.db.insert('threads', {
        userId: user._id,
        title: text.slice(0, TITLE_LENGTH),
        titlePending: true,
        pinned: false,
        lastMessageAt: now,
        modelId,
      })
    }

    await ctx.db.insert('messages', {
      threadId,
      userId: user._id,
      role: 'user',
      parts: [{ type: 'text', text }],
      searchText: text,
    })
    const liveAnswerId = await ctx.db.insert('liveAnswers', {
      threadId,
      userId: user._id,
      modelId,
      reasoningLevel,
      webSearch,
      parts: [],
      stopRequested: false,
      lastWriteAt: now,
    })
    await ctx.scheduler.runAfter(0, internal.answer.run, { liveAnswerId })
    await ctx.scheduler.runAfter(STALE_MS, internal.liveAnswers.expire, {
      liveAnswerId,
    })
    await updateSettings(ctx, user._id, {
      lastModelId: modelId,
      lastWebSearch: webSearch,
      // A Model without levels leaves the remembered one for the next Model.
      ...(reasoningLevel && { lastReasoningLevel: reasoningLevel }),
    })
    return threadId
  },
})

/** Asks the action to stop. It finalizes the Answer as stopped on its next save. */
export const stop = mutation({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    const user = await authComponent.getAuthUser(ctx)
    await ownThread(ctx, threadId, user._id)
    const live = await liveAnswerOf(ctx, threadId)
    if (live)
      await ctx.db.patch('liveAnswers', live._id, { stopRequested: true })
  },
})
