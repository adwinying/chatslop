import type { Id } from '@/convex/_generated/dataModel'
import type { MutationCtx } from '@/convex/_generated/server'
import { v } from 'convex/values'
import { internal } from '@/convex/_generated/api'
import { internalMutation } from '@/convex/_generated/server'
import { liveAnswerOf } from '@/convex/threads'

/** Messages deleted per scheduled mutation, with their Attachments. */
export const CASCADE_BATCH = 100

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
    const messages = await ctx.db
      .query('messages')
      .withIndex('by_thread', (q) => q.eq('threadId', threadId))
      .take(CASCADE_BATCH)
    for (const message of messages) {
      // Bounded by the Attachments a Prompt may hold.
      const attachments = ctx.db
        .query('attachments')
        .withIndex('by_message', (q) => q.eq('messageId', message._id))
      for await (const attachment of attachments) {
        await ctx.storage.delete(attachment.storageId)
        await ctx.db.delete('attachments', attachment._id)
      }
      await ctx.db.delete('messages', message._id)
    }
    if (messages.length === CASCADE_BATCH)
      await ctx.scheduler.runAfter(0, internal.cascade.deleteMessages, {
        threadId,
      })
  },
})
