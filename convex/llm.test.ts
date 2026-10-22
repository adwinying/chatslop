import type { Doc } from '@/convex/_generated/dataModel'
import { describe, expect, test } from 'vitest'
import { modelCall } from '@/convex/llm'

const call = (
  apiFormat: Doc<'providers'>['apiFormat'],
  reasoningLevel?: string,
) =>
  modelCall({
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only these fields matter
    provider: {
      apiFormat,
      baseUrl: 'http://proxy/v1',
      apiKey: 'k',
    } as Doc<'providers'>,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only these fields matter
    model: { modelId: 'm' } as Doc<'models'>,
    reasoningLevel,
    webSearch: false,
  }).providerOptions

describe('modelCall', () => {
  test('turns thinking off for an Anthropic Model', () => {
    expect(call('anthropic-messages', 'off')).toEqual({
      anthropic: { thinking: { type: 'disabled' } },
    })
    expect(call('anthropic-messages', 'high')).toMatchObject({
      anthropic: { thinking: { type: 'adaptive' }, effort: 'high' },
    })
  })

  test('sends every OpenAI effort, with off as none', () => {
    expect(call('openai-responses', 'none')).toMatchObject({
      openai: { reasoningEffort: 'none' },
    })
    expect(call('openai-responses', 'minimal')).toMatchObject({
      openai: { reasoningEffort: 'minimal' },
    })
    expect(call('openai-responses', 'off')).toMatchObject({
      openai: { reasoningEffort: 'none' },
    })
  })
})
