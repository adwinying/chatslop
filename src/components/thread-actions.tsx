import type { Doc } from '@/convex/_generated/dataModel'
import { AlertDialog } from '@base-ui/react/alert-dialog'
import { useNavigate, useParams } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { ConvexError } from 'convex/values'
import { PencilIcon, PinIcon, PinOffIcon, Trash2Icon } from 'lucide-react'
import { useRef } from 'react'
import { toast } from 'sonner'
import { api } from '@/convex/_generated/api'
import { Button } from '~/components/ui/button'
import { cn } from '~/lib/utils'

type Thread = Pick<Doc<'threads'>, '_id' | 'title' | 'pinned'>

/** Runs a mutation, toasting its ConvexError message if it fails. */
async function attempt(run: () => Promise<unknown>) {
  try {
    await run()
  } catch (cause) {
    toast.error(
      cause instanceof ConvexError && typeof cause.data === 'string'
        ? cause.data
        : 'Something went wrong. Try again.',
    )
  }
}

/** Edits the title in place. Enter or leaving saves; Escape cancels. */
export function TitleInput({
  thread,
  onDone,
  className,
}: {
  thread: Thread
  onDone: () => void
  className?: string
}) {
  const rename = useMutation(api.threads.rename)
  // Unmounting may blur the input, which mustn't save after Escape.
  const cancelled = useRef(false)

  const save = (title: string) => {
    onDone()
    if (cancelled.current) return
    if (title.trim() && title.trim() !== thread.title)
      void attempt(() => rename({ threadId: thread._id, title }))
  }

  return (
    <input
      aria-label="Title"
      defaultValue={thread.title}
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- it opens on the User's request.
      autoFocus
      onFocus={(event) => event.currentTarget.select()}
      onBlur={(event) => save(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          // Leaves the phone sidebar open.
          event.stopPropagation()
          cancelled.current = true
          onDone()
        }
      }}
      className={cn(
        'min-w-0 rounded-md bg-zinc-800 px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30',
        className,
      )}
    />
  )
}

export function RenameButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" aria-label="Rename" onClick={onClick}>
      <PencilIcon />
    </Button>
  )
}

export function PinButton({ thread }: { thread: Thread }) {
  const setPinned = useMutation(api.threads.setPinned)
  const { pinned } = thread

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={pinned ? 'Unpin' : 'Pin'}
      onClick={() =>
        void attempt(() => setPinned({ threadId: thread._id, pinned: !pinned }))
      }
    >
      {pinned ? <PinOffIcon /> : <PinIcon />}
    </Button>
  )
}

/** Deletes after a confirm, leaving the Thread first if it's open. */
export function DeleteButton({ thread }: { thread: Thread }) {
  const remove = useMutation(api.threads.remove)
  const navigate = useNavigate()
  const { threadId } = useParams({ strict: false })

  const confirm = async () => {
    // The open Thread's queries would fail once it's gone.
    if (threadId === thread._id) await navigate({ to: '/' })
    await attempt(() => remove({ threadId: thread._id }))
  }

  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger
        render={<Button variant="ghost" size="icon" aria-label="Delete" />}
      >
        <Trash2Icon />
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-black/60" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-50 w-[min(24rem,90vw)] -translate-1/2 rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl outline-none">
          <AlertDialog.Title className="font-semibold">
            Delete this Thread?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-zinc-400">
            “{thread.title}” and its Attachments will be gone for good.
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close render={<Button variant="ghost" size="lg" />}>
              Cancel
            </AlertDialog.Close>
            <AlertDialog.Close
              render={<Button variant="destructive" size="lg" />}
              onClick={() => void confirm()}
            >
              Delete
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
