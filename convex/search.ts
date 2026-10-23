import type { Doc, Id } from '@/convex/_generated/dataModel'
import type { MutationCtx, QueryCtx } from '@/convex/_generated/server'
import type { Infer } from 'convex/values'
import { v } from 'convex/values'
import { internal } from '@/convex/_generated/api'
import { internalMutation, query } from '@/convex/_generated/server'
import { attachmentsOf } from '@/convex/attachments'
import { authComponent } from '@/convex/auth'
import {
  messageText,
  plainText,
  queryPattern,
  searchTerms,
  snippet,
  toSearchText,
} from '@/convex/searchText'

const TITLE_HITS = 20
const MESSAGE_HITS = 100
const MAX_THREADS = 20
const REINDEX_BATCH = 100

const hitValidator = v.object({
  _id: v.id('threads'),
  title: v.string(),
  /** The best matching Message, if any. */
  message: v.union(
    v.null(),
    v.object({ _id: v.id('messages'), snippet: v.string() }),
  ),
})

/** The Message's searchable text, Attachment names included. */
async function searchable(ctx: QueryCtx, message: Doc<'messages'>) {
  const names =
    message.role === 'user'
      ? (await attachmentsOf(ctx, message._id)).map((a) => a.name)
      : []
  return messageText(message.parts, names)
}

/**
 * Thread search: Threads whose title contains the query, then Threads with a
 * Message that does, each with its best Message's snippet. Search ranks by
 * relevance only, and bigrammed CJK matches loosely, so hits are kept only
 * where the raw query appears. Empty while signed out.
 */
export const threads = query({
  args: { query: v.string() },
  returns: v.array(hitValidator),
  handler: async (ctx, args) => {
    const user = await authComponent.safeGetAuthUser(ctx)
    const terms = searchTerms(args.query)
    if (!user || !terms) return []
    const pattern = queryPattern(args.query)

    const titleHits = await ctx.db
      .query('threads')
      .withSearchIndex('search_title', (q) =>
        q.search('searchTitle', terms).eq('userId', user._id),
      )
      .take(TITLE_HITS)
    const found = new Map<Id<'threads'>, Infer<typeof hitValidator>>()
    for (const { _id, title } of titleHits)
      if (pattern.test(title)) found.set(_id, { _id, title, message: null })

    const messageHits = await ctx.db
      .query('messages')
      .withSearchIndex('search_text', (q) =>
        q.search('searchText', terms).eq('userId', user._id),
      )
      .take(MESSAGE_HITS)
    for (const message of messageHits) {
      const hit = found.get(message.threadId)
      if (hit?.message || (!hit && found.size >= MAX_THREADS)) continue
      const text = snippet(plainText(await searchable(ctx, message)), pattern)
      if (!text) continue
      const matched = { _id: message._id, snippet: text }
      if (hit) {
        hit.message = matched
        continue
      }
      // Its Messages outlive a deleted Thread for a moment.
      const thread = await ctx.db.get('threads', message.threadId)
      if (thread)
        found.set(thread._id, {
          _id: thread._id,
          title: thread.title,
          message: matched,
        })
    }
    return [...found.values()]
  },
})

type Page = { numItems: number; cursor: string | null }

async function reindexThreads(ctx: MutationCtx, page: Page) {
  const result = await ctx.db.query('threads').paginate(page)
  for (const { _id, title, searchTitle } of result.page) {
    const fresh = toSearchText(title)
    if (fresh !== searchTitle)
      await ctx.db.patch('threads', _id, { searchTitle: fresh })
  }
  return result
}

async function reindexMessages(ctx: MutationCtx, page: Page) {
  const result = await ctx.db.query('messages').paginate(page)
  for (const message of result.page) {
    const fresh = toSearchText(await searchable(ctx, message))
    if (fresh !== message.searchText)
      await ctx.db.patch('messages', message._id, { searchText: fresh })
  }
  return result
}

/**
 * Rewrites each Thread's `searchTitle`, then each Message's `searchText`,
 * where it differs from what `toSearchText` gives now, a batch at a time.
 * `pnpm seed` runs it, so old rows follow changes to `toSearchText`.
 */
export const reindex = internalMutation({
  args: {
    table: v.optional(v.union(v.literal('threads'), v.literal('messages'))),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, { table = 'threads', cursor = null }) => {
    const page = { numItems: REINDEX_BATCH, cursor }
    const { isDone, continueCursor } =
      table === 'threads'
        ? await reindexThreads(ctx, page)
        : await reindexMessages(ctx, page)
    if (!isDone)
      await ctx.scheduler.runAfter(0, internal.search.reindex, {
        table,
        cursor: continueCursor,
      })
    else if (table === 'threads')
      await ctx.scheduler.runAfter(0, internal.search.reindex, {
        table: 'messages',
      })
  },
})
