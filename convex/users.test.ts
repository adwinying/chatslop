import { expect, test } from 'vitest'
import { api } from '@/convex/_generated/api'
import {
  post,
  setup,
  signIn,
  signInAdmin,
  signInUser,
} from '@/convex/test.setup'

const password = 'alice-password-123'

test('an Admin creates a User without an email, who logs in by username', async () => {
  const t = setup()
  const { as } = await signInAdmin(t)

  await as.action(api.users.create, { username: 'alice', password })

  const res = await post(t, '/sign-in/username', {
    username: 'alice',
    password,
  })
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({
    user: { email: 'alice@users.invalid', role: 'user' },
  })
  expect(await as.query(api.users.list)).toContainEqual(
    expect.objectContaining({ username: 'alice', role: 'user', banned: false }),
  )
})

test('a disabled User is logged out and cannot log in until re-enabled', async () => {
  const t = setup()
  const { as } = await signInAdmin(t)
  await as.action(api.users.create, { username: 'alice', password })
  const alice = await signIn(t, 'alice', password)

  await as.action(api.users.disable, { userId: alice.userId })

  expect(await alice.as.query(api.users.me)).toBeNull()
  const refused = await post(t, '/sign-in/username', {
    username: 'alice',
    password,
  })
  expect(refused.status).toBe(403)
  expect(await as.query(api.users.list)).toContainEqual(
    expect.objectContaining({ username: 'alice', banned: true }),
  )

  await as.action(api.users.enable, { userId: alice.userId })

  const res = await post(t, '/sign-in/username', {
    username: 'alice',
    password,
  })
  expect(res.status).toBe(200)
})

test('resetting a password logs the User out and swaps the password', async () => {
  const t = setup()
  const { as } = await signInAdmin(t)
  await as.action(api.users.create, { username: 'alice', password })
  const alice = await signIn(t, 'alice', password)
  const newPassword = 'brand-new-password'

  await as.action(api.users.resetPassword, {
    userId: alice.userId,
    password: newPassword,
  })

  expect(await alice.as.query(api.users.me)).toBeNull()
  const old = await post(t, '/sign-in/username', {
    username: 'alice',
    password,
  })
  expect(old.status).toBe(401)
  const res = await post(t, '/sign-in/username', {
    username: 'alice',
    password: newPassword,
  })
  expect(res.status).toBe(200)
})

test('an Admin promotes a User to Admin', async () => {
  const t = setup()
  const { as } = await signInAdmin(t)
  await as.action(api.users.create, { username: 'alice', password })
  const alice = await signIn(t, 'alice', password)

  await as.action(api.users.promote, { userId: alice.userId })

  expect(await alice.as.query(api.users.me)).toMatchObject({ role: 'admin' })
  await alice.as.query(api.users.list)
})

test('a non-Admin can neither list nor manage Users', async () => {
  const t = setup()
  const admin = await signInAdmin(t)
  const user = await signInUser(t)
  const target = { userId: admin.userId }

  await expect(user.as.query(api.users.list)).rejects.toThrow('Admins only')
  for (const run of [
    () => user.as.action(api.users.create, { username: 'mallory', password }),
    () => user.as.action(api.users.disable, target),
    () => user.as.action(api.users.enable, target),
    () => user.as.action(api.users.resetPassword, { ...target, password }),
    () => user.as.action(api.users.promote, { userId: user.userId }),
  ])
    await expect(run()).rejects.toThrow('Admins only')

  expect(await user.as.query(api.users.me)).toMatchObject({ role: 'user' })
  const users = await admin.as.query(api.users.list)
  expect(users.map((u) => [u.username, u.banned])).toEqual([
    ['admin', false],
    ['user', false],
  ])
})
