import type { QueryCtx } from '@/convex/_generated/server'
import { ConvexError, v } from 'convex/values'
import { mutation, query } from '@/convex/_generated/server'
import { requireAdmin } from '@/convex/users'

const DEFAULT_TITLE_MODEL = 'gpt-6-luna'

/** The Title Model: the Admin's pick, else gpt-6-luna once synced, else null. */
export async function titleModelId(ctx: QueryCtx) {
  const settings = await ctx.db.query('settings').first()
  if (settings) return settings.titleModelId
  const model = await ctx.db
    .query('models')
    .withIndex('by_modelId', (q) => q.eq('modelId', DEFAULT_TITLE_MODEL))
    .first()
  return model?._id ?? null
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx)
    return { titleModelId: await titleModelId(ctx) }
  },
})

/** Any Model can write titles, enabled or not. */
export const update = mutation({
  args: { titleModelId: v.id('models') },
  handler: async (ctx, args) => {
    await requireAdmin(ctx)
    if (!(await ctx.db.get('models', args.titleModelId)))
      throw new ConvexError('That Model no longer exists')
    const settings = await ctx.db.query('settings').first()
    if (settings) await ctx.db.patch('settings', settings._id, args)
    else await ctx.db.insert('settings', args)
  },
})
