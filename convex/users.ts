import type { ActionCtx, QueryCtx } from '@/convex/_generated/server'
import type { Doc } from '@/convex/betterAuth/_generated/dataModel'
import { isAPIError } from 'better-auth/api'
import { ConvexError, v } from 'convex/values'
import { components } from '@/convex/_generated/api'
import { action, query } from '@/convex/_generated/server'
import { authComponent, createAuth } from '@/convex/auth'

/** Far above a small closed group, so the list needs no paging. */
const MAX_USERS = 500

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
export async function requireAdmin(ctx: QueryCtx | ActionCtx) {
  const user = await authComponent.getAuthUser(ctx)
  if (user.role !== 'admin') throw new ConvexError('Admins only')
  return user
}

/** Every User, oldest first, for /admin. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx)
    const { page }: { page: Doc<'user'>[] } = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      { model: 'user', paginationOpts: { numItems: MAX_USERS, cursor: null } },
    )
    return page.map((user) => ({
      id: user._id,
      name: user.name,
      username: user.username ?? null,
      email: user.email,
      role: user.role ?? 'user',
      banned: user.banned ?? false,
    }))
  },
})

/**
 * Runs a Better Auth admin endpoint as the signed-in Admin, which Better Auth
 * checks again. Its refusals reach the client as ConvexErrors.
 */
async function asAdmin<T>(
  ctx: ActionCtx,
  run: (
    api: ReturnType<typeof createAuth>['api'],
    headers: Headers,
  ) => Promise<T>,
) {
  await requireAdmin(ctx)
  const { auth, headers } = await authComponent.getAuth(createAuth, ctx)
  try {
    return await run(auth.api, headers)
  } catch (error) {
    if (isAPIError(error)) throw new ConvexError(error.message)
    throw error
  }
}

/** Creates a User. Without an email, they get a placeholder and log in by username. */
export const create = action({
  args: {
    username: v.string(),
    password: v.string(),
    email: v.optional(v.string()),
  },
  handler: async (ctx, { username, password, email }) => {
    await asAdmin(ctx, (api, headers) =>
      api.createUser({
        body: {
          email: email || `${username}@users.invalid`,
          password,
          name: username,
          role: 'user',
          data: { username },
        },
        headers,
      }),
    )
  },
})

/** Logs the User out and blocks their logins until re-enabled. */
export const disable = action({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    await asAdmin(ctx, (api, headers) =>
      api.banUser({ body: { userId }, headers }),
    )
  },
})

export const enable = action({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    await asAdmin(ctx, (api, headers) =>
      api.unbanUser({ body: { userId }, headers }),
    )
  },
})

/** Sets a new password and logs the User out everywhere. */
export const resetPassword = action({
  args: { userId: v.string(), password: v.string() },
  handler: async (ctx, { userId, password }) => {
    await asAdmin(ctx, async (api, headers) => {
      await api.setUserPassword({
        body: { userId, newPassword: password },
        headers,
      })
      await api.revokeUserSessions({ body: { userId }, headers })
    })
  },
})

/**
 * Deletes the User's account. The `user` delete trigger in auth.ts then
 * deletes their data. Admins can't delete themselves.
 */
export const remove = action({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    await asAdmin(ctx, (api, headers) =>
      api.removeUser({ body: { userId }, headers }),
    )
  },
})

export const promote = action({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    await asAdmin(ctx, (api, headers) =>
      api.setRole({ body: { userId, role: 'admin' }, headers }),
    )
  },
})
