import type { Doc, Id } from '@/convex/_generated/dataModel'
import type { QueryCtx } from '@/convex/_generated/server'
import { ConvexError, v } from 'convex/values'
import { internal } from '@/convex/_generated/api'
import { mutation, query } from '@/convex/_generated/server'
import { authComponent } from '@/convex/auth'
import { titleModelId } from '@/convex/settings'
import { requireAdmin } from '@/convex/users'

/** Every Model, by Provider in creation order, then newest first. */
async function allModels(ctx: QueryCtx) {
  const providers = await ctx.db.query('providers').take(100)
  const perProvider = await Promise.all(
    providers.map(async (provider) => {
      const models = await ctx.db
        .query('models')
        .withIndex('by_provider_modelId', (q) =>
          q.eq('providerId', provider._id),
        )
        .take(500)
      return models.toSorted((a, b) =>
        b.releaseDate.localeCompare(a.releaseDate),
      )
    }),
  )
  return perProvider.flat()
}

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
    const models = await allModels(ctx)
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

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx)
    return await allModels(ctx)
  },
})

export const update = mutation({
  args: {
    modelId: v.id('models'),
    enabled: v.boolean(),
    adminOnly: v.boolean(),
  },
  handler: async (ctx, { modelId, ...fields }) => {
    await requireAdmin(ctx)
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
