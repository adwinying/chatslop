import type { Id } from '@/convex/_generated/dataModel'
import type { Part } from '@/convex/parts'
import type { UIMessage } from 'ai'
import type { Infer } from 'convex/values'
import {
  APICallError,
  convertToModelMessages,
  readUIMessageStream,
  streamText,
} from 'ai'
import { v } from 'convex/values'
import { internal } from '@/convex/_generated/api'
import { internalAction } from '@/convex/_generated/server'
import { contextMessages } from '@/convex/context'
import { modelCall, systemPrompt } from '@/convex/llm'
import { usageValidator } from '@/convex/schema'

const FLUSH_MS = 1000

/**
 * Streams one Answer into its Live answer, saving a snapshot about once a
 * second, single-flighted, then finishes it (ADR 0002).
 */
export const run = internalAction({
  args: { liveAnswerId: v.id('liveAnswers') },
  handler: async (ctx, { liveAnswerId }) => {
    const context = await ctx.runQuery(internal.liveAnswers.context, {
      liveAnswerId,
    })
    if (!context) return null
    const { live, model, provider, messages } = context

    const started = Date.now()
    const abort = new AbortController()
    let parts: Part[] = []
    let dirty = false
    let error: string | undefined
    let usage: Infer<typeof usageValidator> | undefined
    let firstTokenAt: number | undefined
    let contextStartMessageId: Id<'messages'> | undefined

    let saving: Promise<void> | undefined
    const save = () => {
      if (saving) return
      const snapshot = dirty ? parts : undefined
      dirty = false
      saving = ctx
        .runMutation(internal.liveAnswers.save, {
          liveAnswerId,
          parts: snapshot,
        })
        .then(
          ({ stop }) => {
            if (stop) abort.abort()
          },
          (cause: unknown) => {
            error = `Could not save the Answer: ${errorMessage(cause)}`
            abort.abort()
          },
        )
        .finally(() => (saving = undefined))
    }
    // Ticks without new parts too, so Stop and the heartbeat work while the Model is silent.
    const ticker = setInterval(save, FLUSH_MS)

    try {
      const sent = await contextMessages(
        messages,
        model,
        async ({ storageId }) => {
          const blob = await ctx.storage.get(storageId)
          return blob && new Uint8Array(await blob.arrayBuffer())
        },
      )
      if (sent.dropped) contextStartMessageId = messages[sent.dropped]!._id
      const result = streamText({
        ...modelCall({
          provider,
          model,
          reasoningLevel: live.reasoningLevel,
          webSearch: live.webSearch,
        }),
        system: systemPrompt(new Date()),
        messages: await convertToModelMessages(
          // Stored parts came from the SDK; the validator only loosened their JSON.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          sent.messages as Array<Omit<UIMessage, 'id'>>,
          // A stopped Answer may end mid Web search; replay it without the call.
          { ignoreIncompleteToolCalls: true },
        ),
        abortSignal: abort.signal,
        onFinish: ({ totalUsage }) => {
          usage = {
            inputTokens: totalUsage.inputTokens,
            outputTokens: totalUsage.outputTokens,
            reasoningTokens: totalUsage.outputTokenDetails.reasoningTokens,
          }
        },
      })
      const stream = result.toUIMessageStream({
        sendReasoning: true,
        sendSources: true,
        onError: (cause) => (error = errorMessage(cause)),
      })
      // Without terminateOnError, a dropped stream ends as if complete.
      const updates = readUIMessageStream<UIMessage>({
        stream,
        terminateOnError: true,
      })
      for await (const message of updates) {
        if (message.parts.some((part) => 'text' in part && part.text))
          firstTokenAt ??= Date.now()
        // Convex validates the shape when it's saved.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        parts = message.parts as Part[]
        dirty = true
      }
    } catch (cause) {
      error = errorMessage(cause)
    } finally {
      clearInterval(ticker)
    }
    await saving

    const timing = {
      firstTokenMs: firstTokenAt && firstTokenAt - started,
      durationMs: Date.now() - started,
    }
    try {
      await ctx.runMutation(internal.liveAnswers.finish, {
        liveAnswerId,
        parts,
        error,
        usage,
        timing,
        contextStartMessageId,
      })
    } catch (cause) {
      // Parts the validator rejects still end the Answer, with the reason.
      await ctx.runMutation(internal.liveAnswers.finish, {
        liveAnswerId,
        parts: [],
        error: `Could not save the Answer: ${errorMessage(cause)}`,
        timing,
        contextStartMessageId,
      })
    }
    return null
  },
})

/** How Providers word a request over the Model's window. */
const OVERFLOW =
  /context.length|context window|too long|too many tokens|maximum number of tokens/i

function errorMessage(cause: unknown) {
  if (
    APICallError.isInstance(cause) &&
    OVERFLOW.test(`${cause.message} ${cause.responseBody ?? ''}`)
  )
    return 'Thread too long for this Model'
  return cause instanceof Error ? cause.message : String(cause)
}
