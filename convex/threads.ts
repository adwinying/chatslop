import type { Doc, Id } from '@/convex/_generated/dataModel'
import type { MutationCtx, QueryCtx } from '@/convex/_generated/server'
import type { Infer } from 'convex/values'
import {
  paginationOptsValidator,
  paginationResultValidator,
} from 'convex/server'
import { ConvexError, v } from 'convex/values'
import { internal } from '@/convex/_generated/api'
import { mutation, query } from '@/convex/_generated/server'
import { attachmentsOf, link, sendable } from '@/convex/attachments'
import { authComponent } from '@/convex/auth'
import { deleteThread, truncate } from '@/convex/cascade'
import { kindOf } from '@/convex/intake'
import { STALE_MS } from '@/convex/liveAnswers'
import { usableModel } from '@/convex/models'
import { reasoningLevelFor } from '@/convex/reasoning'
import schema from '@/convex/schema'
import { messageText, titled, toSearchText } from '@/convex/searchText'
import { updateSettings } from '@/convex/userSettings'

/** Messages per Thread that the view shows and the Context holds, newest kept. */
export const MAX_MESSAGES = 500
export const TITLE_LENGTH = 80

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

/** For queries: null once the Thread is deleted, so tabs still showing it don't fail. */
export async function viewThread(
  ctx: QueryCtx,
  threadId: Id<'threads'>,
  userId: string,
) {
  if (!(await ctx.db.get('threads', threadId))) return null
  return await ownThread(ctx, threadId, userId)
}

/**
 * The Thread's finished Messages, oldest first: Answers with their Model's
 * name, Prompts with their Attachments, which the browser reads by ID alone.
 * Null while signed out.
 */
export const messages = query({
  args: { threadId: v.id('threads') },
  handler: async (ctx, { threadId }) => {
    const user = await authComponent.safeGetAuthUser(ctx)
    if (!user || !(await viewThread(ctx, threadId, user._id))) return null
    const latest = await latestMessages(ctx, threadId)
    const names = new Map<Id<'models'>, string>()
    for (const m of latest)
      if (m.role === 'assistant' && !names.has(m.modelId))
        // A referenced Model can't be deleted.
        names.set(
          m.modelId,
          (await ctx.db.get('models', m.modelId))?.name ?? '',
        )
    return await Promise.all(
      latest.map(async (m) =>
        m.role === 'assistant'
          ? { ...m, modelName: names.get(m.modelId)! }
          : {
              ...m,
              attachments: (await attachmentsOf(ctx, m._id)).map(
                ({ _id, name, mediaType, size }) => ({
                  _id,
                  name,
                  mediaType,
                  size,
                }),
              ),
            },
      ),
    )
  },
})

/** The Model, Reasoning level and Web search an Answer is made with. */
const choicesValidator = v.object({
  modelId: v.id('models'),
  reasoningLevel: v.optional(v.string()),
  webSearch: v.boolean(),
})
type Choices = Infer<typeof choicesValidator>

/** The User's Thread, refused while it has a Live answer. */
async function idleThread(
  ctx: QueryCtx,
  threadId: Id<'threads'>,
  userId: string,
) {
  const thread = await ownThread(ctx, threadId, userId)
  if (await liveAnswerOf(ctx, threadId))
    throw new ConvexError('Wait for the Answer or stop it first')
  return thread
}

/** The choices, with the Model checked and the Reasoning level re-resolved for it. */
async function usableChoices(
  ctx: QueryCtx,
  isAdmin: boolean,
  { modelId, reasoningLevel, webSearch }: Choices,
) {
  const model = await usableModel(ctx, modelId, isAdmin)
  return {
    modelId: model._id,
    reasoningLevel: reasoningLevelFor(model.reasoningLevels, reasoningLevel),
    webSearch,
  }
}

/** Inserts a Live answer made with the choices and starts the action writing it. */
async function startAnswer(
  ctx: MutationCtx,
  threadId: Id<'threads'>,
  userId: string,
  choices: Choices,
) {
  const now = Date.now()
  const liveAnswerId = await ctx.db.insert('liveAnswers', {
    threadId,
    userId,
    ...choices,
    parts: [],
    stopRequested: false,
    lastWriteAt: now,
  })
  await ctx.scheduler.runAfter(0, internal.answer.run, { liveAnswerId })
  await ctx.scheduler.runAfter(STALE_MS, internal.liveAnswers.expire, {
    liveAnswerId,
  })
  await ctx.db.patch('threads', threadId, { lastMessageAt: now })
}

