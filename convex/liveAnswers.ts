import type { Doc } from '@/convex/_generated/dataModel'
import type { MutationCtx } from '@/convex/_generated/server'
import type { Part } from '@/convex/parts'
import type { Infer } from 'convex/values'
import { v } from 'convex/values'
import { internal } from '@/convex/_generated/api'
import {
  internalMutation,
  internalQuery,
  query,
} from '@/convex/_generated/server'
import { authComponent } from '@/convex/auth'
import { partsValidator } from '@/convex/parts'
import { timingValidator, usageValidator } from '@/convex/schema'
import { latestMessages, liveAnswerOf, viewThread } from '@/convex/threads'

/** The action writes at least this often, even with nothing new to save. */
export const HEARTBEAT_MS = 30_000
/** A Live answer silent this long has lost its action, e.g. to a restart. */
export const STALE_MS = 120_000

/** The Thread's Live answer, which every open tab watches while it streams. Null while signed out. */
export const get = query({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    const user = await authComponent.safeGetAuthUser(ctx)
    if (!user || !(await viewThread(ctx, threadId, user._id))) return null
    return await liveAnswerOf(ctx, threadId)
  },
})

/** The User's Threads with a Live answer, for the sidebar's spinners. Empty while signed out. */
export const threadIds = query({
  args: {},
  returns: v.array(v.id('threads')),
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx)
    if (!user) return []
    // At most one per Thread.
    const live = await ctx.db
      .query('liveAnswers')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .take(100)
    return live.map((l) => l.threadId)
  },
})

/** Everything the action needs to write the Answer, or null once it's finished. */
export const context = internalQuery({
  args: { liveAnswerId: v.id('liveAnswers') },
  handler: async (ctx, { liveAnswerId }) => {
    const live = await ctx.db.get('liveAnswers', liveAnswerId)
    if (!live) return null
    const model = await ctx.db.get('models', live.modelId)
    if (!model) throw new Error('The Model no longer exists')
    const provider = await ctx.db.get('providers', model.providerId)
    if (!provider) throw new Error('The Provider no longer exists')
    const messages = await latestMessages(ctx, live.threadId)
    return {
      live,
      model,
      provider,
      // Errored Answers stay visible but out of Context; the User regenerates them.
      messages: messages
        .filter((m) => m.role === 'user' || m.status !== 'error')
        .map(({ role, parts }) => ({ role, parts })),
    }
  },
})

/** Saves a snapshot (or just a heartbeat) and tells the action whether to stop. */
export const save = internalMutation({
  args: {
    liveAnswerId: v.id('liveAnswers'),
    parts: v.optional(partsValidator),
  },
  handler: async (ctx, { liveAnswerId, parts }) => {
    const live = await ctx.db.get('liveAnswers', liveAnswerId)
    if (!live) return { stop: true }
    const now = Date.now()
    if (parts) {
      await ctx.db.patch('liveAnswers', liveAnswerId, {
        parts,
        lastWriteAt: now,
      })
    } else if (now - live.lastWriteAt >= HEARTBEAT_MS) {
      await ctx.db.patch('liveAnswers', liveAnswerId, { lastWriteAt: now })
    }
    return { stop: live.stopRequested }
  },
})

const outcome = v.object({
  parts: partsValidator,
  error: v.optional(v.string()),
  usage: v.optional(usageValidator),
  timing: v.optional(timingValidator),
})

export const finish = internalMutation({
  args: { liveAnswerId: v.id('liveAnswers'), ...outcome.fields },
  handler: async (ctx, { liveAnswerId, ...rest }) => {
    const live = await ctx.db.get('liveAnswers', liveAnswerId)
    // Already finalized, by the timeout or an earlier finish.
    if (!live) return
    await finalize(ctx, live, rest)
  },
})

/** Finalizes a Live answer whose action died without finishing. */
export const expire = internalMutation({
  args: { liveAnswerId: v.id('liveAnswers') },
  handler: async (ctx, { liveAnswerId }) => {
    const live = await ctx.db.get('liveAnswers', liveAnswerId)
    if (!live) return
    const idle = Date.now() - live.lastWriteAt
    if (idle < STALE_MS) {
      await ctx.scheduler.runAfter(
        STALE_MS - idle,
        internal.liveAnswers.expire,
        { liveAnswerId },
      )
      return
    }
    await finalize(ctx, live, {
      parts: live.parts,
      error: live.stopRequested ? undefined : 'The Answer was interrupted.',
    })
  },
})

/** Inserts the Answer and deletes the Live answer in one transaction. */
async function finalize(
  ctx: MutationCtx,
  live: Doc<'liveAnswers'>,
  { parts, error, usage, timing }: Infer<typeof outcome>,
) {
  await ctx.db.insert('messages', {
    threadId: live.threadId,
    userId: live.userId,
    role: 'assistant',
    parts,
    searchText: searchText(parts),
    modelId: live.modelId,
    reasoningLevel: live.reasoningLevel,
    webSearch: live.webSearch,
    status: error ? 'error' : live.stopRequested ? 'stopped' : 'complete',
    error,
    usage,
    timing,
  })
  await ctx.db.delete('liveAnswers', live._id)
  await ctx.db.patch('threads', live.threadId, { lastMessageAt: Date.now() })
}

// Thread search will bigram CJK here; reasoning and sources stay out.
export function searchText(parts: Part[]) {
  return parts
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n')
}
