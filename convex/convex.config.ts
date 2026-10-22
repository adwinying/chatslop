import { defineApp } from 'convex/server'
import { v } from 'convex/values'
import betterAuth from '@/convex/betterAuth/convex.config'

const app = defineApp({
  env: {
    SITE_URL: v.string(),
    BETTER_AUTH_SECRET: v.string(),
    // Read only by seed:firstAdmin.
    ADMIN_EMAIL: v.optional(v.string()),
    ADMIN_USERNAME: v.optional(v.string()),
    ADMIN_PASSWORD: v.optional(v.string()),
    // Read only by seed:providers, on first boot.
    PROVIDER_BASE_URL: v.optional(v.string()),
    PROVIDER_API_KEY: v.optional(v.string()),
    // Any value swaps every Model for a canned mock, for e2e.
    MOCK_MODEL: v.optional(v.string()),
  },
})
app.use(betterAuth)

export default app