/** Remembers the picked choices for the Thread and the User's next Thread. */
async function remember(
  ctx: MutationCtx,
  threadId: Id<'threads'>,
  userId: string,
  { modelId, reasoningLevel, webSearch }: Choices,
) {
  await ctx.db.patch('threads', threadId, { modelId })
  await updateSettings(ctx, userId, {
    lastModelId: modelId,
    lastWebSearch: webSearch,
    // A Model without levels leaves the remembered one for the next Model.
    ...(reasoningLevel && { lastReasoningLevel: reasoningLevel }),
  })
}

/**
 * The Prompt's text, what the Title Model reads, and what's stored for it.
 * An Attachment-only Prompt keeps no text part.
 */
function promptFields(written: string, attachments: Doc<'attachments'>[]) {
  const text = written.trim()
  if (!text && !attachments.length)
    throw new ConvexError('Write a Prompt first')
  const parts = text ? [{ type: 'text' as const, text }] : []
  // Filenames, not contents, are searchable and seen by the Title Model.
  const searchable = messageText(
    parts,
    attachments.map((a) => a.name),
  )
  return {
    text,
    searchable,
    fields: { parts, searchText: toSearchText(searchable) },
  }
}

/** A new Thread's title until the Title Model's lands. */
function fallbackTitle(text: string, attachments: Doc<'attachments'>[]) {
  const file = attachments.find((a) => kindOf(a.mediaType) !== 'image')
  const title =
    text ||
    (file
      ? `File: ${file.name}`
      : attachments.length === 1
        ? 'Attached image'
        : 'Attached images')
  return title.slice(0, TITLE_LENGTH)
}

/**
 * Inserts the Prompt and a Live answer, then starts the Answer with the
 * picked choices, which the User's next Thread starts from. Without a
 * `threadId`, starts a new Thread.
 */
export const send = mutation({
  args: {
    threadId: v.optional(v.id('threads')),
    text: v.string(),
    attachmentIds: v.optional(v.array(v.id('attachments'))),
    ...choicesValidator.fields,
  },
  handler: async (
    ctx,
    { threadId, text: written, attachmentIds = [], ...picked },
  ) => {
    const user = await authComponent.getAuthUser(ctx)
    const choices = await usableChoices(ctx, user.role === 'admin', picked)
    const attachments = await sendable(ctx, {
      userId: user._id,
      attachmentIds,
      modelId: choices.modelId,
    })
    const { text, searchable, fields } = promptFields(written, attachments)

    if (threadId) {
      await idleThread(ctx, threadId, user._id)
    } else {
      threadId = await ctx.db.insert('threads', {
        userId: user._id,
        ...titled(fallbackTitle(text, attachments)),
        titlePending: true,
        pinned: false,
        lastMessageAt: Date.now(),
        modelId: choices.modelId,
      })
      await ctx.scheduler.runAfter(0, internal.titles.generate, {
        threadId,
        prompt: searchable,
      })
    }

    const promptId = await ctx.db.insert('messages', {
      threadId,
      userId: user._id,
      role: 'user',
      ...fields,
    })
    await link(ctx, promptId, attachments)
    await startAnswer(ctx, threadId, user._id, choices)
    await remember(ctx, threadId, user._id, choices)
    return threadId
  },
})

/**
 * Deletes the Answer and everything after it, then answers its Prompt again
 * with the Answer's choices, or with another Model. Returns how many
 * Messages went.
 */
export const regenerate = mutation({
  args: { answerId: v.id('messages'), modelId: v.optional(v.id('models')) },
  returns: v.number(),
  handler: async (ctx, { answerId, modelId }) => {
    const user = await authComponent.getAuthUser(ctx)
    const answer = await ctx.db.get('messages', answerId)
    if (answer?.role !== 'assistant') throw new ConvexError('Answer not found')
    await idleThread(ctx, answer.threadId, user._id)
    const choices = await usableChoices(ctx, user.role === 'admin', {
      modelId: modelId ?? answer.modelId,
      reasoningLevel: answer.reasoningLevel,
      webSearch: answer.webSearch,
    })

    const removed = await truncate(ctx, answer, { keep: false })
    await startAnswer(ctx, answer.threadId, user._id, choices)
    return removed
  },
})

