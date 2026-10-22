import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '@/convex/_generated/api'
import {
  catalog,
  modelOf,
  setup,
  signInAdmin,
  signInUser,
  syncModels,
  type Test,
} from '@/convex/test.setup'

// Keeps the sync that seeding schedules from reaching the real models.dev.
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const modelIds = (t: Test) =>
  t.run(async (ctx) =>
    (await ctx.db.query('models').take(100)).map((m) => m.modelId).toSorted(),
  )

describe('modelSync.sync', () => {
  test('stores the listed Models and enables the presets on the first sync', async () => {
    const t = setup()
    await syncModels(t)

    // Not image, old, audio-only, or from a Provider nobody set up.
    expect(await modelIds(t)).toEqual([
      'claude-haiku-5-5',
      'gpt-5.6',
      'gpt-6-luna',
      'gpt-6.1-sol',
    ])
    expect(await modelOf(t, 'gpt-6.1-sol')).toMatchObject({
      name: 'GPT-6.1 Sol',
      family: 'gpt-sol',
      reasoningLevels: ['low', 'medium', 'high'],
      attachmentTypes: ['image', 'pdf'],
      contextLimit: 400_000,
      outputLimit: 128_000,
      enabled: true,
      adminOnly: false,
    })
    expect(await modelOf(t, 'claude-haiku-5-5')).toMatchObject({
      reasoningLevels: ['off', 'low', 'max'],
      attachmentTypes: ['image'],
      enabled: true,
    })
    expect(await modelOf(t, 'gpt-5.6')).toMatchObject({ enabled: false })
  })

  test('updates in place, keeps Admin choices, and never deletes', async () => {
    const t = setup()
    await syncModels(t)
    const { as } = await signInAdmin(t)
    const sol = await modelOf(t, 'gpt-6.1-sol')
    await as.mutation(api.models.update, {
      modelId: sol._id,
      enabled: false,
      adminOnly: true,
    })

    const { 'gpt-6-luna': _, ...rest } = catalog.openai.models
    await syncModels(t, {
      ...catalog,
      openai: {
        ...catalog.openai,
        models: {
          ...rest,
          'gpt-6.1-sol': { ...rest['gpt-6.1-sol'], name: 'GPT-6.1 Sol (new)' },
          'gpt-6-astra': { ...rest['gpt-6.1-sol'], id: 'gpt-6-astra' },
        },
      },
    })

    expect(await modelIds(t)).toEqual([
      'claude-haiku-5-5',
      'gpt-5.6',
      'gpt-6-astra',
      'gpt-6-luna',
      'gpt-6.1-sol',
    ])
    expect(await modelOf(t, 'gpt-6.1-sol')).toMatchObject({
      _id: sol._id,
      name: 'GPT-6.1 Sol (new)',
      enabled: false,
      adminOnly: true,
    })
    // Presets are enabled by the first sync only.
    expect(await modelOf(t, 'gpt-6-astra')).toMatchObject({ enabled: false })
  })
})

describe('models.syncNow', () => {
  test('is for Admins only', async () => {
    const t = setup()
    const { as } = await signInUser(t)

    await expect(as.mutation(api.models.syncNow, {})).rejects.toThrow(
      'Admins only',
    )
  })
})
