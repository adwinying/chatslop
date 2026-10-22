import type { Id } from '@/convex/_generated/dataModel'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { api } from '@/convex/_generated/api'
import { listedSince } from '@/convex/listing'
import { reasoningLevelFor } from '@/convex/reasoning'
import {
  catalog,
  catalogModel,
  modelOf,
  setup,
  signInAdmin,
  signInUser,
  syncModels,
  type Test,
} from '@/convex/test.setup'

type As = Awaited<ReturnType<typeof signInAdmin>>['as']

const optionsOf = async (as: As, threadId?: Id<'threads'>) =>
  (await as.query(api.models.options, { threadId }))!

const defaultModel = async (t: Test, as: As, threadId?: Id<'threads'>) => {
  const { modelId } = await optionsOf(as, threadId)
  return modelId && (await t.run((ctx) => ctx.db.get('models', modelId)))
}

const sendWith = async (
  t: Test,
  as: As,
  model: string,
  { reasoningLevel = 'medium', webSearch = true } = {},
) =>
  as.mutation(api.threads.send, {
    text: 'Hi',
    modelId: (await modelOf(t, model))._id,
    reasoningLevel,
    webSearch,
  })

// Keeps scheduled Answers from running.
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('reasoningLevelFor', () => {
  test('keeps the remembered level, else medium, else the lowest', () => {
    expect(reasoningLevelFor(['low', 'medium', 'high'], 'high')).toBe('high')
    expect(reasoningLevelFor(['low', 'medium', 'high'], 'max')).toBe('medium')
    expect(reasoningLevelFor(['low', 'medium', 'high'])).toBe('medium')
    expect(reasoningLevelFor(['off', 'low', 'max'], 'high')).toBe('off')
    expect(reasoningLevelFor([], 'high')).toBeUndefined()
  })
})

describe('models.options', () => {
  test('orders Models by Provider, then family rank, then newest first', async () => {
    const t = setup()
    await syncModels(t, {
      ...catalog,
      openai: {
        ...catalog.openai,
        models: {
          ...catalog.openai.models,
          'gpt-6-astra': catalogModel('gpt-6-astra', {
            family: 'gpt-astra',
            release_date: listedSince(new Date()),
          }),
          'gpt-daybreak': catalogModel('gpt-daybreak', { family: 'gpt' }),
        },
      },
    })
    const { as } = await signInAdmin(t)
    const daybreak = await modelOf(t, 'gpt-daybreak')
    await as.mutation(api.models.update, {
      modelId: daybreak._id,
      enabled: true,
    })

    const { models } = await optionsOf(as)
    expect(models.map((m) => m.name)).toEqual([
      'gpt-6-astra',
      'GPT-6.1 Sol',
      'gpt-6-luna',
      'gpt-daybreak',
      'claude-haiku-5-5',
    ])
  })

  test("defaults to the Thread's Model, then the last one, then the first", async () => {
    const t = setup()
    await syncModels(t)
    const { as } = await signInAdmin(t)

    expect(await optionsOf(as)).not.toHaveProperty('reasoningLevel')
    expect(await optionsOf(as)).toMatchObject({ webSearch: true })
    expect(await defaultModel(t, as)).toMatchObject({ modelId: 'gpt-6.1-sol' })

    const haikuThread = await sendWith(t, as, 'claude-haiku-5-5', {
      reasoningLevel: 'max',
      webSearch: false,
    })
    expect(await optionsOf(as)).toMatchObject({
      reasoningLevel: 'max',
      webSearch: false,
    })
    expect(await defaultModel(t, as)).toMatchObject({
      modelId: 'claude-haiku-5-5',
    })

    await sendWith(t, as, 'gpt-6-luna')
    expect(await defaultModel(t, as)).toMatchObject({ modelId: 'gpt-6-luna' })
    expect(await defaultModel(t, as, haikuThread)).toMatchObject({
      modelId: 'claude-haiku-5-5',
    })
  })

  test('falls back past stale and Admin-only Models', async () => {
    const t = setup()
    await syncModels(t)
    const { as: user } = await signInUser(t)
    const { as: admin } = await signInAdmin(t)
    const haikuThread = await sendWith(t, user, 'claude-haiku-5-5')
    const haiku = await modelOf(t, 'claude-haiku-5-5')
    const sol = await modelOf(t, 'gpt-6.1-sol')

    await admin.mutation(api.models.update, {
      modelId: haiku._id,
      enabled: false,
    })
    await admin.mutation(api.models.update, {
      modelId: sol._id,
      adminOnly: true,
    })

    expect(await defaultModel(t, user, haikuThread)).toMatchObject({
      modelId: 'gpt-6-luna',
    })
    expect(await defaultModel(t, admin)).toMatchObject({
      modelId: 'gpt-6.1-sol',
    })
  })
})

describe('threads.send', () => {
  test('writes the choices onto the Answer, resolving an unsupported level', async () => {
    const t = setup()
    await syncModels(t)
    const { as } = await signInAdmin(t)

    const threadId = await sendWith(t, as, 'claude-haiku-5-5', {
      reasoningLevel: 'high',
      webSearch: false,
    })

    const live = await t.run((ctx) =>
      ctx.db
        .query('liveAnswers')
        .withIndex('by_thread', (q) => q.eq('threadId', threadId))
        .unique(),
    )
    expect(live).toMatchObject({ reasoningLevel: 'off', webSearch: false })
  })
})

describe('userSettings.toggleFavorite', () => {
  test('stars in order, unstars, and hides stale Favorites', async () => {
    const t = setup()
    await syncModels(t)
    const { as: user } = await signInUser(t)
    const { as: admin } = await signInAdmin(t)
    const [haiku, luna, sol] = await Promise.all(
      ['claude-haiku-5-5', 'gpt-6-luna', 'gpt-6.1-sol'].map((id) =>
        modelOf(t, id),
      ),
    )

    for (const model of [haiku, luna, sol])
      await user.mutation(api.userSettings.toggleFavorite, {
        modelId: model!._id,
      })
    await user.mutation(api.userSettings.toggleFavorite, {
      modelId: haiku!._id,
    })
    expect((await optionsOf(user)).favoriteIds).toEqual([luna!._id, sol!._id])

    await admin.mutation(api.models.update, {
      modelId: luna!._id,
      adminOnly: true,
    })
    expect((await optionsOf(user)).favoriteIds).toEqual([sol!._id])
    // Unstarring still works; starring again doesn't.
    await user.mutation(api.userSettings.toggleFavorite, { modelId: luna!._id })
    await expect(
      user.mutation(api.userSettings.toggleFavorite, { modelId: luna!._id }),
    ).rejects.toThrow('Pick another Model')
  })
})
