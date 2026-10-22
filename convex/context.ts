import type { Part } from '@/convex/parts'
import { convertDataContentToBase64String, type FileUIPart } from 'ai'
import {
  type AttachmentKind,
  decodeText,
  KIND_PLURAL,
  kindOf,
} from '@/convex/intake'

/** The most the Attachments in one request add up to, encoded. Claude caps a request at 32 MB (#8). */
export const REQUEST_BUDGET = 20 * 1024 * 1024

/** Stands in for an Attachment-only Prompt's empty text, copied from T3 Code. */
export const ATTACHMENT_ONLY_TEXT =
  '[User attached one or more files without additional text. Respond using the conversation context and the attached files.]'

/**
 * Tokens one image is estimated at, whatever its size: about what Claude
 * charges for the largest image it takes unscaled (1.15 megapixels).
 */
const IMAGE_TOKENS = 1600
/** PDF bytes per estimated token, between text-only PDFs and scans. */
const PDF_BYTES_PER_TOKEN = 20

type Meta = { name: string; mediaType: string; size: number }

/** What the Context needs from the Model. A limit of 0 means models.dev doesn't know it. */
type ContextModel = {
  attachmentTypes: readonly AttachmentKind[]
  contextLimit: number
  outputLimit: number
}

/** A Message in Context, with its Attachments in upload order. */
export type ContextMessage<A extends Meta = Meta> = {
  role: 'user' | 'assistant'
  parts: Part[]
  attachments: A[]
}

const placeholder = ({ name, mediaType }: Meta, reason: string) => ({
  type: 'text' as const,
  text: `[${kindOf(mediaType)}: ${name} omitted${reason}]`,
})

/** Bytes an Attachment adds to the request: base64 for files, raw for inlined text. */
const encodedSize = ({ mediaType, size }: Meta) =>
  kindOf(mediaType) === 'text' ? size : Math.ceil(size / 3) * 4

/** Text costs a token per 4 characters. */
const textTokens = (text: string) => text.length / 4

/**
 * The Context as AI SDK UI messages, and how many of `messages` it leaves out.
 * Attachments the Model can't read become placeholders, then the oldest are
 * swapped for placeholders until the rest fit REQUEST_BUDGET. Then the oldest
 * Prompt+Answer pairs drop until the estimate fits 90% of what the Model's
 * window leaves after its output, so the Context starts with a Prompt. A
 * Model without known limits skips that check. `load` reads the kept
 * Attachments; a missing blob or a text file that isn't UTF-8 without NUL
 * becomes a placeholder too. Bytes go in as base64, never as URLs (#8).
 * Throws when the current Prompt alone doesn't fit.
 */
export async function contextMessages<A extends Meta>(
  messages: ContextMessage<A>[],
  { attachmentTypes, contextLimit, outputLimit }: ContextModel,
  load: (attachment: A) => Promise<Uint8Array | null>,
) {
  const canRead = (a: Meta) =>
    kindOf(a.mediaType) === 'text' ||
    attachmentTypes.includes(kindOf(a.mediaType))
  const omitted = new Map<A, ReturnType<typeof placeholder>>()
  let total = 0
  for (const a of messages.flatMap((m) => m.attachments)) {
    if (canRead(a)) total += encodedSize(a)
    else
      omitted.set(
        a,
        placeholder(
          a,
          `, this Model can't read ${KIND_PLURAL[kindOf(a.mediaType)]}`,
        ),
      )
  }
  for (const a of messages.flatMap((m) => m.attachments)) {
    if (total <= REQUEST_BUDGET) break
    if (omitted.has(a)) continue
    omitted.set(a, placeholder(a, ' to keep the request under 20 MB'))
    total -= encodedSize(a)
  }

  const textParts = ({ role, parts }: ContextMessage<A>) =>
    role === 'assistant' || parts.some((p) => p.type === 'text' && p.text)
      ? parts
      : [{ type: 'text' as const, text: ATTACHMENT_ONLY_TEXT }]
  const attachmentTokens = (a: A) => {
    const skipped = omitted.get(a)
    if (skipped) return textTokens(skipped.text)
    const kind = kindOf(a.mediaType)
    if (kind === 'image') return IMAGE_TOKENS
    if (kind === 'pdf') return a.size / PDF_BYTES_PER_TOKEN
    return a.size / 4
  }
  const tokens = messages.map(
    (m) =>
      textParts(m).reduce(
        (sum, p) => sum + textTokens('text' in p ? p.text : JSON.stringify(p)),
        0,
      ) + m.attachments.reduce((sum, a) => sum + attachmentTokens(a), 0),
  )

  const budget =
    contextLimit > 0 && outputLimit > 0
      ? (contextLimit - outputLimit) * 0.9
      : Infinity
  let rest = tokens.reduce((sum, n) => sum + n, 0)
  let dropped = 0
  while (messages[dropped]?.role !== 'user' || rest > budget) {
    if (dropped >= messages.length - 1)
      throw new Error('Prompt too long for this Model')
    rest -= tokens[dropped]!
    dropped++
  }

  const partOf = async (a: A) => {
    const skipped = omitted.get(a)
    if (skipped) return skipped
    const bytes = await load(a)
    const unreadable = placeholder(a, ', it could not be read')
    if (!bytes) return unreadable
    if (kindOf(a.mediaType) !== 'text')
      return {
        type: 'file',
        mediaType: a.mediaType,
        filename: a.name,
        url: `data:${a.mediaType};base64,${convertDataContentToBase64String(bytes)}`,
      } satisfies FileUIPart
    const text = decodeText(bytes)
    return text === null
      ? unreadable
      : {
          type: 'text' as const,
          text: `<file name="${a.name}">\n${text}\n</file>`,
        }
  }

  return {
    messages: await Promise.all(
      messages.slice(dropped).map(async (m) => {
        if (m.role === 'assistant') return { role: m.role, parts: m.parts }
        const files = await Promise.all(m.attachments.map(partOf))
        return { role: m.role, parts: [...files, ...textParts(m)] }
      }),
    ),
    dropped,
  }
}
