import type { Doc, Id } from '@/convex/_generated/dataModel'
import type { MutationCtx } from '@/convex/_generated/server'
import { ConvexError, v } from 'convex/values'
import { internal } from '@/convex/_generated/api'
import { internalMutation } from '@/convex/_generated/server'
import { deleteAttachment } from '@/convex/attachments'
import { liveAnswerOf, MAX_MESSAGES } from '@/convex/threads'

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
        await deleteAttachment(ctx, attachment)
      }
      await ctx.db.delete('messages', message._id)
      deleted++
    }
  },
})

/**
 * Deletes a deleted User's settings, unsent Attachments, and Threads, each
 * Thread through `deleteThread`. Runs in scheduled batches like
 * `deleteMessages`, since a User may have any number of Threads.
 */
export const deleteUser = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const next = async () => {
      await ctx.scheduler.runAfter(0, internal.cascade.deleteUser, { userId })
    }
    const settings = await ctx.db
      .query('userSettings')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .unique()
    if (settings) await ctx.db.delete('userSettings', settings._id)

    let deleted = 0
    const unsent = ctx.db
      .query('attachments')
      .withIndex('by_user_message', (q) =>
        q.eq('userId', userId).eq('messageId', undefined),
      )
    for await (const attachment of unsent) {
      if (deleted === CASCADE_BATCH || (await nearLimits(ctx))) return next()
      await deleteAttachment(ctx, attachment)
      deleted++
    }
    const threads = ctx.db
      .query('threads')
      .withIndex('by_user_pinned_last', (q) => q.eq('userId', userId))
    for await (const thread of threads) {
      if (deleted === CASCADE_BATCH || (await nearLimits(ctx))) return next()
      await deleteThread(ctx, thread._id)
      deleted++
    }
  },
})

/**
 * Deletes the Messages after `message`, and `message` too unless kept, with
 * their Attachments and blobs. Returns how many Messages went. Only Messages
 * the view shows can be truncated, which bounds the work to one transaction.
 */
export async function truncate(
  ctx: MutationCtx,
  { threadId, _creationTime }: Doc<'messages'>,
  { keep }: { keep: boolean },
) {
  const messages = await ctx.db
    .query('messages')
    .withIndex('by_thread', (q) =>
      keep
        ? q.eq('threadId', threadId).gt('_creationTime', _creationTime)
        : q.eq('threadId', threadId).gte('_creationTime', _creationTime),
    )
    .take(MAX_MESSAGES + 1)
  if (messages.length > MAX_MESSAGES)
    throw new ConvexError('That Message is too far back to change')
  for (const message of messages) {
    const attachments = ctx.db
      .query('attachments')
      .withIndex('by_message', (q) => q.eq('messageId', message._id))
    for await (const attachment of attachments) {
      await deleteAttachment(ctx, attachment)
    }
    await ctx.db.delete('messages', message._id)
  }
  return messages.length
}

async function nearLimits(ctx: MutationCtx) {
  const metrics = await ctx.meta.getTransactionMetrics()
  return Object.values(metrics).some(
    ({ used, remaining }) => remaining < (used + remaining) * RESERVE,
  )
}
