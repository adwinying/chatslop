import type { Id } from '@/convex/_generated/dataModel'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '@/convex/_generated/api'
import { listedSince } from '@/convex/listing'
import {
  modelOf,
  setup,
  signInAdmin,
  signInUser,
  syncModels,
  type Test,
} from '@/convex/test.setup'

const KEY = 'sk-very-secret'

const providerNamed = (t: Test, name: string) =>
  t.run(async (ctx) => {
    const providers = await ctx.db.query('providers').take(10)
    return providers.find((p) => p.name === name)!
  })

/** 500 old, disabled Models that sort before the real ones by `modelId`. */
const bury = (t: Test, providerId: Id<'providers'>) =>
  t.run(async (ctx) => {
    for (let i = 0; i < 500; i++)
      await ctx.db.insert('models', {
        providerId,
        modelId: `a-${String(i).padStart(3, '0')}`,
        name: `A ${i}`,
        family: '',
        releaseDate: '2020-01-01',
        reasoningLevels: [],
        attachmentTypes: [],
        contextLimit: 0,
        outputLimit: 0,
        enabled: false,
        adminOnly: false,
        syncedAt: 0,
      })
  })

// Keeps the scheduled Answer from running on its own.
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('providers', () => {
  test('an Admin sets the base URL and key, and only internal code reads the key', async () => {
    const t = setup()
    await syncModels(t)
    const { as } = await signInAdmin(t)
    const codex = await providerNamed(t, 'Codex')

    await as.mutation(api.providers.update, {
      providerId: codex._id,
      name: 'Codex',
      baseUrl: 'http://cli-proxy-api:8317/v1',
      apiKey: KEY,
    })
    // A blank key keeps the current one.
    await as.mutation(api.providers.update, {
      providerId: codex._id,
      name: 'OpenAI',
      baseUrl: 'http://cli-proxy-api:8317/v1',
      apiKey: '',
    })

    expect(await providerNamed(t, 'OpenAI')).toMatchObject({ apiKey: KEY })
    const providers = await as.query(api.providers.list, {})
    expect(providers).toContainEqual(
      expect.objectContaining({
        name: 'OpenAI',
        baseUrl: 'http://cli-proxy-api:8317/v1',
        hasApiKey: true,
      }),
    )
    const publicResults = [
      providers,
      await as.query(api.models.list, { since: listedSince(new Date()) }),
      await as.query(api.models.options, {}),
      await as.query(api.settings.get, {}),
    ]
    expect(JSON.stringify(publicResults)).not.toContain(KEY)
  })

  test('a non-Admin can neither read nor edit them', async () => {
    const t = setup()
    await syncModels(t)
    const { as } = await signInUser(t)
    const codex = await providerNamed(t, 'Codex')

    await expect(
      as.mutation(api.providers.update, {
        providerId: codex._id,
        name: 'Codex',
        baseUrl: 'http://evil.example',
        apiKey: KEY,
      }),
    ).rejects.toThrow('Admins only')
    await expect(as.query(api.providers.list, {})).rejects.toThrow(
      'Admins only',
    )
    await expect(
      as.mutation(api.providers.remove, { providerId: codex._id }),
    ).rejects.toThrow('Admins only')
    expect(await providerNamed(t, 'Codex')).toMatchObject({ apiKey: '' })
  })

  test('deletes with its Models only while none is referenced', async () => {
    const t = setup()
    await syncModels(t)
    const { as } = await signInAdmin(t)
    const codex = await providerNamed(t, 'Codex')
    await bury(t, codex._id)
    const sol = await modelOf(t, 'gpt-6.1-sol')
    await as.mutation(api.threads.send, { text: 'Hi', modelId: sol._id })

    await expect(
      as.mutation(api.providers.remove, { providerId: codex._id }),
    ).rejects.toThrow('in use')

    const claude = await providerNamed(t, 'Claude')
    await as.mutation(api.providers.remove, { providerId: claude._id })
    const left = await t.run((ctx) => ctx.db.query('models').take(100))
    expect(left.map((m) => m.providerId)).not.toContain(claude._id)
    expect(await providerNamed(t, 'Claude')).toBeNull()
  })

  test('refuses a base URL that is not a URL, but takes a blank one', async () => {
    const t = setup()
    await syncModels(t)
    const { as } = await signInAdmin(t)
    const codex = await providerNamed(t, 'Codex')
    const update = (baseUrl: string) =>
      as.mutation(api.providers.update, {
        providerId: codex._id,
        name: 'Codex',
        baseUrl,
        apiKey: '',
      })

    await expect(update('cli-proxy-api:8317')).rejects.toThrow(
      'Enter the base URL as http(s)://…',
    )
    await update('')
  })
})

