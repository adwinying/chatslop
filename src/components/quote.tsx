import { TextQuoteIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { MESSAGE_ID } from '~/components/composer'
import { useDraft } from '~/lib/draft'

/**
 * Marks a Message's text, where a Quote starts. It may run past the text, like
 * a triple-click into the next block, but into no other Message (`article`).
 */
export const quotable = { 'data-quotable': '' }

/** The Draft with `text` appended as Markdown quote lines, after a blank line. */
const withQuote = (draft: string, text: string) =>
  (draft.trim() ? `${draft.trimEnd()}\n\n` : '') +
  text
    .replace(/^\n+|\n+$/g, '')
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n') +
  '\n\n'

const elementOf = (node: Node) =>
  node instanceof Element ? node : node.parentElement

/**
 * A floating Quote button under text selected within one Message, which
 * appends it to the Draft. Sits in a `relative` container that scrolls with
 * the Messages.
 */
export function QuoteButton({ draftKey }: { draftKey: string | undefined }) {
  const [, setDraft] = useDraft(draftKey)
  const frame = useRef<HTMLDivElement>(null)
  const [quote, setQuote] = useState<{
    text: string
    top: number
    left: number
  } | null>(null)

  useEffect(() => {
    const onChange = () => {
      const selection = document.getSelection()
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null
      const message =
        range &&
        elementOf(range.startContainer)
          ?.closest('[data-quotable]')
          ?.closest('article')
      const text = selection?.toString() ?? ''
      const at = frame.current?.getBoundingClientRect()
      const others = [...document.querySelectorAll('article')].filter(
        (article) => article !== message,
      )
      if (
        !range ||
        !message ||
        others.some((article) => range.intersectsNode(article)) ||
        !text.trim() ||
        !at
      ) {
        setQuote(null)
        return
      }
      const rect = range.getBoundingClientRect()
      setQuote({
        text,
        top: rect.bottom - at.top,
        left: rect.left + rect.width / 2 - at.left,
      })
    }
    document.addEventListener('selectionchange', onChange)
    return () => document.removeEventListener('selectionchange', onChange)
  }, [])

  const add = () => {
    if (!quote) return
    setDraft((draft) => withQuote(draft, quote.text))
    setQuote(null)
    document.getElementById(MESSAGE_ID)?.focus()
  }

  return (
    <div ref={frame} className="absolute inset-x-0 top-0">
      {quote && draftKey && (
        <button
          type="button"
          // Below the selection, clear of the native selection menu above it.
          style={{ top: quote.top + 8, left: quote.left }}
          className="absolute z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-200 shadow-lg hover:bg-zinc-800"
          // Adds on press, before a tap clears the selection (as iOS does)
          // and unmounts the button. Click serves assistive technology.
          onPointerDown={(event) => {
            event.preventDefault()
            add()
          }}
          onClick={add}
        >
          <TextQuoteIcon className="size-3.5" />
          Quote
        </button>
      )}
    </div>
  )
}
