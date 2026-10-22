import type { Infer, Validator } from 'convex/values'
import { v } from 'convex/values'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

const scalar = v.union(v.null(), v.boolean(), v.number(), v.string())

/** Convex validators can't recurse, so JSON is unrolled `depth` levels deep. */
function json(depth: number): Validator<Json, 'required', string> {
  if (depth === 0) return scalar
  const inner = json(depth - 1)
  return v.union(scalar, v.array(inner), v.record(v.string(), inner))
}

// Every part sits two levels into `parts` (array, part), so nothing below
// nests deeper than 8 (#12 measured 7 for Codex and 8 for Claude).
const providerMetadata = v.optional(v.record(v.string(), json(5)))

const toolState = v.union(
  v.literal('input-streaming'),
  v.literal('input-available'),
  v.literal('output-available'),
  v.literal('output-error'),
)

/** Mirrors the AI SDK `UIMessage` parts an Answer can hold: no files, one tool. */
export const part = v.union(
  v.object({
    type: v.literal('text'),
    text: v.string(),
    state: v.optional(v.union(v.literal('streaming'), v.literal('done'))),
    citations: v.optional(v.array(json(5))),
    providerMetadata,
  }),
  v.object({
    type: v.literal('reasoning'),
    id: v.optional(v.string()),
    text: v.string(),
    state: v.optional(v.union(v.literal('streaming'), v.literal('done'))),
    providerMetadata,
  }),
  v.object({
    type: v.literal('source-url'),
    sourceId: v.string(),
    url: v.string(),
    title: v.optional(v.string()),
    providerMetadata,
  }),
  v.object({
    type: v.literal('source-document'),
    sourceId: v.string(),
    mediaType: v.string(),
    title: v.string(),
    filename: v.optional(v.string()),
    providerMetadata,
  }),
  v.object({ type: v.literal('step-start') }),
  v.object({
    type: v.literal('custom'),
    kind: v.string(),
    providerMetadata,
  }),
  // Provider-executed Web search, named `web_search` in streamText's tools.
  v.object({
    type: v.literal('tool-web_search'),
    toolCallId: v.string(),
    state: toolState,
    title: v.optional(v.string()),
    toolMetadata: v.optional(v.record(v.string(), json(5))),
    providerExecuted: v.optional(v.boolean()),
    input: v.optional(json(6)),
    // A string while streaming; any JSON on output-error.
    rawInput: v.optional(json(6)),
    inputEncoding: v.optional(v.union(v.literal('json'), v.literal('text'))),
    output: v.optional(json(6)),
    errorText: v.optional(v.string()),
    preliminary: v.optional(v.boolean()),
    callProviderMetadata: providerMetadata,
    resultProviderMetadata: providerMetadata,
  }),
)

export const partsValidator = v.array(part)

export type Part = Infer<typeof part>
