import type { Doc, Id } from '@/convex/_generated/dataModel'
import type { QueryCtx } from '@/convex/_generated/server'
import { ConvexError, v } from 'convex/values'
import { internal } from '@/convex/_generated/api'
import { mutation, query } from '@/convex/_generated/server'
import { authComponent } from '@/convex/auth'
import { releasedSince } from '@/convex/listing'
import { titleModelId } from '@/convex/settings'
import { ownThread } from '@/convex/threads'
import { requireAdmin } from '@/convex/users'
import { settingsOf } from '@/convex/userSettings'

/** Per Provider in creation order, the Models `select` picks. */
async function byProvider(
  ctx: QueryCtx,
  select: (providerId: Id<'providers'>) => Promise<Doc<'models'>[]>,
) {
  const providers = await ctx.db.query('providers').take(100)
  const perProvider = await Promise.all(providers.map((p) => select(p._id)))
  return perProvider.flat()
}

/** Enforced by `update`, so reading this many enabled Models reads them all. */
const MAX_ENABLED = 100
/**
 * A product limit on the disabled Models one 18-month window lists per
 * Provider. models.dev releases far fewer.
 */
const MAX_LISTED_DISABLED = 500

/** A Provider's enabled or disabled Models released from `from`, newest first. */
const modelsOf = (
  ctx: QueryCtx,
  providerId: Id<'providers'>,
  enabled: boolean,
  from = '',
) =>
  ctx.db
    .query('models')
    .withIndex('by_provider_enabled_releaseDate', (q) =>
      q
        .eq('providerId', providerId)
        .eq('enabled', enabled)
        .gte('releaseDate', from),
    )
    .order('desc')
    .take(enabled ? MAX_ENABLED : MAX_LISTED_DISABLED)

/** Whether a Message, a Live answer or the Title Model setting points at the Model. */
export async function inUse(ctx: QueryCtx, modelId: Id<'models'>) {
  const message = await ctx.db
    .query('messages')
    .withIndex('by_model', (q) => q.eq('modelId', modelId))
    .first()
  const live = await ctx.db
    .query('liveAnswers')
    .withIndex('by_model', (q) => q.eq('modelId', modelId))
    .first()
  return !!message || !!live || (await titleModelId(ctx)) === modelId
}

/** Enabled, and Admin-only only for Admins. */
const canUse = (model: Doc<'models'>, isAdmin: boolean) =>
  model.enabled && (!model.adminOnly || isAdmin)

/** The Model, if this User may send with it. */
export async function usableModel(
  ctx: QueryCtx,
  modelId: Id<'models'>,
  isAdmin: boolean,
) {
  const model = await ctx.db.get('models', modelId)
  if (!model || !canUse(model, isAdmin))
    throw new ConvexError('Pick another Model')
  return model
}

/** Picker order within a Provider, by models.dev family. Unranked families go last. */
const FAMILY_RANK = [
  'claude-fable',
  'claude-opus',
  'claude-sonnet',
  'claude-haiku',
  'gpt-astra',
  'gpt-sol',
  'gpt-terra',
  'gpt-luna',
  'gpt-pro',
  'gpt-codex',
  'gpt-mini',
]

const rank = ({ family }: Doc<'models'>) => {
  const index = FAMILY_RANK.indexOf(family)
  return index === -1 ? FAMILY_RANK.length : index
}

/**
 * What the composer offers the signed-in User: the Models they can pick, in
 * order, their Favorites, and the remembered choices. The default Model is
 * the Thread's, else the last sent with, else the first, skipping any no
 * longer usable. Null while signed out.
 */
export const options = query({
  args: { threadId: v.optional(v.id('threads')) },
  handler: async (ctx, { threadId }) => {
    const user = await authComponent.safeGetAuthUser(ctx)
    if (!user) return null
    const thread = threadId && (await ownThread(ctx, threadId, user._id))
    const settings = await settingsOf(ctx, user._id)
    const providers = await ctx.db.query('providers').take(100)
    const perProvider = await Promise.all(
      providers.map(async (provider) =>
        // Newest first, so the stable sort keeps that within a family.
        (await modelsOf(ctx, provider._id, true))
          .filter((m) => canUse(m, user.role === 'admin'))
          .toSorted((a, b) => rank(a) - rank(b)),
      ),
    )
    const models = perProvider.flat()
    const usable = (id: Id<'models'> | undefined) =>
      models.some((m) => m._id === id)

    return {
      // Only Providers with a Model to pick get a tab.
      providers: providers
        .filter((_, i) => perProvider[i]!.length > 0)
        .map(({ _id, name, apiFormat }) => ({ _id, name, apiFormat })),
      models: models.map(
        ({ _id, providerId, name, reasoningLevels, adminOnly }) => ({
          _id,
          providerId,
          name,
          reasoningLevels,
          adminOnly,
        }),
      ),
      favoriteIds: settings.favoriteModelIds.filter(usable),
      modelId:
        [thread?.modelId, settings.lastModelId].find(usable) ??
        models[0]?._id ??
        null,
      reasoningLevel: settings.lastReasoningLevel,
      webSearch: settings.lastWebSearch,
    }
  },
})

/**
 * The Admin list: Models released since `since` (from `listedSince`), plus
 * older ones still enabled or writing titles, so they stay manageable.
 */
export const list = query({
  args: { since: v.string() },
  handler: async (ctx, { since }) => {
    await requireAdmin(ctx)
    const titleId = await titleModelId(ctx)
    const title = titleId && (await ctx.db.get('models', titleId))
    return byProvider(ctx, async (providerId) => {
      const [enabled, disabled] = await Promise.all([
        modelsOf(ctx, providerId, true),
        // The month prefix keeps month-only dates; `releasedSince` trims the rest.
        modelsOf(ctx, providerId, false, since.slice(0, 7)),
      ])
      const models = [
        ...enabled,
        ...disabled.filter((m) => releasedSince(m.releaseDate, since)),
      ]
      if (
        title?.providerId === providerId &&
        !models.some((m) => m._id === title._id)
      )
        models.push(title)
      return models.toSorted((a, b) =>
        b.releaseDate.localeCompare(a.releaseDate),
      )
    })
  },
})

export const update = mutation({
  args: {
    modelId: v.id('models'),
    enabled: v.optional(v.boolean()),
    adminOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, { modelId, ...fields }) => {
    await requireAdmin(ctx)
    const model = await ctx.db.get('models', modelId)
    if (!model) throw new ConvexError('That Model no longer exists')
    if (fields.enabled && !model.enabled) {
      const enabled = await modelsOf(ctx, model.providerId, true)
      if (enabled.length >= MAX_ENABLED)
        throw new ConvexError(
          `A Provider has at most ${MAX_ENABLED} enabled Models. Disable one first.`,
        )
    }
    await ctx.db.patch('models', modelId, fields)
  },
})

export const remove = mutation({
  args: { modelId: v.id('models') },
  handler: async (ctx, { modelId }) => {
    await requireAdmin(ctx)
    if (await inUse(ctx, modelId))
      throw new ConvexError('The Model is in use, so it stays')
    await ctx.db.delete('models', modelId)
  },
})

export const syncNow = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx)
    await ctx.scheduler.runAfter(0, internal.modelSync.sync, {})
  },
})
