import type { Part } from '@/convex/parts'
import type {
  answerStatus,
  timingValidator,
  usageValidator,
} from '@/convex/schema'
import type { Infer } from 'convex/values'
import type { ReactNode } from 'react'
import { cjk } from '@streamdown/cjk'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import {
  BrainIcon,
  ChevronDownIcon,
  GlobeIcon,
  Loader2Icon,
  SquareIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { useId, useState } from 'react'
import { Streamdown } from 'streamdown'
import { cn } from '~/lib/utils'

const plugins = { code, math, cjk }

/** What made a finished Answer. */
type Made = {
  modelName: string
  reasoningLevel?: string
  webSearch: boolean
  usage?: Infer<typeof usageValidator>
  timing?: Infer<typeof timingValidator>
}

/** An Answer, finished or live: reasoning, markdown text, sources, its status and what made it. */
export function Answer({
  parts,
  streaming = false,
  status,
  error,
  made,
  actions,
}: {
  parts: Part[]
  streaming?: boolean
  status?: Infer<typeof answerStatus>
  error?: string
  made?: Made
  /** Shown before the label. The article is a `group`, so they can show on hover. */
  actions?: ReactNode
}) {
  const reasoning = parts
    .flatMap((part) => (part.type === 'reasoning' ? [part.text] : []))
    .join('\n\n')
  const text = parts
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n\n')
  // The Model can think again after some text, e.g. around a Web search.
  const thinking =
    streaming &&
    parts.some(
      (part) => part.type === 'reasoning' && part.state === 'streaming',
    )
  const sources = [
    ...new Map(
      parts.flatMap((part) =>
        part.type === 'source-url' ? [[part.url, part] as const] : [],
      ),
    ).values(),
  ]

  return (
    <article aria-label="Answer" aria-busy={streaming} className="group">
      {streaming && !reasoning && !text && (
        <Loader2Icon
          aria-label="Waiting for the Model"
          className="size-4 animate-spin text-zinc-400"
        />
      )}
      {reasoning && <Reasoning text={reasoning} thinking={thinking} />}
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
      {(actions || made) && (
        <div className="mt-2 flex items-center gap-1">
          {actions}
          {made && <Label {...made} />}
        </div>
      )}
    </article>
  )
}

const count = new Intl.NumberFormat('en', { notation: 'compact' })
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`

/**
 * Model · Reasoning level · Web search. Usage and timing show on hover or
 * focus, and a tap or click toggles them for touch.
 */
function Label({ modelName, reasoningLevel, webSearch, usage, timing }: Made) {
  const stats = [
    usage?.inputTokens !== undefined && `${count.format(usage.inputTokens)} in`,
    usage?.outputTokens !== undefined &&
      `${count.format(usage.outputTokens)} out`,
    usage?.reasoningTokens !== undefined &&
      `${count.format(usage.reasoningTokens)} reasoning`,
    timing?.firstTokenMs !== undefined &&
      `first token ${seconds(timing.firstTokenMs)}`,
    timing && `${seconds(timing.durationMs)} total`,
  ]
    .filter(Boolean)
    .join(' · ')

  const statsId = useId()
  const [open, setOpen] = useState(false)

  return (
    <div className="group/label relative inline-flex">
      <button
        type="button"
        aria-label={[modelName, reasoningLevel, webSearch && 'Web search']
          .filter(Boolean)
          .join(' · ')}
        aria-expanded={open}
        aria-describedby={statsId}
        onClick={() => setOpen(!open)}
        onBlur={() => setOpen(false)}
        className="flex items-center gap-1 rounded text-xs text-zinc-500 outline-none hover:text-zinc-300 focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        {[modelName, reasoningLevel].filter(Boolean).join(' · ')}
        {webSearch && <GlobeIcon aria-hidden className="size-3" />}
      </button>
      <span
        id={statsId}
        role="tooltip"
        className={cn(
          'absolute bottom-full left-0 mb-2 w-max rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300',
          !open &&
            'hidden group-hover/label:block group-has-focus-visible/label:block',
        )}
      >
        {stats || 'No usage recorded'}
      </span>
    </div>
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
