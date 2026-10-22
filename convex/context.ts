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

type Meta = { name: string; mediaType: string; size: number }

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

/**
 * The Context as AI SDK UI messages. Attachments the Model can't read become
 * placeholders, then the oldest are swapped for placeholders until the rest
 * fit REQUEST_BUDGET. `load` reads the rest; a missing blob or a text file
 * that isn't UTF-8 without NUL becomes a placeholder too. Bytes go in as
 * base64, never as URLs (#8).
 */
export async function contextMessages<A extends Meta>(
  messages: ContextMessage<A>[],
  readable: readonly AttachmentKind[],
  load: (attachment: A) => Promise<Uint8Array | null>,
) {
  const canRead = (a: Meta) =>
    kindOf(a.mediaType) === 'text' || readable.includes(kindOf(a.mediaType))
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

  return await Promise.all(
    messages.map(async ({ role, parts, attachments }) => {
      if (role === 'assistant') return { role, parts }
      const files = await Promise.all(attachments.map(partOf))
      const text = parts.some((p) => p.type === 'text' && p.text)
        ? parts
        : [{ type: 'text' as const, text: ATTACHMENT_ONLY_TEXT }]
      return { role, parts: [...files, ...text] }
    }),
  )
}
