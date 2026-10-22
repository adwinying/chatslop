import type { Doc } from '@/convex/_generated/dataModel'
import type { AnthropicProviderOptions } from '@ai-sdk/anthropic'
import type { OpenAIResponsesProviderOptions } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { simulateReadableStream, type streamText } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { env } from '@/convex/_generated/server'

type Call = Pick<
  Parameters<typeof streamText>[0],
  'model' | 'tools' | 'providerOptions'
>

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/** The streamText settings for one Answer, with the flags #12 verified on CLIProxyAPI. */
export function modelCall({
  provider,
  model,
  reasoningLevel,
  webSearch,
}: {
  provider: Doc<'providers'>
  model: Doc<'models'>
  reasoningLevel: string
  webSearch: boolean
}): Call {
  if (env.MOCK_MODEL) return { model: mockModel() }
  const settings = { baseURL: provider.baseUrl, apiKey: provider.apiKey }
  // A level outside the SDK's list goes unsent, so the Provider default applies.
  const effort = EFFORTS.find((level) => level === reasoningLevel)

  if (provider.apiFormat === 'openai-responses') {
    const openai = createOpenAI(settings)
    return {
      model: openai.responses(model.modelId),
      // CLIProxyAPI never lets upstream store items, so replay them in full.
      providerOptions: {
        openai: {
          store: false,
          reasoningEffort: effort,
        } satisfies OpenAIResponsesProviderOptions,
      },
      tools: webSearch ? { web_search: openai.tools.webSearch() } : undefined,
    }
  }

  const anthropic = createAnthropic(settings)
  return {
    model: anthropic(model.modelId),
    // Without `display`, CLIProxyAPI streams no thinking text.
    providerOptions: {
      anthropic: {
        thinking: { type: 'adaptive', display: 'summarized' },
        effort,
      } satisfies AnthropicProviderOptions,
    },
    // _20260318 fails on CLIProxyAPI with too_many_requests.
    tools: webSearch
      ? { web_search: anthropic.tools.webSearch_20250305() }
      : undefined,
  }
}

export function systemPrompt(now: Date) {
  return [
    'You are chatslop, a helpful assistant.',
    `The current date is ${now.toISOString().slice(0, 10)}.`,
    'Format answers in Markdown. Put code in fenced blocks tagged with their language.',
    'Write math in LaTeX, with $...$ inline and $$...$$ for display.',
  ].join('\n')
}

export const MOCK_CHUNK_MS = 100

// Markdown, code, math and Japanese, for Streamdown's plugins.
const MOCK_INTRO = [
  '**Mock Answer:** ',
  '日本語も表示できます。\n\n',
  '```ts\nconst answer = 42\n```\n\n',
  '$$E = mc^2$$\n\n',
]

/**
 * Streams canned reasoning, a source and a long text, slowly enough for e2e
 * to reload and stop mid-Answer. Enabled by the MOCK_MODEL env var.
 */
function mockModel() {
  const words = Array.from({ length: 200 }, (_, i) => ` word${i + 1}`)
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunkDelayInMs: MOCK_CHUNK_MS,
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'reasoning-start', id: 'r' },
          ...['Thinking ', 'about ', 'the ', 'Prompt.'].map((delta) => ({
            type: 'reasoning-delta' as const,
            id: 'r',
            delta,
          })),
          { type: 'reasoning-end', id: 'r' },
          {
            type: 'source',
            sourceType: 'url',
            id: 's',
            url: 'https://example.com/mock',
            title: 'Example',
          },
          { type: 'text-start', id: 't' },
          ...MOCK_INTRO.map((delta) => ({
            type: 'text-delta' as const,
            id: 't',
            delta,
          })),
          ...words.map((delta) => ({
            type: 'text-delta' as const,
            id: 't',
            delta,
          })),
          { type: 'text-end', id: 't' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage: {
              inputTokens: {
                total: 10,
                noCache: 10,
                cacheRead: undefined,
                cacheWrite: undefined,
              },
              outputTokens: { total: 200, text: 196, reasoning: 4 },
            },
          },
        ],
      }),
    }),
  })
}
