import type { DataModel } from '@/convex/_generated/dataModel'
import {
  createClient,
  type AuthFunctions,
  type GenericCtx,
} from '@convex-dev/better-auth'
import { convex } from '@convex-dev/better-auth/plugins'
import { betterAuth, type BetterAuthOptions } from 'better-auth/minimal'
import { admin } from 'better-auth/plugins/admin'
import { username } from 'better-auth/plugins/username'
import { components, internal } from '@/convex/_generated/api'
import { env } from '@/convex/_generated/server'
import authConfig from '@/convex/auth.config'
import authSchema from '@/convex/betterAuth/schema'

// Annotated, or `internal` and this file's types would depend on each other.
const authFunctions: AuthFunctions = internal.auth

export const authComponent = createClient<DataModel, typeof authSchema>(
  components.betterAuth,
  {
    local: { schema: authSchema },
    authFunctions,
    triggers: {
      user: {
        // Runs in the user row's delete, but Better Auth deletes sessions,
        // accounts and the user in separate transactions, and the data
        // goes in scheduled batches after.
        onDelete: async (ctx, user) => {
          await ctx.scheduler.runAfter(0, internal.cascade.deleteUser, {
            userId: user._id,
          })
        },
      },
    },
  },
)

export const { onDelete } = authComponent.triggersApi()

export const createAuthOptions = (ctx: GenericCtx<DataModel>) =>
  ({
    baseURL: env.SITE_URL,
    // Other origins the app is served on, e.g. the LAN address in dev.
    trustedOrigins: env.TRUSTED_ORIGINS?.split(',') ?? [],
    secret: env.BETTER_AUTH_SECRET,
    database: authComponent.adapter(ctx),
    // Admins create every account; there is no self-signup.
    emailAndPassword: { enabled: true, disableSignUp: true },
    plugins: [username(), admin(), convex({ authConfig })],
  }) satisfies BetterAuthOptions

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx))
