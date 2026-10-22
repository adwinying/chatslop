import type { Id } from '@/convex/_generated/dataModel'
import type { MutationCtx } from '@/convex/_generated/server'
import { v } from 'convex/values'
import { internal } from '@/convex/_generated/api'
import { internalMutation } from '@/convex/_generated/server'
import { liveAnswerOf } from '@/convex/threads'

/** Most Messages deleted per scheduled mutation, with their Attachments. */
export const CASCADE_BATCH = 100
/** The share of each transaction limit a batch leaves unused. */
const RESERVE = 0.1

/**
 * Deletes the Thread and its Live answer now, then its Messages, Attachments
 * and blobs in scheduled batches. Thread delete and User delete share it.
 * A deleted Live answer tells its action to stop on the next save.
 */
export async function deleteThread(ctx: MutationCtx, threadId: Id<'threads'>) {
  const live = await liveAnswerOf(ctx, threadId)
  if (live) await ctx.db.delete('liveAnswers', live._id)
  await ctx.db.delete('threads', threadId)
  await ctx.scheduler.runAfter(0, internal.cascade.deleteMessages, {
    threadId,
  })
}

export const deleteMessages = internalMutation({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    // Messages vary in size, so a batch also ends near the transaction limits.
    // A Message left half done keeps its remaining Attachments for the next.
    const next = async () => {
      await ctx.scheduler.runAfter(0, internal.cascade.deleteMessages, {
        threadId,
      })
    }
    let deleted = 0
    const messages = ctx.db
      .query('messages')
      .withIndex('by_thread', (q) => q.eq('threadId', threadId))
    for await (const message of messages) {
      if (deleted === CASCADE_BATCH || (await nearLimits(ctx))) return next()
      const attachments = ctx.db
        .query('attachments')
        .withIndex('by_message', (q) => q.eq('messageId', message._id))
      for await (const attachment of attachments) {
        if (await nearLimits(ctx)) return next()
        await ctx.storage.delete(attachment.storageId)
        await ctx.db.delete('attachments', attachment._id)
      }
      await ctx.db.delete('messages', message._id)
      deleted++
    }
  },
})

async function nearLimits(ctx: MutationCtx) {
  const metrics = await ctx.meta.getTransactionMetrics()
  return Object.values(metrics).some(
    ({ used, remaining }) => remaining < (used + remaining) * RESERVE,
  )
}
