import type { KeyboardEvent, ReactNode } from 'react'
import { ConvexError } from 'convex/values'
import { ArrowUpIcon, BrainIcon, GlobeIcon, SquareIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import {
  AttachButton,
  DraftAttachments,
  type Intake,
} from '~/components/attachments'
import { Button } from '~/components/ui/button'
import { useDraft } from '~/lib/draft'
import { useShortcut } from '~/lib/shortcut'
import { cn } from '~/lib/utils'

/** The text area's ID, so a suggested prompt can focus it. */
export const MESSAGE_ID = 'message'

/** Enter sends; Shift+Enter and Enter during IME composition don't. */
export function isSendKey(event: KeyboardEvent) {
  // keyCode 229: Safari's confirming Enter arrives after composition ends.
  const composing = event.nativeEvent.isComposing || event.keyCode === 229
  return event.key === 'Enter' && !event.shiftKey && !composing
}

const pill =
  'flex items-center gap-1.5 rounded-full border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 has-focus-visible:ring-2 has-focus-visible:ring-ring/30'

/**
 * The floating composer: the Thread's Draft with its Attachments, pill
 * controls, and Send, which becomes Stop while the Answer streams.
 */
export function Composer({
  draftKey,
  streaming,
  blockReason,
  controls,
  intake,
  onSend,
  onStop,
}: {
  /** From `draftKey()`; the text area waits for it. */
  draftKey: string | undefined
  streaming: boolean
  /** Why Send is blocked, e.g. no Model to send with. Shown once there's text or a file. */
  blockReason?: string
  /** Pills shown left of Send. */
  controls?: ReactNode
  /** The Draft's Attachments; `onSend` reads them from here too. */
  intake?: Intake
  onSend: (text: string) => Promise<unknown>
  onStop: () => void
}) {
  const [text, setText] = useDraft(draftKey)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const hasContent = text.trim() !== '' || !!intake?.attachments.length
  const reason = blockReason ?? intake?.blockReason
  const canSend = !reason && !streaming && !sending && hasContent

  const send = async () => {
    if (!canSend) return
    setError(null)
    setSending(true)
    try {
      await onSend(text)
      // Keeps whatever the User wrote while the send was pending.
      setText((current) => (current === text ? '' : current))
    } catch (cause) {
      // E.g. an Attachment the cron deleted from an old Draft.
      setError(
        cause instanceof ConvexError && typeof cause.data === 'string'
          ? cause.data
          : 'Could not send. Try again.',
      )
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!isSendKey(event)) return
    event.preventDefault()
    void send()
  }

  return (
    <form
      className="mx-auto w-full max-w-3xl rounded-t-2xl border border-b-0 border-zinc-700/80 bg-zinc-900/90 p-2 pb-3 shadow-2xl backdrop-blur"
      onSubmit={(event) => {
        event.preventDefault()
        void send()
      }}
    >
      {intake && <DraftAttachments intake={intake} />}
      <textarea
        id={MESSAGE_ID}
        aria-label="Message"
        disabled={!draftKey}
        placeholder="Type your message here…"
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={intake?.paste}
        // Grows with the text from 2 to 7 rows; py-2 adds 1rem.
        className="field-sizing-content max-h-[calc(7lh+1rem)] min-h-[calc(2lh+1rem)] w-full resize-none bg-transparent px-2 py-2 outline-none placeholder:text-muted-foreground"
      />
      {reason && hasContent && !streaming && (
        <p className="px-2 pb-1 text-xs text-red-300">{reason}</p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 px-1">
        {controls}
        {intake && <AttachButton intake={intake} />}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {streaming ? (
          <Button
            type="button"
            size="icon-lg"
            aria-label="Stop"
            className="ml-auto"
            onClick={onStop}
          >
            <SquareIcon fill="currentColor" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon-lg"
            aria-label="Send"
            className="ml-auto"
            disabled={!canSend}
          >
            <ArrowUpIcon />
          </Button>
        )}
      </div>
    </form>
  )
}

export function ReasoningSelect({
  levels,
  value,
  onChange,
}: {
  levels: string[]
  value: string
  onChange: (level: string) => void
}) {
  const select = useRef<HTMLSelectElement>(null)
  useShortcut(
    'e',
    () => {
      select.current?.focus()
      try {
        select.current?.showPicker()
      } catch {
        // Unsupported in this browser: focus alone lets arrow keys pick.
      }
    },
    { shift: true },
  )

  return (
    <label className={pill}>
      <BrainIcon className="size-3.5" />
      <select
        ref={select}
        aria-label="Reasoning level"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-transparent outline-none"
      >
        {levels.map((level) => (
          <option key={level} value={level} className="bg-zinc-900">
            {level}
          </option>
        ))}
      </select>
    </label>
  )
}

export function WebSearchToggle({
  on,
  onChange,
}: {
  on: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cn(
        pill,
        'outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
        on && 'border-sky-500/50 bg-sky-500/15 text-sky-300',
      )}
    >
      <GlobeIcon className="size-3.5" />
      Web search
    </button>
  )
}
