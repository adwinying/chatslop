import type { Part } from '@/convex/parts'
import type { answerStatus } from '@/convex/schema'
import type { Infer } from 'convex/values'
import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import {
  BrainIcon,
  ChevronDownIcon,
  Loader2Icon,
  SquareIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Streamdown } from 'streamdown'
import { cn } from '~/lib/utils'

const plugins = { code, math, cjk }

/** An Answer, finished or live: reasoning, markdown text, sources and its status. */
export function Answer({
  parts,
  streaming = false,
  status,
  error,
}: {
  parts: Part[]
  streaming?: boolean
  status?: Infer<typeof answerStatus>
  error?: string
}) {
  const reasoning = parts
    .flatMap((part) => (part.type === 'reasoning' ? [part.text] : []))
    .join('\n\n')
  const text = parts
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n\n')
  const sources = [
    ...new Map(
      parts.flatMap((part) =>
        part.type === 'source-url' ? [[part.url, part] as const] : [],
      ),
    ).values(),
  ]

  return (
    <article aria-label="Answer" aria-busy={streaming}>
      {streaming && !reasoning && !text && (
        <Loader2Icon
          aria-label="Waiting for the Model"
          className="size-4 animate-spin text-zinc-400"
        />
      )}
      {reasoning && (
        <Reasoning text={reasoning} thinking={streaming && !text} />
      )}
      {text && (
        <Streamdown
          plugins={plugins}
          isAnimating={streaming}
          className="font-serif text-[17px] leading-normal"
        >
          {text}
        </Streamdown>
      )}
      {sources.length > 0 && (
        <ul aria-label="Sources" className="mt-3 flex flex-wrap gap-1.5">
          {sources.map((source) => (
            <li key={source.url}>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                title={source.title}
                className="flex items-center rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-100"
              >
                {URL.canParse(source.url)
                  ? new URL(source.url).hostname
                  : source.url}
              </a>
            </li>
          ))}
        </ul>
      )}
      {status === 'stopped' && (
        <div className="mt-2 inline-flex items-center gap-1 text-xs text-amber-400">
          <SquareIcon className="size-2.5" fill="currentColor" />
          Stopped
        </div>
      )}
      {status === 'error' && (
        <div
          role="alert"
          className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300"
        >
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      )}
    </article>
  )
}

/** Open while the Model thinks, collapsed once the text starts. */
function Reasoning({ text, thinking }: { text: string; thinking: boolean }) {
  const [toggled, setToggled] = useState<boolean | null>(null)
  const open = toggled ?? thinking

  return (
    <div className="mb-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setToggled(!open)}
        className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200"
      >
        {thinking ? (
          <Loader2Icon className="size-3.5 animate-spin" />
        ) : (
          <BrainIcon className="size-3.5" />
        )}
        {thinking ? 'Thinking…' : 'Reasoning'}
        <ChevronDownIcon
          className={cn('size-3.5 transition', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="mt-2 border-l-2 border-zinc-700 pl-3 text-sm whitespace-pre-wrap text-zinc-400">
          {text}
        </div>
      )}
    </div>
  )
}
