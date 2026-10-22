import type { QueryCtx } from '@/convex/_generated/server'
import { ConvexError } from 'convex/values'
import { query } from '@/convex/_generated/server'
import { authComponent } from '@/convex/auth'

/** The signed-in User, for the sidebar footer and their Drafts. Null once the session ends, e.g. mid sign-out. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx)
    if (!user) return null
    return {
      id: user._id,
      name: user.name,
      username: user.username ?? null,
      role: user.role ?? 'user',
    }
  },
})

/** The signed-in Admin. Throws for anyone else. */
export async function requireAdmin(ctx: QueryCtx) {
  const user = await authComponent.getAuthUser(ctx)
  if (user.role !== 'admin') throw new ConvexError('Admins only')
  return user
}
