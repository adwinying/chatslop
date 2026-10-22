import { ConvexError, v } from 'convex/values'
import { mutation, query } from '@/convex/_generated/server'
import { inUse } from '@/convex/models'
import { requireAdmin } from '@/convex/users'

/** The Providers in creation order. The key never leaves the server; only whether one is set. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx)
    const providers = await ctx.db.query('providers').take(100)
    return providers.map(({ apiKey, ...provider }) => ({
      ...provider,
      hasApiKey: apiKey !== '',
    }))
  },
})

/** A blank `apiKey` keeps the current key. */
export const update = mutation({
  args: {
    providerId: v.id('providers'),
    name: v.string(),
    baseUrl: v.string(),
    apiKey: v.string(),
  },
  handler: async (ctx, { providerId, name, baseUrl, apiKey }) => {
    await requireAdmin(ctx)
    if (!name.trim()) throw new ConvexError('Name the Provider')
    await ctx.db.patch('providers', providerId, {
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      ...(apiKey.trim() && { apiKey: apiKey.trim() }),
    })
  },
})

/** Deletes the Provider and its Models, unless any of them is in use. */
export const remove = mutation({
  args: { providerId: v.id('providers') },
  handler: async (ctx, { providerId }) => {
    await requireAdmin(ctx)
    const models = await ctx.db
      .query('models')
      .withIndex('by_provider_modelId', (q) => q.eq('providerId', providerId))
      .take(500)
    for (const model of models) {
      if (await inUse(ctx, model._id))
        throw new ConvexError(`${model.name} is in use, so the Provider stays`)
    }
    for (const model of models) await ctx.db.delete('models', model._id)
    await ctx.db.delete('providers', providerId)
  },
})
