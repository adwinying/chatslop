import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { partsValidator as parts } from '@/convex/parts'

export const apiFormat = v.union(
  v.literal('openai-responses'),
  v.literal('anthropic-messages'),
)

export const answerStatus = v.union(
  v.literal('complete'),
  v.literal('stopped'),
  v.literal('error'),
)

export const usageValidator = v.object({
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  reasoningTokens: v.optional(v.number()),
})

export const timingValidator = v.object({
  firstTokenMs: v.optional(v.number()),
  durationMs: v.number(),
})

// User IDs are Better Auth user IDs, which live in the component.
export default defineSchema({
  userSettings: defineTable({
    userId: v.string(),
    lastModelId: v.optional(v.id('models')),
    lastReasoningLevel: v.optional(v.string()),
    lastWebSearch: v.boolean(),
    favoriteModelIds: v.array(v.id('models')),
  }).index('by_user', ['userId']),

  providers: defineTable({
    name: v.string(),
    apiFormat,
    baseUrl: v.string(),
    // Read by internal functions only.
    apiKey: v.string(),
    modelsDevProviderId: v.string(),
  }),

  models: defineTable({
    providerId: v.id('providers'),
    modelId: v.string(),
    name: v.string(),
    family: v.string(),
    releaseDate: v.string(),
    reasoningLevels: v.array(v.string()),
    attachmentTypes: v.array(v.union(v.literal('image'), v.literal('pdf'))),
    contextLimit: v.number(),
    outputLimit: v.number(),
    enabled: v.boolean(),
    adminOnly: v.boolean(),
    syncedAt: v.number(),
  })
    .index('by_provider_modelId', ['providerId', 'modelId'])
    .index('by_provider_enabled_releaseDate', [
      'providerId',
      'enabled',
      'releaseDate',
    ])
    .index('by_modelId', ['modelId']),

  // A singleton. Before an Admin saves it, the defaults in settings.ts apply.
  settings: defineTable({
    titleModelId: v.id('models'),
  }),

  threads: defineTable({
    userId: v.string(),
    title: v.string(),
    titlePending: v.boolean(),
    pinned: v.boolean(),
    lastMessageAt: v.number(),
    modelId: v.id('models'),
  })
    .index('by_user_pinned_last', ['userId', 'pinned', 'lastMessageAt'])
    .searchIndex('search_title', {
      searchField: 'title',
      filterFields: ['userId'],
    }),

  messages: defineTable(
    v.union(
      v.object({
        threadId: v.id('threads'),
        userId: v.string(),
        role: v.literal('user'),
        parts,
        searchText: v.string(),
      }),
      v.object({
        threadId: v.id('threads'),
        userId: v.string(),
        role: v.literal('assistant'),
        parts,
        searchText: v.string(),
        modelId: v.id('models'),
        reasoningLevel: v.optional(v.string()),
        webSearch: v.boolean(),
        status: answerStatus,
        error: v.optional(v.string()),
        usage: v.optional(usageValidator),
        timing: v.optional(timingValidator),
      }),
    ),
  )
    .index('by_thread', ['threadId'])
    .index('by_model', ['modelId'])
    .searchIndex('search_text', {
      searchField: 'searchText',
      filterFields: ['userId'],
    }),

  liveAnswers: defineTable({
    threadId: v.id('threads'),
    userId: v.string(),
    modelId: v.id('models'),
    reasoningLevel: v.optional(v.string()),
    webSearch: v.boolean(),
    parts,
    stopRequested: v.boolean(),
    lastWriteAt: v.number(),
  })
    .index('by_thread', ['threadId'])
    .index('by_user', ['userId'])
    .index('by_model', ['modelId']),
})
