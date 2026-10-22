import { describe, expect, test, vi } from 'vitest'
import { api, internal } from '@/convex/_generated/api'
import { admin, post, setup, signInAdmin } from '@/convex/test.setup'

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
    const { as } = await signInAdmin(t)

    expect(await as.query(api.users.me)).toEqual({
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
