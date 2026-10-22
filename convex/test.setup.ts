/// <reference types="vite/client" />
// Two dots, so Convex doesn't deploy this file.
import { convexTest } from 'convex-test'
import { vi } from 'vitest'
import { internal } from '@/convex/_generated/api'
import authSchema from '@/convex/betterAuth/schema'
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

export const post = (t: Test, path: string, body: object) =>
  t.fetch(`/api/auth${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
    },
    body: JSON.stringify(body),
  })

/** Seeds and signs in the Admin, returning the client acting as them. */
export async function signInAdmin(t: Test) {
  await t.action(internal.seed.firstAdmin, {})
  const signIn = await post(t, '/sign-in/username', {
    username: admin.username,
    password: admin.password,
  })
  const { token } = await signIn.json()
  const res = await t.fetch('/api/auth/get-session', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const { user, session }: { user: { id: string }; session: { id: string } } =
    await res.json()
  return {
    userId: user.id,
    as: t.withIdentity({ subject: user.id, sessionId: session.id }),
  }
}
