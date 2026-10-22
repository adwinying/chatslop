import { components } from "./_generated/api"
import { env, internalAction } from "./_generated/server"
import { createAuth } from "./auth"

/** Creates the first Admin from env vars. Does nothing once any Admin exists. */
export const firstAdmin = internalAction({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "role", value: "admin" }],
    })
    if (existing) return { created: false }

    const {
      ADMIN_EMAIL: email,
      ADMIN_USERNAME: username,
      ADMIN_PASSWORD: password,
    } = env
    if (!email || !username || !password) {
      throw new Error(
        "Set ADMIN_EMAIL, ADMIN_USERNAME and ADMIN_PASSWORD before seeding",
      )
    }
    // No headers: Better Auth skips the Admin check for server-side calls.
    await createAuth(ctx).api.createUser({
      body: {
        email,
        password,
        name: username,
        role: "admin",
        data: { username },
      },
    })
    return { created: true }
  },
})
