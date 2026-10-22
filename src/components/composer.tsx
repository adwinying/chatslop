import type { KeyboardEvent } from 'react'
import { ArrowUpIcon, SquareIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '~/components/ui/button'

/** Plain textarea with Send, which becomes Stop while the Answer streams. */
export function Composer({
  streaming,
  onSend,
  onStop,
}: {
  streaming: boolean
  onSend: (text: string) => Promise<unknown>
  onStop: () => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const canSend = !streaming && text.trim() !== ''

  const send = async () => {
    if (!canSend) return
    setError(null)
    try {
      await onSend(text)
      setText('')
    } catch {
      setError('Could not send. Try again.')
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // keyCode 229: Safari's confirming Enter arrives after composition ends.
    const composing = event.nativeEvent.isComposing || event.keyCode === 229
    if (event.key !== 'Enter' || event.shiftKey || composing) return
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
      <textarea
        aria-label="Message"
        placeholder="Type your message here…"
        rows={2}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        className="w-full resize-none bg-transparent px-2 py-2 outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center justify-end gap-2 px-1">
        {error && (
          <p role="alert" className="mr-auto text-xs text-destructive">
            {error}
          </p>
        )}
        {streaming ? (
          <Button
            type="button"
            size="icon-lg"
            aria-label="Stop"
            onClick={onStop}
          >
            <SquareIcon fill="currentColor" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon-lg"
            aria-label="Send"
            disabled={!canSend}
          >
            <ArrowUpIcon />
          </Button>
        )}
      </div>
    </form>
  )
}
