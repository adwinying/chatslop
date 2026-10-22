import { convexTest } from 'convex-test'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { api, internal } from '@/convex/_generated/api'
import authSchema from '@/convex/betterAuth/schema'

const admin = {
  email: 'admin@example.com',
  username: 'admin',
  password: 'correct-horse-battery',
}

function setup() {
  const t = convexTest(
    undefined,
    import.meta.glob(['./**/*.ts', '!./betterAuth/**']),
  )
  t.registerComponent(
    'betterAuth',
    authSchema,
    import.meta.glob('./betterAuth/**/*.ts'),
  )
  return t
}

const post = (t: ReturnType<typeof setup>, path: string, body: object) =>
  t.fetch(`/api/auth${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:3000',
    },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.stubEnv('SITE_URL', 'http://localhost:3000')
  vi.stubEnv('CONVEX_SITE_URL', 'http://127.0.0.1:3211')
  vi.stubEnv('BETTER_AUTH_SECRET', 'test-secret-that-is-long-enough-1234')
  vi.stubEnv('ADMIN_EMAIL', admin.email)
  vi.stubEnv('ADMIN_USERNAME', admin.username)
  vi.stubEnv('ADMIN_PASSWORD', admin.password)
})

describe('seed:firstAdmin', () => {
  test('creates an Admin who can sign in by username', async () => {
    const t = setup()
    await t.action(internal.seed.firstAdmin, {})

    const res = await post(t, '/sign-in/username', {
      username: admin.username,
      password: admin.password,
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      user: { email: admin.email, role: 'admin' },
    })
  })

  test('does nothing once an Admin exists', async () => {
    const t = setup()
    await t.action(internal.seed.firstAdmin, {})
    vi.stubEnv('ADMIN_EMAIL', 'other@example.com')
    vi.stubEnv('ADMIN_USERNAME', 'other')
    await t.action(internal.seed.firstAdmin, {})

    const res = await post(t, '/sign-in/username', {
      username: 'other',
      password: admin.password,
    })

    expect(res.status).toBe(401)
  })
})

test('public signup is rejected', async () => {
  const t = setup()

  const res = await post(t, '/sign-up/email', {
    email: 'intruder@example.com',
    password: 'intruder-password',
    name: 'Intruder',
  })

  expect(res.status).toBe(400)
  expect(await res.json()).toMatchObject({
    code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED',
  })
})

describe('users.me', () => {
  test('returns the signed-in User with their role', async () => {
    const t = setup()
    await t.action(internal.seed.firstAdmin, {})
    const signIn = await post(t, '/sign-in/username', {
      username: admin.username,
      password: admin.password,
    })
    const { token } = await signIn.json()
    const session = await t.fetch('/api/auth/get-session', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const { user, session: row } = await session.json()

    const me = await t
      .withIdentity({ subject: user.id, sessionId: row.id })
      .query(api.users.me)

    expect(me).toEqual({
      name: admin.username,
      username: admin.username,
      role: 'admin',
    })
  })

  test('returns null for a signed-out caller', async () => {
    const t = setup()

    expect(await t.query(api.users.me)).toBeNull()
  })
})
