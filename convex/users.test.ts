import type { Id } from '@/convex/_generated/dataModel'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '@/convex/_generated/api'
import { CASCADE_BATCH } from '@/convex/cascade'
import {
  modelOf,
  post,
  setup,
  signIn,
  signInAdmin,
  signInUser,
  syncModels,
  type Test,
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
    () => user.as.action(api.users.remove, target),
  ])
    await expect(run()).rejects.toThrow('Admins only')

  expect(await user.as.query(api.users.me)).toMatchObject({ role: 'user' })
  const users = await admin.as.query(api.users.list)
  expect(users.map((u) => [u.username, u.banned])).toEqual([
    ['admin', false],
    ['user', false],
  ])
})

/** A Thread with a Prompt, its Attachment, and a Live answer, plus an unsent Attachment and settings. */
const seedData = (t: Test, userId: string, modelId: Id<'models'>) =>
  t.run(async (ctx) => {
    const threadId = await ctx.db.insert('threads', {
      userId,
      title: 'Hello',
      titlePending: false,
      pinned: false,
      lastMessageAt: Date.now(),
      modelId,
    })
    const messageId = await ctx.db.insert('messages', {
      threadId,
      userId,
      role: 'user',
      parts: [{ type: 'text', text: 'Hi' }],
      searchText: 'Hi',
    })
    for (const linked of [messageId, undefined])
      await ctx.db.insert('attachments', {
        userId,
        messageId: linked,
        storageId: await ctx.storage.store(new Blob(['file'])),
        name: 'file.txt',
        mediaType: 'text/plain',
        size: 4,
      })
    await ctx.db.insert('liveAnswers', {
      threadId,
      userId,
      modelId,
      webSearch: false,
      parts: [],
      stopRequested: false,
      lastWriteAt: Date.now(),
    })
    await ctx.db.insert('userSettings', {
      userId,
      lastWebSearch: true,
      favoriteModelIds: [modelId],
    })
  })

/** How many rows of each kind the User owns, and blobs in all. */
const owned = (t: Test, userId: string) =>
  t.run(async (ctx) => {
    const count = async (
      table:
        | 'threads'
        | 'messages'
        | 'attachments'
        | 'liveAnswers'
        | 'userSettings',
    ) =>
      (await ctx.db.query(table).take(1000)).filter((r) => r.userId === userId)
        .length
    return {
      threads: await count('threads'),
      messages: await count('messages'),
      attachments: await count('attachments'),
      liveAnswers: await count('liveAnswers'),
      userSettings: await count('userSettings'),
      blobs: (await ctx.db.system.query('_storage').take(100)).length,
    }
  })

describe('deleting a User', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test("removes their account and every row of their data, but no one else's", async () => {
    const t = setup()
    await syncModels(t)
    const admin = await signInAdmin(t)
    await admin.as.action(api.users.create, { username: 'alice', password })
    const alice = await signIn(t, 'alice', password)
    const { _id: modelId } = await modelOf(t, 'gpt-6.1-sol')
    await seedData(t, alice.userId, modelId)
    await seedData(t, admin.userId, modelId)

    await admin.as.action(api.users.remove, { userId: alice.userId })
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    const none = {
      threads: 0,
      messages: 0,
      attachments: 0,
      liveAnswers: 0,
      userSettings: 0,
    }
    expect(await owned(t, alice.userId)).toEqual({ ...none, blobs: 2 })
    expect(await owned(t, admin.userId)).toEqual({
      threads: 1,
      messages: 1,
      attachments: 2,
      liveAnswers: 1,
      userSettings: 1,
      blobs: 2,
    })
    const users = await admin.as.query(api.users.list)
    expect(users.map((u) => u.username)).toEqual(['admin'])
    const res = await post(t, '/sign-in/username', {
      username: 'alice',
      password,
    })
    expect(res.status).toBe(401)
  })

  test('takes several batches for a User with many Threads', async () => {
    const t = setup()
    await syncModels(t)
    const admin = await signInAdmin(t)
    await admin.as.action(api.users.create, { username: 'alice', password })
    const alice = await signIn(t, 'alice', password)
    const { _id: modelId } = await modelOf(t, 'gpt-6.1-sol')
    await t.run(async (ctx) => {
      for (let i = 0; i <= CASCADE_BATCH; i++)
        await ctx.db.insert('threads', {
          userId: alice.userId,
          title: `Thread ${i}`,
          titlePending: false,
          pinned: false,
          lastMessageAt: i,
          modelId,
        })
    })

    await admin.as.action(api.users.remove, { userId: alice.userId })
    await t.finishAllScheduledFunctions(vi.runAllTimers)

    expect(await owned(t, alice.userId)).toMatchObject({ threads: 0 })
  })

  test('an Admin cannot delete themselves', async () => {
    const t = setup()
    const admin = await signInAdmin(t)

    await expect(
      admin.as.action(api.users.remove, { userId: admin.userId }),
    ).rejects.toThrow('You cannot remove yourself')
  })
})