/**
 * Rewrites the Prompt in place, deletes everything after it, then resends it
 * like `send`. Returns how many Messages went.
 */
export const edit = mutation({
  args: {
    promptId: v.id('messages'),
    text: v.string(),
    /** All the Prompt's Attachments after the edit; those left out are deleted. */
    attachmentIds: v.array(v.id('attachments')),
    ...choicesValidator.fields,
  },
  returns: v.number(),
  handler: async (
    ctx,
    { promptId, text: written, attachmentIds, ...picked },
  ) => {
    const user = await authComponent.getAuthUser(ctx)
    const prompt = await ctx.db.get('messages', promptId)
    if (prompt?.role !== 'user') throw new ConvexError('Prompt not found')
    await idleThread(ctx, prompt.threadId, user._id)
    const choices = await usableChoices(ctx, user.role === 'admin', picked)
    const attachments = await sendable(ctx, {
      userId: user._id,
      attachmentIds,
      modelId: choices.modelId,
      promptId,
    })
    const { fields } = promptFields(written, attachments)

    const removed = await truncate(ctx, prompt, { keep: true })
    await ctx.db.patch('messages', prompt._id, fields)
    await link(ctx, prompt._id, attachments)
    await startAnswer(ctx, prompt.threadId, user._id, choices)
    await remember(ctx, prompt.threadId, user._id, choices)
    return removed
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

/** The Thread's header: title and pin. Null once deleted or while signed out. */
export const get = query({
  args: { threadId: v.id('threads') },
  returns: v.union(
    v.null(),
    schema.doc('threads').pick('_id', 'title', 'titlePending', 'pinned'),
  ),
  handler: async (ctx, { threadId }) => {
    const user = await authComponent.safeGetAuthUser(ctx)
    const thread = await ctx.db.get('threads', threadId)
    if (!user || thread?.userId !== user._id) return null
    const { _id, title, titlePending, pinned } = thread
    return { _id, title, titlePending, pinned }
  },
})

const byLastMessage = (ctx: QueryCtx, userId: string, pinned: boolean) =>
  ctx.db
    .query('threads')
    .withIndex('by_user_pinned_last', (q) =>
      q.eq('userId', userId).eq('pinned', pinned),
    )
    .order('desc')

/** All the User's pinned Threads, newest first, unpaginated (#10). Empty while signed out. */
export const pinned = query({
  args: {},
  returns: v.array(schema.doc('threads')),
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx)
    if (!user) return []
    return await byLastMessage(ctx, user._id, true).collect()
  },
})

/** The User's other Threads, newest first, a page at a time. */
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc('threads')),
  handler: async (ctx, { paginationOpts }) => {
    const user = await authComponent.safeGetAuthUser(ctx)
    if (!user) return { page: [], isDone: true, continueCursor: '' }
    return await byLastMessage(ctx, user._id, false).paginate(paginationOpts)
  },
})

/** Renames the Thread, so the Title Model's title no longer lands. */
export const rename = mutation({
  args: { threadId: v.id('threads'), title: v.string() },
  returns: v.null(),
  handler: async (ctx, { threadId, ...args }) => {
    const user = await authComponent.getAuthUser(ctx)
    await ownThread(ctx, threadId, user._id)
    const title = args.title.trim().slice(0, TITLE_LENGTH)
    if (!title) throw new ConvexError('Write a title first')
    await ctx.db.patch('threads', threadId, {
      ...titled(title),
      titlePending: false,
    })
    return null
  },
})

export const setPinned = mutation({
  args: { threadId: v.id('threads'), pinned: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { threadId, ...fields }) => {
    const user = await authComponent.getAuthUser(ctx)
    await ownThread(ctx, threadId, user._id)
    await ctx.db.patch('threads', threadId, fields)
    return null
  },
})

/** Deletes the Thread, stopping its Live answer, with everything in it. */
export const remove = mutation({
  args: { threadId: v.id('threads') },
  returns: v.null(),
  handler: async (ctx, { threadId }) => {
    const user = await authComponent.getAuthUser(ctx)
    await ownThread(ctx, threadId, user._id)
    await deleteThread(ctx, threadId)
    return null
  },
})
