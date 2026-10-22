/// <reference types="vite/client" />
// Two dots, so Convex doesn't deploy this file.
import type { Model, Provider, ProviderMap } from '@opencode-ai/models'
import { convexTest } from 'convex-test'
import { vi } from 'vitest'
import { internal } from '@/convex/_generated/api'
import authSchema from '@/convex/betterAuth/schema'
import { listedSince } from '@/convex/listing'
import schema from '@/convex/schema'

export const admin = {
  email: 'admin@example.com',
  username: 'admin',
  password: 'correct-horse-battery',
}

export function setup() {
  vi.stubEnv('SITE_URL', 'http://localhost:3000')
  vi.stubEnv('CONVEX_SITE_URL', 'http://127.0.0.1:3211')
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-that-is-long-enough-1234')
  vi.stubEnv('ADMIN_EMAIL', admin.email)
  vi.stubEnv('ADMIN_USERNAME', admin.username)
  vi.stubEnv('ADMIN_PASSWORD', admin.password)

  const t = convexTest(
    schema,
    import.meta.glob(['./**/*.ts', '!./betterAuth/**']),
  )
  t.registerComponent(
    'betterAuth',
    authSchema,
    import.meta.glob('./betterAuth/**/*.ts'),
  )
  return t
}

export type Test = ReturnType<typeof setup>

export const post = (
  t: Test,
  path: string,
  body: object,
  headers: Record<string, string> = {},
) =>
  t.fetch(`/api/auth${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
      ...headers,
    },
    body: JSON.stringify(body),
  })

async function signIn(t: Test, username: string, password: string) {
  const res = await post(t, '/sign-in/username', { username, password })
  const { token }: { token: string } = await res.json()
  const sessionRes = await t.fetch('/api/auth/get-session', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const { user, session }: { user: { id: string }; session: { id: string } } =
    await sessionRes.json()
  return {
    token,
    userId: user.id,
    as: t.withIdentity({ subject: user.id, sessionId: session.id }),
  }
}

/** Seeds and signs in the Admin, returning the client acting as them. */
export async function signInAdmin(t: Test) {
  await t.action(internal.seed.firstAdmin, {})
  return await signIn(t, admin.username, admin.password)
}

/** Has the Admin create a plain User, then signs them in. */
export async function signInUser(t: Test) {
  const { token } = await signInAdmin(t)
  await post(
    t,
    '/admin/create-user',
    {
      email: 'user@example.com',
      password: admin.password,
      name: 'user',
      role: 'user',
      data: { username: 'user' },
    },
    { Authorization: `Bearer ${token}` },
  )
  return await signIn(t, 'user', admin.password)
}

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

export const catalogModel = (
  id: string,
  fields: Partial<Model> = {},
): Model => ({
  id,
  name: id,
  description: '',
  family: 'gpt-sol',
  attachment: true,
  reasoning: true,
  reasoning_options: [{ type: 'effort', values: ['low', 'medium', 'high'] }],
  tool_call: true,
  release_date: daysAgo(30),
  last_updated: daysAgo(30),
  modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
  open_weights: false,
  limit: { context: 400_000, output: 128_000 },
  ...fields,
})

const catalogProvider = (id: string, models: Model[]): Provider => ({
  id,
  env: [],
  npm: '',
  name: id,
  doc: '',
  models: Object.fromEntries(models.map((model) => [model.id, model])),
})

/** A slice of models.dev's `api.json`, with one Model per filter rule. */
export const catalog = {
  openai: catalogProvider('openai', [
    catalogModel('gpt-6.1-sol', { name: 'GPT-6.1 Sol' }),
    catalogModel('gpt-6-luna', { family: 'gpt-luna' }),
    catalogModel('gpt-5.6'),
    // Month-only, in the window's first month.
    catalogModel('gpt-5.5', {
      release_date: listedSince(new Date()).slice(0, 7),
    }),
    catalogModel('gpt-image-2', { family: 'gpt-image' }),
    catalogModel('gpt-4o', { release_date: daysAgo(600) }),
    catalogModel('tts-2', {
      modalities: { input: ['text'], output: ['audio'] },
    }),
  ]),
  anthropic: catalogProvider('anthropic', [
    catalogModel('claude-haiku-5-5', {
      family: 'claude-haiku',
      reasoning_options: [
        { type: 'toggle' },
        { type: 'effort', values: [null, 'low', 'max'] },
      ],
      modalities: { input: ['text', 'image'], output: ['text'] },
      limit: { context: 200_000, output: 64_000 },
    }),
  ]),
  google: catalogProvider('google', [catalogModel('gemini-4-pro')]),
} satisfies ProviderMap

/** Seeds the Providers and syncs Models from a stubbed models.dev. */
export async function syncModels(t: Test, providers: ProviderMap = catalog) {
  await t.mutation(internal.seed.providers, {})
  vi.stubGlobal('fetch', async () => Response.json(providers))
  try {
    await t.action(internal.modelSync.sync, {})
  } finally {
    vi.unstubAllGlobals()
  }
}

/** The synced Model with this API ID. */
export const modelOf = (t: Test, modelId: string) =>
  t.run(async (ctx) => {
    const model = await ctx.db
      .query('models')
      .withIndex('by_modelId', (q) => q.eq('modelId', modelId))
      .first()
    if (!model) throw new Error(`No Model ${modelId}`)
    return model
  })
