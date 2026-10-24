import type { Part } from '@/convex/parts'
import type {
  answerStatus,
  timingValidator,
  usageValidator,
} from '@/convex/schema'
import type { Citation } from 'ai'
import type { Infer } from 'convex/values'
import type { ComponentProps, CSSProperties, ReactNode } from 'react'
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
import {
  Children,
  createContext,
  isValidElement,
  use,
  useId,
  useState,
} from 'react'
import { defaultComponents, Streamdown } from 'streamdown'
import { cn } from '~/lib/utils'

const plugins = { code, math, cjk }
// Spreads each Live answer snapshot, saved about once a second, over the second.
// A module constant, since Streamdown re-renders when `animated` changes identity.
const animated = { maxBacklogMs: 1000 }
const components = { inlineCode: InlineCode, cite: Cite }
// Sanitization names attributes by their hast property.
const allowedTags = { cite: ['dataSources'] }

/**
 * Fades inline code in whole, timed by its first word, so its pill doesn't
 * show empty while the words inside fade in. app.css stops those words.
 */
function InlineCode({
  children,
  ...props
}: ComponentProps<typeof defaultComponents.code>) {
  const first = Children.toArray(children).find(
    isValidElement<{ 'data-sd-animate'?: boolean; style?: CSSProperties }>,
  )
  const fade = first?.props['data-sd-animate']
  return (
    <defaultComponents.code
      {...props}
      data-sd-animate={fade}
      style={fade ? first?.props.style : undefined}
    >
      {children}
    </defaultComponents.code>
  )
}

type TextPart = Extract<Part, { type: 'text' }>
type Source = { url: string; title?: string }

/**
 * A Message's text parts as Markdown. Anthropic starts a new part at each
 * citation, so only parts split by others, like a Web search, are paragraphs.
 */
export const textOf = (
  parts: Part[],
  textFor = (part: TextPart) => part.text,
) =>
  parts
    .map((part) => (part.type === 'text' ? textFor(part) : '\n\n'))
    .join('')
    .trim()

const cite = (numbers: number[], phrase = '') =>
  `<cite data-sources="${[...new Set(numbers)].join(' ')}">${phrase}</cite>`

/**
 * The Answer's Markdown with its citations as `<cite>` tags, and the cited
 * Sources, numbered by first citation. Anthropic cites a whole text part;
 * OpenAI cites a range, the `([host](url))` link it writes.
 */
function citedText(parts: Part[]) {
  const cited = new Map<string, Source>()
  const numbers = (citations: Citation[]) =>
    citations.flatMap(({ source }) => {
      if (source.sourceType !== 'url') return []
      const { url, title } = source
      if (!cited.has(url)) cited.set(url, { url, title })
      return [[...cited.keys()].indexOf(url) + 1]
    })

  const markdown = textOf(parts, ({ text, citations = [] }) => {
    // Stored parts came from the SDK; the validator only loosened their JSON.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const all = citations as Citation[]
    // Offsets that miss the link, e.g. counted in code points, leave it as is.
    const ranged = all
      .filter(
        ({ source, startIndex = 0, endIndex = 0 }) =>
          source.sourceType === 'url' &&
          text.slice(startIndex, endIndex).includes(source.url),
      )
      .toSorted((a, b) => (a.startIndex ?? 0) - (b.startIndex ?? 0))
    if (ranged.length) {
      let marked = ''
      let at = 0
      for (const citation of ranged) {
        if ((citation.startIndex ?? 0) < at) continue
        marked += text.slice(at, citation.startIndex).trimEnd()
        marked += cite(numbers([citation]))
        at = citation.endIndex ?? 0
      }
      return marked + text.slice(at)
    }

    const sources = numbers(all)
    if (!sources.length) return text
    const [, lead, phrase, trail] = /^(\s*)(.*?)(\s*)$/s.exec(text) ?? []
    // Tags spanning lines would break the Markdown blocks inside.
    return phrase?.includes('\n') || !phrase
      ? text + cite(sources)
      : `${lead}${cite(sources, phrase)}${trail}`
  })
  return { text: markdown, cited: [...cited.values()] }
}

/** The Answer's cited Sources, so `<cite>` can link its numbers. */
const CitedSources = createContext<Source[]>([])

const hostname = (url: string) =>
  URL.canParse(url) ? new URL(url).hostname : url

/** A cited phrase, underlined, then the numbers of its Sources. */
function Cite({
  children,
  'data-sources': numbers = '',
}: ComponentProps<'cite'> & { 'data-sources'?: string }) {
  const sources = use(CitedSources)
  const links = numbers
    .split(' ')
    .flatMap((n) => (sources[Number(n) - 1] ? [Number(n)] : []))
  if (!links.length) return children
  return (
    <>
      {children && (
        <span className="underline decoration-zinc-600 decoration-dotted underline-offset-4">
          {children}
        </span>
      )}
      {links.map((n) => {
        const { url, title } = sources[n - 1]!
        return (
          <sup key={n} className="ml-px font-sans text-[11px]">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              title={title}
              aria-label={`Source ${n}: ${title ?? hostname(url)}`}
              className="rounded-sm bg-zinc-800 px-1 text-zinc-400 no-underline hover:text-zinc-100"
            >
              {n}
            </a>
          </sup>
        )
      })}
    </>
  )
}

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
  const { text, cited } = citedText(parts)
  // Text shown at mount, e.g. after a reload, would all fade in again.
  const [fades] = useState(!text)
  // The Model can think again after some text, e.g. around a Web search.
  const thinking =
    streaming &&
    parts.some(
      (part) => part.type === 'reasoning' && part.state === 'streaming',
    )
  const sources = [
    ...cited,
    ...new Map(
      parts.flatMap((part) =>
        part.type === 'source-url' && !cited.some(({ url }) => url === part.url)
          ? [[part.url, part] as const]
          : [],
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
        <CitedSources value={cited}>
          <Streamdown
            plugins={plugins}
            isAnimating={streaming}
            animated={fades ? animated : undefined}
            components={components}
            allowedTags={allowedTags}
            className="font-serif text-[17px] leading-normal"
          >
            {text}
          </Streamdown>
        </CitedSources>
      )}
      {sources.length > 0 && (
        <ul aria-label="Sources" className="mt-3 flex flex-wrap gap-1.5">
          {sources.map((source, i) => (
            <li key={source.url}>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                title={source.title}
                className="flex items-center rounded-full border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-100"
              >
                {i < cited.length && (
                  <span className="mr-1 text-zinc-500">{i + 1}</span>
                )}
                {hostname(source.url)}
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
