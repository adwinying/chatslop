import { components } from '@/convex/_generated/api'
import {
  env,
  internalAction,
  internalMutation,
} from '@/convex/_generated/server'
import { createAuth } from '@/convex/auth'
import { EFFORTS } from '@/convex/llm'

/** Creates the first Admin from env vars. Does nothing once any Admin exists. */
export const firstAdmin = internalAction({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'user',
      where: [{ field: 'role', value: 'admin' }],
    })
    if (existing) return { created: false }

    const {
      ADMIN_EMAIL: email,
      ADMIN_USERNAME: username,
      ADMIN_PASSWORD: password,
    } = env
    if (!email || !username || !password) {
      throw new Error(
        'Set ADMIN_EMAIL, ADMIN_USERNAME and ADMIN_PASSWORD before seeding',
      )
    }
    // No headers: Better Auth skips the Admin check for server-side calls.
    await createAuth(ctx).api.createUser({
      body: {
        email,
        password,
        name: username,
        role: 'admin',
        data: { username },
      },
    })
    return { created: true }
  },
})

/**
 * Creates the Codex and Claude Providers on first boot, blank until an Admin
 * sets each one's base URL and key in /admin, and one hardcoded Model until
 * Model sync lands.
 */
export const providers = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (await ctx.db.query('providers').first()) return { created: false }

    const blank = { baseUrl: '', apiKey: '' }
    const codex = await ctx.db.insert('providers', {
      name: 'Codex',
      apiFormat: 'openai-responses',
      ...blank,
      modelsDevProviderId: 'openai',
    })
    await ctx.db.insert('providers', {
      name: 'Claude',
      apiFormat: 'anthropic-messages',
      ...blank,
      modelsDevProviderId: 'anthropic',
    })
    await ctx.db.insert('models', {
      providerId: codex,
      modelId: 'gpt-6.1-sol',
      name: 'GPT-6.1 Sol',
      family: 'gpt-sol',
      releaseDate: '',
      reasoningLevels: [...EFFORTS],
      attachmentTypes: ['image', 'pdf'],
      enabled: true,
      adminOnly: false,
      syncedAt: 0,
    })
    return { created: true }
  },
})
