import { generateText } from 'ai'
import { v } from 'convex/values'
import { internal } from '@/convex/_generated/api'
import {
  internalAction,
  internalMutation,
  internalQuery,
} from '@/convex/_generated/server'
import { modelCall } from '@/convex/llm'
import { titleModelId } from '@/convex/settings'
import { TITLE_LENGTH } from '@/convex/threads'

const TITLE_PROMPT = [
  'Write a title for a chat that starts with the message below.',
  "Use at most six words, in the message's language.",
  'Reply with the title alone: no quotes, no Markdown, no ending punctuation.',
].join('\n')

/** How much of the first Prompt the Title Model reads. */
const PROMPT_LENGTH = 2000

export const titleModel = internalQuery({
  args: {},
  handler: async (ctx) => {
    const modelId = await titleModelId(ctx)
    const model = modelId && (await ctx.db.get('models', modelId))
    const provider = model && (await ctx.db.get('providers', model.providerId))
    return model && provider ? { model, provider } : null
  },
})

/**
 * Has the Title Model title a new Thread from its first Prompt, at its lowest
 * Reasoning level and without Web search. On failure the truncated Prompt
 * stays the title.
 */
export const generate = internalAction({
  args: { threadId: v.id('threads'), prompt: v.string() },
  handler: async (ctx, { threadId, prompt }) => {
    const call = await ctx.runQuery(internal.titles.titleModel, {})
    let title: string | undefined
    if (call) {
      try {
        const { text } = await generateText({
          ...modelCall({
            ...call,
            reasoningLevel: call.model.reasoningLevels[0],
            webSearch: false,
          }),
          system: TITLE_PROMPT,
          prompt: prompt.slice(0, PROMPT_LENGTH),
        })
        title = cleanTitle(text)
      } catch (cause) {
        console.warn('The Title Model failed', cause)
      }
    }
    await ctx.runMutation(internal.titles.save, { threadId, title })
    return null
  },
})

/** Ends the pending state, writing the title only if no rename came first. */
export const save = internalMutation({
  args: { threadId: v.id('threads'), title: v.optional(v.string()) },
  handler: async (ctx, { threadId, title }) => {
    const thread = await ctx.db.get('threads', threadId)
    if (!thread?.titlePending) return
    await ctx.db.patch('threads', threadId, {
      titlePending: false,
      ...(title && { title }),
    })
  },
})

// Models still add quotes or a trailing period now and then.
function cleanTitle(text: string) {
  const line = text.trim().split('\n')[0] ?? ''
  return line
    .replace(/^["'“「#*\s]+|["'”」*.。\s]+$/g, '')
    .slice(0, TITLE_LENGTH)
}
