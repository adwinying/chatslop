import { createClient, type GenericCtx } from "@convex-dev/better-auth"
import { convex } from "@convex-dev/better-auth/plugins"
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal"
import { admin } from "better-auth/plugins/admin"
import { username } from "better-auth/plugins/username"
import { components } from "./_generated/api"
import type { DataModel } from "./_generated/dataModel"
import { env } from "./_generated/server"
import authConfig from "./auth.config"
import authSchema from "./betterAuth/schema"

export const authComponent = createClient<DataModel, typeof authSchema>(
  components.betterAuth,
  {
    local: { schema: authSchema },
  },
)

export const createAuthOptions = (ctx: GenericCtx<DataModel>) =>
  ({
    baseURL: env.SITE_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: authComponent.adapter(ctx),
    // Admins create every account; there is no self-signup.
    emailAndPassword: { enabled: true, disableSignUp: true },
    plugins: [username(), admin(), convex({ authConfig })],
  }) satisfies BetterAuthOptions

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx))