describe('models', () => {
  test('Users see enabled Models, and only Admins see Admin-only ones', async () => {
    const t = setup()
    await syncModels(t)
    const { as: user } = await signInUser(t)
    const { as: admin } = await signInAdmin(t)
    await bury(t, (await providerNamed(t, 'Codex'))._id)
    const luna = await modelOf(t, 'gpt-6-luna')
    const sol = await modelOf(t, 'gpt-6.1-sol')
    await admin.mutation(api.models.update, {
      modelId: luna._id,
      enabled: true,
      adminOnly: true,
    })
    await admin.mutation(api.models.update, {
      modelId: sol._id,
      enabled: false,
    })

    const ids = async (as: typeof user) =>
      (await as.query(api.models.options, {}))!.map((m) => m.modelId)
    expect(await ids(user)).toEqual(['claude-haiku-5-5'])
    expect((await ids(admin)).toSorted()).toEqual([
      'claude-haiku-5-5',
      'gpt-6-luna',
    ])
    await expect(
      user.query(api.models.list, { since: listedSince(new Date()) }),
    ).rejects.toThrow('Admins only')
    await expect(
      user.mutation(api.models.update, { modelId: sol._id, enabled: true }),
    ).rejects.toThrow('Admins only')
    // Nor can a User send with them.
    await expect(
      user.mutation(api.threads.send, { text: 'Hi', modelId: luna._id }),
    ).rejects.toThrow('Pick another Model')
    await expect(
      user.mutation(api.threads.send, { text: 'Hi', modelId: sol._id }),
    ).rejects.toThrow('Pick another Model')
  })

  test('the Admin list hides disabled Models past the window, except the Title Model', async () => {
    const t = setup()
    await syncModels(t)
    const { as } = await signInAdmin(t)
    await bury(t, (await providerNamed(t, 'Codex'))._id)
    const old = '2020-01-01'
    for (const modelId of ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-5.6']) {
      const model = await modelOf(t, modelId)
      await t.run((ctx) =>
        ctx.db.patch('models', model._id, { releaseDate: old }),
      )
    }
    // Enabled stays, disabled goes, and luna is the Title Model.
    const luna = await modelOf(t, 'gpt-6-luna')
    await as.mutation(api.models.update, { modelId: luna._id, enabled: false })

    const listed = await as.query(api.models.list, {
      since: listedSince(new Date()),
    })
    expect(listed.map((m) => m.modelId).toSorted()).toEqual([
      'claude-haiku-5-5',
      'gpt-5.5',
      'gpt-6-luna',
      'gpt-6.1-sol',
    ])
  })

  test('deletes a Model only while nothing references it', async () => {
    const t = setup()
    await syncModels(t)
    const { as } = await signInAdmin(t)
    const sol = await modelOf(t, 'gpt-6.1-sol')
    const luna = await modelOf(t, 'gpt-6-luna')
    const gpt56 = await modelOf(t, 'gpt-5.6')
    // The Live answer references sol.
    await as.mutation(api.threads.send, { text: 'Hi', modelId: sol._id })

    await expect(
      as.mutation(api.models.remove, { modelId: sol._id }),
    ).rejects.toThrow('in use')
    // luna is the default Title Model.
    await expect(
      as.mutation(api.models.remove, { modelId: luna._id }),
    ).rejects.toThrow('in use')

    await as.mutation(api.models.remove, { modelId: gpt56._id })
    expect(await t.run((ctx) => ctx.db.get('models', gpt56._id))).toBeNull()
  })

  test('refuses deleting a Model a finished Answer used', async () => {
    const t = setup()
    await syncModels(t)
    const { as, userId } = await signInAdmin(t)
    const gpt56 = await modelOf(t, 'gpt-5.6')
    await t.run(async (ctx) => {
      const threadId = await ctx.db.insert('threads', {
        userId,
        title: 'Old',
        titlePending: false,
        pinned: false,
        lastMessageAt: 0,
        modelId: gpt56._id,
      })
      await ctx.db.insert('messages', {
        threadId,
        userId,
        role: 'assistant',
        parts: [],
        searchText: '',
        modelId: gpt56._id,
        reasoningLevel: 'medium',
        webSearch: false,
        status: 'complete',
      })
    })

    await expect(
      as.mutation(api.models.remove, { modelId: gpt56._id }),
    ).rejects.toThrow('in use')
  })
})

describe('settings', () => {
  test('the Title Model defaults to gpt-6-luna, and an Admin changes it', async () => {
    const t = setup()
    await syncModels(t)
    const { as } = await signInAdmin(t)
    const luna = await modelOf(t, 'gpt-6-luna')
    const haiku = await modelOf(t, 'claude-haiku-5-5')

    expect(await as.query(api.settings.get, {})).toEqual({
      titleModelId: luna._id,
    })
    await as.mutation(api.settings.update, { titleModelId: haiku._id })
    expect(await as.query(api.settings.get, {})).toEqual({
      titleModelId: haiku._id,
    })
  })

  test('is for Admins only', async () => {
    const t = setup()
    await syncModels(t)
    const { as } = await signInUser(t)
    const haiku = await modelOf(t, 'claude-haiku-5-5')

    await expect(as.query(api.settings.get, {})).rejects.toThrow('Admins only')
    await expect(
      as.mutation(api.settings.update, { titleModelId: haiku._id }),
    ).rejects.toThrow('Admins only')
  })
})
