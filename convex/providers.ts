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
  handler: async (ctx, { providerId, ...args }) => {
    await requireAdmin(ctx)
    const [name, baseUrl, apiKey] = [args.name, args.baseUrl, args.apiKey].map(
      (value) => value.trim(),
    )
    if (!name) throw new ConvexError('Name the Provider')
    // Blank stays allowed: the seed leaves it blank until an Admin sets it.
    if (baseUrl && !isHttpUrl(baseUrl))
      throw new ConvexError('Enter the base URL as http(s)://…')
    await ctx.db.patch('providers', providerId, {
      name,
      baseUrl,
      ...(apiKey && { apiKey }),
    })
  },
})

function isHttpUrl(value: string) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

/**
 * Deletes the Provider and every one of its Models, unless any is in use.
 * Unbounded on purpose: a throw, or a scan past the transaction limits,
 * rolls the whole deletion back.
 */
export const remove = mutation({
  args: { providerId: v.id('providers') },
  handler: async (ctx, { providerId }) => {
    await requireAdmin(ctx)
    const models = ctx.db
      .query('models')
      .withIndex('by_provider_modelId', (q) => q.eq('providerId', providerId))
    for await (const model of models) {
      if (await inUse(ctx, model._id))
        throw new ConvexError(`${model.name} is in use, so the Provider stays`)
      await ctx.db.delete('models', model._id)
    }
    await ctx.db.delete('providers', providerId)
  },
})
