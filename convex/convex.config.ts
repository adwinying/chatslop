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
  },
})
app.use(betterAuth)

export default app
