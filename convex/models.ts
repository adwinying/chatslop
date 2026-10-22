import type { Doc, Id } from '@/convex/_generated/dataModel'
import type { QueryCtx } from '@/convex/_generated/server'
import { ConvexError, v } from 'convex/values'
import { internal } from '@/convex/_generated/api'
import { mutation, query } from '@/convex/_generated/server'
import { authComponent } from '@/convex/auth'
import { releasedSince } from '@/convex/listing'
import { titleModelId } from '@/convex/settings'
import { requireAdmin } from '@/convex/users'

/** Per Provider in creation order, the Models `select` picks. */
async function byProvider(
  ctx: QueryCtx,
  select: (providerId: Id<'providers'>) => Promise<Doc<'models'>[]>,
) {
  const providers = await ctx.db.query('providers').take(100)
  const perProvider = await Promise.all(providers.map((p) => select(p._id)))
  return perProvider.flat()
}

/** Enforced by `update`, so reading this many enabled Models reads them all. */
const MAX_ENABLED = 100
/**
 * A product limit on the disabled Models one 18-month window lists per
 * Provider. models.dev releases far fewer.
 */
const MAX_LISTED_DISABLED = 500

/** A Provider's enabled or disabled Models released from `from`, newest first. */
const modelsOf = (
  ctx: QueryCtx,
  providerId: Id<'providers'>,
  enabled: boolean,
  from = '',
) =>
  ctx.db
    .query('models')
    .withIndex('by_provider_enabled_releaseDate', (q) =>
      q
        .eq('providerId', providerId)
        .eq('enabled', enabled)
        .gte('releaseDate', from),
    )
    .order('desc')
    .take(enabled ? MAX_ENABLED : MAX_LISTED_DISABLED)

/** Whether a Message, a Live answer or the Title Model setting points at the Model. */
export async function inUse(ctx: QueryCtx, modelId: Id<'models'>) {
  const message = await ctx.db
    .query('messages')
    .withIndex('by_model', (q) => q.eq('modelId', modelId))
    .first()
  const live = await ctx.db
    .query('liveAnswers')
    .withIndex('by_model', (q) => q.eq('modelId', modelId))
    .first()
  return !!message || !!live || (await titleModelId(ctx)) === modelId
}

/** Enabled, and Admin-only only for Admins. */
const canUse = (model: Doc<'models'>, isAdmin: boolean) =>
  model.enabled && (!model.adminOnly || isAdmin)

/** The Model, if this User may send with it. */
export async function usableModel(
  ctx: QueryCtx,
  modelId: Id<'models'>,
  isAdmin: boolean,
) {
  const model = await ctx.db.get('models', modelId)
  if (!model || !canUse(model, isAdmin))
    throw new ConvexError('Pick another Model')
  return model
}

/** The Models the signed-in User can pick. Null while signed out. */
export const options = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx)
    if (!user) return null
    const models = await byProvider(ctx, (providerId) =>
      modelsOf(ctx, providerId, true),
    )
    return models
      .filter((m) => canUse(m, user.role === 'admin'))
      .map(({ _id, providerId, modelId, name, reasoningLevels }) => ({
        _id,
        providerId,
        modelId,
        name,
        reasoningLevels,
      }))
  },
})

/**
 * The Admin list: Models released since `since` (from `listedSince`), plus
 * older ones still enabled or writing titles, so they stay manageable.
 */
export const list = query({
  args: { since: v.string() },
  handler: async (ctx, { since }) => {
    await requireAdmin(ctx)
    const titleId = await titleModelId(ctx)
    const title = titleId && (await ctx.db.get('models', titleId))
    return byProvider(ctx, async (providerId) => {
      const [enabled, disabled] = await Promise.all([
        modelsOf(ctx, providerId, true),
        // The month prefix keeps month-only dates; `releasedSince` trims the rest.
        modelsOf(ctx, providerId, false, since.slice(0, 7)),
      ])
      const models = [
        ...enabled,
        ...disabled.filter((m) => releasedSince(m.releaseDate, since)),
      ]
      if (
        title?.providerId === providerId &&
        !models.some((m) => m._id === title._id)
      )
        models.push(title)
      return models.toSorted((a, b) =>
        b.releaseDate.localeCompare(a.releaseDate),
      )
    })
  },
})

export const update = mutation({
  args: {
    modelId: v.id('models'),
    enabled: v.optional(v.boolean()),
    adminOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, { modelId, ...fields }) => {
    await requireAdmin(ctx)
    const model = await ctx.db.get('models', modelId)
    if (!model) throw new ConvexError('That Model no longer exists')
    if (fields.enabled && !model.enabled) {
      const enabled = await modelsOf(ctx, model.providerId, true)
      if (enabled.length >= MAX_ENABLED)
        throw new ConvexError(
          `A Provider has at most ${MAX_ENABLED} enabled Models. Disable one first.`,
        )
    }
    await ctx.db.patch('models', modelId, fields)
  },
})

export const remove = mutation({
  args: { modelId: v.id('models') },
  handler: async (ctx, { modelId }) => {
    await requireAdmin(ctx)
    if (await inUse(ctx, modelId))
      throw new ConvexError('The Model is in use, so it stays')
    await ctx.db.delete('models', modelId)
  },
})

export const syncNow = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx)
    await ctx.scheduler.runAfter(0, internal.modelSync.sync, {})
  },
})
