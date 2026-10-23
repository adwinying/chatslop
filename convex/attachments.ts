import type { Doc, Id } from '@/convex/_generated/dataModel'
import type { MutationCtx, QueryCtx } from '@/convex/_generated/server'
import { ConvexError, v } from 'convex/values'
import { internal } from '@/convex/_generated/api'
import {
  action,
  httpAction,
  internalMutation,
  internalQuery,
  mutation,
} from '@/convex/_generated/server'
import { authComponent } from '@/convex/auth'
import {
  decodeText,
  kindOf,
  MAX_ATTACHMENTS,
  MAX_BYTES,
  SIZE_LABEL,
} from '@/convex/intake'

const MAX_NAME = 200
const LOST = 'The upload was lost. Attach it again.'

/** Leading bytes of the image types both Providers take, then PDF. */
const SIGNATURES: [string, (number | null)[]][] = [
  ['image/png', [0x89, 0x50, 0x4e, 0x47]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/gif', [0x47, 0x49, 0x46, 0x38]],
  // RIFF, a four-byte size, then WEBP.
  [
    'image/webp',
    [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50],
  ],
  ['application/pdf', [0x25, 0x50, 0x44, 0x46, 0x2d]],
]

/** The media type the bytes show, `text/plain` for UTF-8 without NUL, else null. */
function sniff(bytes: Uint8Array) {
  const match = SIGNATURES.find(([, signature]) =>
    signature.every((byte, i) => byte === null || bytes[i] === byte),
  )
  if (match) return match[0]
  return decodeText(bytes) === null ? null : 'text/plain'
}

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await authComponent.getAuthUser(ctx)
    return await ctx.storage.generateUploadUrl()
  },
})

const attachmentView = v.object({
  _id: v.id('attachments'),
  name: v.string(),
  mediaType: v.string(),
  size: v.number(),
})

/**
 * Registers an uploaded blob as an unsent Attachment, re-checking its type
 * and size from the bytes. A refused blob is deleted.
 */
export const add = action({
  args: { storageId: v.id('_storage'), name: v.string() },
  returns: attachmentView,
  handler: async (ctx, { storageId, ...args }) => {
    const user = await authComponent.getAuthUser(ctx)
    const name = args.name.trim().slice(0, MAX_NAME) || 'file'
    const blob = await ctx.storage.get(storageId)
    if (!blob) throw new ConvexError(LOST)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const refuse = async (message: string) => {
      await ctx.storage.delete(storageId)
      throw new ConvexError(message)
    }

    const mediaType = sniff(bytes)
    if (!mediaType)
      return await refuse('Only images, PDFs and text files can be attached')
    const kind = kindOf(mediaType)
    if (bytes.length > MAX_BYTES[kind])
      return await refuse(`${name} is over ${SIZE_LABEL[kind]}`)

    const attachment = {
      name,
      mediaType,
      size: bytes.length,
    }
    const _id: Id<'attachments'> = await ctx.runMutation(
      internal.attachments.insert,
      { userId: user._id, storageId, ...attachment },
    )
    return { _id, ...attachment }
  },
})

/**
 * The Attachments a Prompt is sent with, in upload order, after checking
 * each is the User's, unsent or already this Prompt's, and readable by the
 * Model. Text files every Model reads.
 */
export async function sendable(
  ctx: QueryCtx,
  {
    userId,
    attachmentIds,
    modelId,
    promptId,
  }: {
    userId: string
    attachmentIds: Id<'attachments'>[]
    modelId: Id<'models'>
    promptId?: Id<'messages'>
  },
) {
  const ids = new Set(attachmentIds)
  if (ids.size > MAX_ATTACHMENTS)
    throw new ConvexError(`Attach at most ${MAX_ATTACHMENTS} files`)
  const model = await ctx.db.get('models', modelId)
  const attachments: Doc<'attachments'>[] = []
  for (const id of ids) {
    const attachment = await ctx.db.get('attachments', id)
    if (
      attachment?.userId !== userId ||
      (attachment.messageId && attachment.messageId !== promptId)
    )
      throw new ConvexError(
        'An Attachment is gone. Remove it and attach it again.',
      )
    const kind = kindOf(attachment.mediaType)
    if (kind !== 'text' && !model?.attachmentTypes.includes(kind))
      throw new ConvexError(`This Model can't read ${attachment.name}`)
    attachments.push(attachment)
  }
  return attachments.toSorted((a, b) => a._creationTime - b._creationTime)
}

/** The Prompt's Attachments, in upload order. */
export const attachmentsOf = (ctx: QueryCtx, messageId: Id<'messages'>) =>
  ctx.db
    .query('attachments')
    .withIndex('by_message', (q) => q.eq('messageId', messageId))
    .take(MAX_ATTACHMENTS)

/** Links the Attachments to the Prompt, deleting those it had before and lost, with their blobs. */
export async function link(
  ctx: MutationCtx,
  promptId: Id<'messages'>,
  attachments: Doc<'attachments'>[],
) {
  const kept = new Set(attachments.map((a) => a._id))
  for (const old of await attachmentsOf(ctx, promptId))
    if (!kept.has(old._id)) await deleteAttachment(ctx, old)
  for (const { _id } of attachments)
    await ctx.db.patch('attachments', _id, { messageId: promptId })
}

