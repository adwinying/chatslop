import type { Doc } from '@/convex/_generated/dataModel'
import type { Provider } from '@opencode-ai/models'
import type { Infer } from 'convex/values'
import { Models } from '@opencode-ai/models'
import { v } from 'convex/values'
import { internal } from '@/convex/_generated/api'
import {
  internalAction,
  internalMutation,
  internalQuery,
} from '@/convex/_generated/server'
import schema from '@/convex/schema'

/** Enabled by the first sync; every other Model starts disabled. */
const PRESETS = [
  'gpt-6.1-sol',
  'gpt-6-astra',
  'gpt-6-luna',
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'claude-haiku-5-5',
]

const LISTED_MONTHS = 18

const synced = schema.tables.models.validator.pick(
  'modelId',
  'name',
  'family',
  'releaseDate',
  'reasoningLevels',
  'attachmentTypes',
  'contextLimit',
  'outputLimit',
)

/**
 * The Provider's text-output Models released in the last 18 months, minus
 * `gpt-image`, in our shape. Anything else never reaches the database.
 */
export function toModels(provider: Provider | undefined, now: Date) {
  const cutoff = new Date(now)
  cutoff.setMonth(cutoff.getMonth() - LISTED_MONTHS)
  const since = cutoff.toISOString().slice(0, 10)

  return Object.values(provider?.models ?? {})
    .filter(
      (model) =>
        model.modalities.output.includes('text') &&
        model.family !== 'gpt-image' &&
        // YYYY-MM or YYYY-MM-DD, so the strings compare as dates.
        model.release_date >= since,
    )
    .map((model): Infer<typeof synced> => {
      const options = model.reasoning_options ?? []
      const efforts = options.flatMap((option) =>
        option.type === 'effort' ? option.values : [],
      )
      return {
        modelId: model.id,
        name: model.name,
        family: model.family ?? '',
        releaseDate: model.release_date,
        reasoningLevels: [
          ...(options.some((option) => option.type === 'toggle')
            ? ['off']
            : []),
          ...efforts.filter((effort) => effort !== null),
        ],
        attachmentTypes: model.modalities.input.filter(
          (type) => type === 'image' || type === 'pdf',
        ),
        contextLimit: model.limit.context,
        outputLimit: model.limit.output,
      }
    })
}

/** Upserts each Provider's Models from models.dev. Runs daily and on "Sync now". */
export const sync = internalAction({
  args: {},
  handler: async (ctx) => {
    const providers: Doc<'providers'>[] = await ctx.runQuery(
      internal.modelSync.providers,
      {},
    )
    const catalog = await Models.make().providers({
      signal: AbortSignal.timeout(30_000),
    })
    const now = new Date()
    await ctx.runMutation(internal.modelSync.upsert, {
      providers: providers.map((provider) => ({
        providerId: provider._id,
        models: toModels(catalog[provider.modelsDevProviderId], now),
      })),
    })
    return null
  },
})

export const providers = internalQuery({
  args: {},
  handler: (ctx) => ctx.db.query('providers').take(100),
})

/** Never deletes: a Model gone from models.dev keeps its last-known data. */
export const upsert = internalMutation({
  args: {
    providers: v.array(
      v.object({ providerId: v.id('providers'), models: v.array(synced) }),
    ),
  },
  handler: async (ctx, args) => {
    const first = !(await ctx.db.query('models').first())
    const syncedAt = Date.now()

    for (const { providerId, models } of args.providers) {
      // Deleted while the action fetched.
      if (!(await ctx.db.get('providers', providerId))) continue
      for (const model of models) {
        const existing = await ctx.db
          .query('models')
          .withIndex('by_provider_modelId', (q) =>
            q.eq('providerId', providerId).eq('modelId', model.modelId),
          )
          .unique()
        if (existing) {
          await ctx.db.patch('models', existing._id, { ...model, syncedAt })
        } else {
          await ctx.db.insert('models', {
            providerId,
            ...model,
            enabled: first && PRESETS.includes(model.modelId),
            adminOnly: false,
            syncedAt,
          })
        }
      }
    }
  },
})
