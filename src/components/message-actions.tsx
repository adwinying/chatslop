import type { Id } from '@/convex/_generated/dataModel'
import type { AttachmentKind } from '@/convex/intake'
import type { Options } from '~/components/model-picker'
import type { DraftAttachment } from '~/lib/draft'
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  PencilIcon,
  RefreshCwIcon,
} from 'lucide-react'
import { useState } from 'react'
import {
  AttachButton,
  DraftAttachments,
  useIntake,
} from '~/components/attachments'
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

/**
 * The Prompt bubble as an editor, with the composer's Attachment intake.
 * Enter or Send resends; Escape cancels.
 */
export function PromptEditor({
  text: initial,
  attachments,
  readable,
  disabled,
  onSend,
  onCancel,
}: {
  text: string
  attachments: DraftAttachment[]
  /** What the Model reads besides text. */
  readable?: AttachmentKind[]
  /** Why Send can't go yet, e.g. a Live answer or no Model. */
  disabled: boolean
  onSend: (text: string, attachmentIds: Id<'attachments'>[]) => void
  onCancel: () => void
}) {
  const [text, setText] = useState(initial)
  const intake = useIntake(useState(attachments), readable)
  const canSend =
    !disabled &&
    !intake.blockReason &&
    (text.trim() !== '' || intake.attachments.length > 0)

  return (
    <form
      className="w-full max-w-[85%] rounded-2xl bg-zinc-800 p-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSend)
          onSend(
            text,
            intake.attachments.map((a) => a._id),
          )
      }}
    >
      <DraftAttachments intake={intake} />
      <textarea
        aria-label="Edit Prompt"
        // oxlint-disable-next-line jsx-a11y/no-autofocus -- it opens on the User's request.
        autoFocus
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onPaste={intake.paste}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel()
          if (!isSendKey(event)) return
          event.preventDefault()
          event.currentTarget.form?.requestSubmit()
        }}
        className="w-full resize-none bg-transparent px-2 py-1 outline-none"
      />
      {intake.blockReason && (
        <p className="px-2 pb-1 text-xs text-red-300">{intake.blockReason}</p>
      )}
      <div className="flex gap-1.5">
        <AttachButton intake={intake} />
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="ml-auto"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" size="lg" disabled={!canSend}>
          Send
        </Button>
      </div>
    </form>
  )
}