export const insert = internalMutation({
  args: {
    userId: v.string(),
    storageId: v.id('_storage'),
    name: v.string(),
    mediaType: v.string(),
    size: v.number(),
  },
  returns: v.id('attachments'),
  handler: async (ctx, args) => {
    // Else a User who learned another's storage ID could read and delete their blob.
    const registered = await ctx.db
      .query('attachments')
      .withIndex('by_storage', (q) => q.eq('storageId', args.storageId))
      .first()
    if (registered) throw new ConvexError(LOST)
    return await ctx.db.insert('attachments', args)
  },
})

/** Deletes the Attachment with its blob. */
export async function deleteAttachment(
  ctx: MutationCtx,
  attachment: Doc<'attachments'>,
) {
  await ctx.storage.delete(attachment.storageId)
  await ctx.db.delete('attachments', attachment._id)
}

/** Deletes an Attachment removed from the Draft. A sent one stays with its Prompt. */
export const remove = mutation({
  args: { attachmentId: v.id('attachments') },
  returns: v.null(),
  handler: async (ctx, { attachmentId }) => {
    const user = await authComponent.getAuthUser(ctx)
    const attachment = await ctx.db.get('attachments', attachmentId)
    if (attachment?.userId === user._id && !attachment.messageId)
      await deleteAttachment(ctx, attachment)
    return null
  },
})

const UNSENT_TTL_MS = 24 * 3_600_000
export const SWEEP_BATCH = 100

/** The cron's cleanup of Attachments left unsent for 24 hours, a batch at a time. */
export const sweep = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const stale = await ctx.db
      .query('attachments')
      .withIndex('by_message', (q) =>
        q
          .eq('messageId', undefined)
          .lte('_creationTime', Date.now() - UNSENT_TTL_MS),
      )
      .take(SWEEP_BATCH)
    for (const attachment of stale) await deleteAttachment(ctx, attachment)
    if (stale.length === SWEEP_BATCH)
      await ctx.scheduler.runAfter(0, internal.attachments.sweep, {})
    return null
  },
})

/** How far back the daily blob sweep looks, so one missed run loses nothing. */
const BLOB_SWEEP_SPAN_MS = 2 * UNSENT_TTL_MS

/**
 * The cron's cleanup of blobs uploaded but never registered, e.g. when the
 * tab closed mid-upload. Only blobs of the last span past the TTL are
 * checked, so sent ones aren't rescanned forever.
 */
export const sweepBlobs = internalMutation({
  args: { after: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const before = Date.now() - UNSENT_TTL_MS
    const after = args.after ?? before - BLOB_SWEEP_SPAN_MS
    const blobs = await ctx.db.system
      .query('_storage')
      .withIndex('by_creation_time', (q) =>
        q.gt('_creationTime', after).lte('_creationTime', before),
      )
      .take(SWEEP_BATCH)
    for (const blob of blobs) {
      const registered = await ctx.db
        .query('attachments')
        .withIndex('by_storage', (q) => q.eq('storageId', blob._id))
        .first()
      if (!registered) await ctx.storage.delete(blob._id)
    }
    const last = blobs.at(-1)
    if (blobs.length === SWEEP_BATCH && last)
      await ctx.scheduler.runAfter(0, internal.attachments.sweepBlobs, {
        after: last._creationTime,
      })
    return null
  },
})

export const owned = internalQuery({
  args: { id: v.string(), userId: v.string() },
  handler: async (ctx, { id, userId }) => {
    const attachmentId = ctx.db.normalizeId('attachments', id)
    const attachment =
      attachmentId && (await ctx.db.get('attachments', attachmentId))
    return attachment?.userId === userId ? attachment : null
  },
})

export const SERVE_PREFIX = '/attachments/'

/**
 * Streams an Attachment's blob to the User who owns it, else 404. The Start
 * route `/api/attachments/:id` forwards here with the session's token.
 * Never `getUrl`: its URLs are permanent and unauthenticated (#8).
 */
export const serve = httpAction(async (ctx, request) => {
  const user = await authComponent.safeGetAuthUser(ctx)
  if (!user) return new Response('Log in first', { status: 401 })
  const attachment = await ctx.runQuery(internal.attachments.owned, {
    id: new URL(request.url).pathname.slice(SERVE_PREFIX.length),
    userId: user._id,
  })
  const blob = attachment && (await ctx.storage.get(attachment.storageId))
  if (!attachment || !blob) return new Response('Not found', { status: 404 })
  const { name, mediaType } = attachment
  return new Response(blob, {
    headers: {
      // Text files show as raw text, whatever they hold, e.g. HTML.
      'Content-Type':
        kindOf(mediaType) === 'text' ? 'text/plain; charset=utf-8' : mediaType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      'X-Content-Type-Options': 'nosniff',
      // Only the session may read it, so no cache may replay it to the next one.
      'Cache-Control': 'private, no-store',
    },
  })
})
