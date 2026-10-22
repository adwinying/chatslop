import type { Doc, Id } from '@/convex/_generated/dataModel'
import type { MutationCtx, QueryCtx } from '@/convex/_generated/server'
import type { WithoutSystemFields } from 'convex/server'
import { ConvexError, v } from 'convex/values'
import { mutation } from '@/convex/_generated/server'
import { authComponent } from '@/convex/auth'
import { canUse, usableModel } from '@/convex/models'

type Fields = Omit<WithoutSystemFields<Doc<'userSettings'>>, 'userId'>

/** A product limit, far under Convex's array cap; ⌘1–9 reach the first nine. */
export const MAX_FAVORITES = 50

const DEFAULTS = {
  lastWebSearch: true,
  favoriteModelIds: [] as Id<'models'>[],
}

const find = (ctx: QueryCtx, userId: string) =>
  ctx.db
    .query('userSettings')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique()

/** The User's remembered choices and Favorites, with defaults before their first send. */
export const settingsOf = async (
  ctx: QueryCtx,
  userId: string,
): Promise<Fields> => ({ ...DEFAULTS, ...(await find(ctx, userId)) })

export async function updateSettings(
  ctx: MutationCtx,
  userId: string,
  fields: Partial<Fields>,
) {
  const settings = await find(ctx, userId)
  if (settings) await ctx.db.patch('userSettings', settings._id, fields)
  else await ctx.db.insert('userSettings', { userId, ...DEFAULTS, ...fields })
}

/**
 * Stars a usable Model, last in the order, or unstars any Model. Drops
 * Favorites the User can no longer use, so they don't count to the limit.
 */
export const toggleFavorite = mutation({
  args: { modelId: v.id('models') },
  handler: async (ctx, { modelId }) => {
    const user = await authComponent.getAuthUser(ctx)
    const isAdmin = user.role === 'admin'
    const { favoriteModelIds } = await settingsOf(ctx, user._id)
    const models = await Promise.all(
      favoriteModelIds.map((id) => ctx.db.get('models', id)),
    )
    const usable = favoriteModelIds.filter((id, i) => {
      const model = models[i]
      return model && id !== modelId && canUse(model, isAdmin)
    })

    if (!favoriteModelIds.includes(modelId)) {
      await usableModel(ctx, modelId, isAdmin)
      if (usable.length >= MAX_FAVORITES)
        throw new ConvexError(
          `You can have at most ${MAX_FAVORITES} Favorites. Unstar one first.`,
        )
      usable.push(modelId)
    }
    await updateSettings(ctx, user._id, { favoriteModelIds: usable })
  },
})
