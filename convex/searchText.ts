// No server imports, so the sidebar highlights matches the same way.
import type { Part } from '@/convex/parts'

/** Convex search reads at most this many terms; the rest are dropped. */
const MAX_TERMS = 16
const SNIPPET_BEFORE = 30
const SNIPPET_AFTER = 50

/**
 * Convex's tokenizer keeps an unspaced Japanese clause as one term, and drops
 * terms of 32 bytes or more, so each CJK run becomes its overlapping bigrams.
 * A unigram for the run's last character lets a single-character query match.
 */
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu

function bigrams(run: string) {
  // oxlint-disable-next-line typescript/no-misused-spread -- a CJK run holds no grapheme clusters to keep whole.
  const chars = [...run]
  const pairs = chars.slice(1).map((char, i) => chars[i] + char)
  return ` ${[...pairs, chars.at(-1)].join(' ')} `
}

const FENCE = /^\s*(?:```|~~~).*$/m
const CODE_SPAN = /`([^`\n]*)`/g
/** Set-aside code, as its index between private-use characters that no Markdown syntax matches. */
const KEPT = /\uE000(\d+)\uE001/g

/**
 * Markdown as plain text: code content stays, syntax goes. Code is set aside
 * first, so the other replacements can't reach inside it.
 */
export function plainText(markdown: string) {
  const code: string[] = []
  const keep = (text: string) => `\uE000${code.push(text) - 1}\uE001`
  return (
    markdown
      // Every other piece lies between an opening and a closing fence.
      .split(FENCE)
      .map((piece, i) => (i % 2 ? keep(piece) : piece))
      .join('')
      .replace(CODE_SPAN, (_, text: string) => keep(text))
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|\*|~~)(\S.*?\S|\S)\1/g, '$2')
      .replace(/^\s*(#{1,6}|[-*+]|\d+\.|>)\s+/gm, '')
      .replace(KEPT, (kept, i: string) => code[Number(i)] ?? kept)
  )
}

/** What the search indexes hold, and what queries are matched with. */
export const toSearchText = (text: string) =>
  plainText(text).replace(CJK_RUN, bigrams)

/** A title with the field `search_title` indexes. */
export const withSearchTitle = (title: string) => ({
  title,
  searchTitle: toSearchText(title),
})

/** A Message's searchable text: its text parts, then any Attachment names. Reasoning and sources stay out. */
export const messageText = (parts: Part[], attachmentNames: string[] = []) =>
  [
    ...parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
    ...attachmentNames,
  ]
    .filter(Boolean)
    .join('\n')

/**
 * The query as search terms, split like Convex's tokenizer does. A long CJK
 * query keeps its first 16 terms, about 17 characters.
 */
export const searchTerms = (query: string) =>
  toSearchText(query)
    .split(/[^\p{Alphabetic}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, MAX_TERMS)
    .join(' ')

/** Matches the raw query anywhere, ignoring case and how whitespace runs. */
export const queryPattern = (query: string) =>
  new RegExp(
    query
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '\\s+'),
    'iu',
  )

/** The text around the first match on one line, or undefined without a match. */
export function snippet(text: string, pattern: RegExp) {
  const flat = text.replace(/\s+/g, ' ').trim()
  const match = pattern.exec(flat)
  if (!match) return undefined
  const start = Math.max(0, match.index - SNIPPET_BEFORE)
  const end = match.index + match[0].length + SNIPPET_AFTER
  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
}
