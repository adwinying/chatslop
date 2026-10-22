import type { Id } from '@/convex/_generated/dataModel'
import type { Options } from '~/components/model-picker'
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  PencilIcon,
  RefreshCwIcon,
} from 'lucide-react'
import { useState } from 'react'
import { isSendKey } from '~/components/composer'
import { ModelMenu } from '~/components/model-picker'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'

/** Shows actions on hover or focus, or always. Inside a `group`. */
const shown = (always: boolean) =>
  cn(
    'flex items-center',
    !always &&
      'opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-aria-expanded:opacity-100',
  )

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? 'Copied' : 'Copy'}
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}

/** Copy, Regenerate, and the chevron to regenerate with another Model. */
export function AnswerActions({
  text,
  modelId,
  options,
  always,
  disabled,
  onRegenerate,
}: {
  text: string
  modelId: Id<'models'>
  options?: Options | null
  always: boolean
  /** While the Thread has a Live answer. */
  disabled: boolean
  onRegenerate: (modelId?: Id<'models'>) => void
}) {
  return (
    <div className={shown(always)}>
      <CopyButton text={text} />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Regenerate"
        disabled={disabled}
        onClick={() => onRegenerate()}
      >
        <RefreshCwIcon />
      </Button>
      {options && (
        <ModelMenu
          options={options}
          modelId={modelId}
          onPick={onRegenerate}
          trigger={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Regenerate with another Model"
              disabled={disabled}
            >
              <ChevronDownIcon />
            </Button>
          }
        />
      )}
    </div>
  )
}

/** Edit and Copy, under a Prompt. */
export function PromptActions({
  text,
  disabled,
  onEdit,
}: {
  text: string
  /** While the Thread has a Live answer. */
  disabled: boolean
  onEdit: () => void
}) {
  return (
    <div className={cn(shown(false), 'justify-end')}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Edit"
        disabled={disabled}
        onClick={onEdit}
      >
        <PencilIcon />
      </Button>
      <CopyButton text={text} />
    </div>
  )
}

/** The Prompt bubble as an editor. Enter or Send resends; Escape cancels. */
export function PromptEditor({
  text: initial,
  disabled,
  onSend,
  onCancel,
}: {
  text: string
  /** Why Send can't go yet, e.g. a Live answer or no Model. */
  disabled: boolean
  onSend: (text: string) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(initial)
  const canSend = !disabled && text.trim() !== ''

  return (
    <form
      className="w-full max-w-[85%] rounded-2xl bg-zinc-800 p-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSend) onSend(text)
      }}
    >
      <textarea
        aria-label="Edit Prompt"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- it opens on the User's request.
        autoFocus
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
          if (!isSendKey(event)) return
          event.preventDefault()
          event.currentTarget.form?.requestSubmit()
        }}
        className="w-full resize-none bg-transparent px-2 py-1 outline-none"
      />
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="lg" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="lg" disabled={!canSend}>
          Send
        </Button>
      </div>
    </form>
  )
}
