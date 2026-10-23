import type { Id } from '@/convex/_generated/dataModel'
import type { ClipboardEvent, Dispatch, DragEvent, SetStateAction } from 'react'
import type { DraftAttachment, Upload } from '~/lib/draft'
import { Dialog } from '@base-ui/react/dialog'
import { useAction, useMutation } from 'convex/react'
import { ConvexError } from 'convex/values'
import { FileTextIcon, PaperclipIcon, XIcon } from 'lucide-react'
import { useRef } from 'react'
import { toast } from 'sonner'
import { api } from '@/convex/_generated/api'
import {
  type AttachmentKind,
  decodeText,
  KIND_PLURAL,
  kindOf,
  MAX_ATTACHMENTS,
  MAX_BYTES,
  SIZE_LABEL,
} from '@/convex/intake'
import { attempt } from '~/components/thread-actions'
import { Button } from '~/components/ui/button'
import { convexUrl } from '~/lib/convex-url'
import { cn } from '~/lib/utils'

/** Where the browser reads an Attachment: a Start route that checks the session and ownership. */
export const attachmentUrl = (id: Id<'attachments'>) => `/api/attachments/${id}`

/** A longer paste becomes a "Pasted text" Attachment. */
const PASTE_LIMIT = 5000
/** Images are downscaled to this long edge. */
const MAX_EDGE = 2048
/**
 * Any UTF-8 file is a text file, which `accept` can't say, so the picker
 * offers common ones. Paste and drop take the rest.
 */
const TEXT_TYPES =
  'text/*,.md,.json,.jsonl,.yaml,.yml,.toml,.csv,.tsv,.xml,.sql,.sh,.ts,.tsx,.js,.jsx,.mjs,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cpp,.cs,.php,.lua,.log'

type Attachment = Pick<DraftAttachment, '_id' | 'name' | 'mediaType' | 'size'>
type State<T> = readonly [T, Dispatch<SetStateAction<T>>]
export type Intake = ReturnType<typeof useIntake>

export const hasFiles = (event: DragEvent) =>
  event.dataTransfer.types.includes('Files')

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`

// Not crypto.randomUUID(): browsers offer it only over HTTPS, and the
// app is also reached over plain HTTP on the LAN.
let nextUploadKey = 0

/**
 * The Attachment intake shared by the composer and the Prompt editor:
 * picker, paste and drop, each file checked, processed and uploaded on
 * attach. `state` holds the uploaded Attachments; `readable` is what the
 * Model reads besides text. Until the Model loads, every kind passes: the
 * server checks again on send, and the chips turn red once it's known.
 */
export function useIntake(
  [attachments, setAttachments]: State<DraftAttachment[]>,
  [uploads, setUploads]: State<Upload[]>,
  readable: readonly AttachmentKind[] = ['image', 'pdf'],
) {
  const generateUploadUrl = useMutation(api.attachments.generateUploadUrl)
  const register = useAction(api.attachments.add)
  const deleteUnsent = useMutation(api.attachments.remove)

  const upload = async (file: File) => {
    const key = String(nextUploadKey++)
    const update = (progress: number) =>
      setUploads((list) =>
        list.map((u) => (u.key === key ? { ...u, progress } : u)),
      )
    setUploads((list) => [...list, { key, name: file.name, progress: 0 }])
    await attempt(async () => {
      const prepared = await prepare(file, readable)
      const storageId = await post(await generateUploadUrl(), prepared, update)
      const attachment = await register({ storageId, name: prepared.name })
      setAttachments((list) => [...list, attachment])
    })
    setUploads((list) => list.filter((u) => u.key !== key))
  }

  const unreadable = ({ mediaType }: Attachment) => {
    const kind = kindOf(mediaType)
    return kind !== 'text' && !readable.includes(kind)
  }

  const add = (files: File[]) => {
    const room = MAX_ATTACHMENTS - attachments.length - uploads.length
    if (files.length > room)
      toast.error(`Attach at most ${MAX_ATTACHMENTS} files`)
    for (const file of files.slice(0, Math.max(0, room))) void upload(file)
  }

  return {
    attachments,
    setAttachments,
    uploads,
    unreadable,
    add,
    /** Takes pasted files, and turns a long text paste into a file. */
    paste: (event: ClipboardEvent) => {
      const files = [...event.clipboardData.files]
      const text = event.clipboardData.getData('text/plain')
      if (files.length) add(files)
      else if (text.length > PASTE_LIMIT)
        add([new File([text], 'Pasted text', { type: 'text/plain' })])
      else return
      event.preventDefault()
    },
    /** Takes dropped files, unless an intake inside took them. */
    drop: (event: DragEvent) => {
      if (event.defaultPrevented || !hasFiles(event)) return
      event.preventDefault()
      add([...event.dataTransfer.files])
    },
    remove: (id: Id<'attachments'>) => {
      setAttachments((list) => list.filter((a) => a._id !== id))
      // A sent one stays with its Prompt until the edit is sent.
      void deleteUnsent({ attachmentId: id })
    },
    blockReason: uploads.length
      ? 'Waiting for uploads…'
      : attachments.some(unreadable)
        ? "Remove the files this Model can't read"
        : undefined,
    accept: [
      readable.includes('image') && 'image/*',
      readable.includes('pdf') && 'application/pdf',
      TEXT_TYPES,
    ]
      .filter(Boolean)
      .join(','),
  }
}

/** The file to upload: a downscaled WebP image, a PDF, or UTF-8 text. Throws why not. */
async function prepare(file: File, readable: readonly AttachmentKind[]) {
  const kind: AttachmentKind = file.type.startsWith('image/')
    ? 'image'
    : file.type === 'application/pdf'
      ? 'pdf'
      : 'text'
  if (kind !== 'text' && !readable.includes(kind))
    throw new ConvexError(`This Model can't read ${KIND_PLURAL[kind]}`)
  if (kind === 'image') return await toWebp(file)
  if (file.size > MAX_BYTES[kind])
    throw new ConvexError(`${file.name} is over ${SIZE_LABEL[kind]}`)
  if (
    kind === 'text' &&
    decodeText(new Uint8Array(await file.arrayBuffer())) === null
  )
    throw new ConvexError(
      `${file.name}: only images, PDFs and text files can be attached`,
    )
  return file
}

/** The image's first frame, at most MAX_EDGE on its long edge, as WebP. */
async function toWebp(file: File) {
  const unreadable = new ConvexError(`Can't read ${file.name}`)
  const bitmap = await createImageBitmap(file).catch(() => {
    throw unreadable
  })
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.9),
  )
  if (!blob) throw unreadable
  // Safari can't encode WebP and gives PNG, which the server takes too.
  const name = `${file.name.replace(/\.[^.]*$/, '')}.${blob.type.split('/')[1]}`
  return new File([blob], name, { type: blob.type })
}

/** Uploads through the `/convex` proxy (ADR 0001), reporting progress from 0 to 1. */
function post(
  uploadUrl: string,
  file: File,
  onProgress: (progress: number) => void,
) {
  // Convex hands out its canonical URL: the loopback origin in dev, already
  // under `/convex` in the container. Keep only the `/api/…` part.
  const { pathname, search } = new URL(uploadUrl)
  const path = pathname.slice(pathname.indexOf('/api/'))
  return new Promise<Id<'_storage'>>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', convexUrl() + path + search)
    xhr.setRequestHeader('Content-Type', file.type || 'text/plain')
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    })
    xhr.addEventListener('load', () => {
      if (xhr.status !== 200)
        return reject(new ConvexError(`Could not upload ${file.name}`))
      const { storageId }: { storageId: Id<'_storage'> } = JSON.parse(
        xhr.responseText,
      )
      resolve(storageId)
    })
    xhr.addEventListener('error', () =>
      reject(new ConvexError(`Could not upload ${file.name}`)),
    )
    xhr.send(file)
  })
}

/** Opens the file picker. */
export function AttachButton({ intake }: { intake: Intake }) {
  const input = useRef<HTMLInputElement>(null)

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        aria-label="Attach"
        onClick={() => input.current?.click()}
      >
        <PaperclipIcon />
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={intake.accept}
        onChange={(event) => {
          intake.add([...(event.target.files ?? [])])
          event.target.value = ''
        }}
      />
    </>
  )
}

const chip =
  'flex h-10 max-w-56 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-800/60 px-2 text-xs'

/** The Draft's Attachment chips: red when the Model can't read them, with progress while uploading. */
export function DraftAttachments({ intake }: { intake: Intake }) {
  if (!intake.attachments.length && !intake.uploads.length) return null

  return (
    <ul aria-label="Attachments" className="flex flex-wrap gap-1.5 px-1 pb-1">
      {intake.attachments.map((a) => (
        <li
          key={a._id}
          title={intake.unreadable(a) ? "This Model can't read it" : undefined}
          className={cn(
            chip,
            intake.unreadable(a) && 'border-red-500/60 bg-red-500/10',
          )}
        >
          <AttachmentIcon attachment={a} />
          <span className="min-w-0 truncate">{a.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove ${a.name}`}
            onClick={() => intake.remove(a._id)}
          >
            <XIcon />
          </Button>
        </li>
      ))}
      {intake.uploads.map((u) => (
        <li key={u.key} className={cn(chip, 'flex-col items-start gap-1 py-1')}>
          <span className="max-w-full truncate">{u.name}</span>
          <progress
            aria-label={`Uploading ${u.name}`}
            value={u.progress}
            className="h-1 w-24 accent-sky-500"
          />
        </li>
      ))}
    </ul>
  )
}

function AttachmentIcon({ attachment }: { attachment: Attachment }) {
  return kindOf(attachment.mediaType) === 'image' ? (
    <img
      src={attachmentUrl(attachment._id)}
      alt=""
      className="size-7 shrink-0 rounded object-cover"
    />
  ) : (
    <FileTextIcon className="size-4 shrink-0 text-zinc-400" />
  )
}

/** A Prompt's Attachments: image thumbnails that open a lightbox, and chips that open PDFs and text in a new tab. */
export function PromptAttachments({
  attachments,
}: {
  attachments: Attachment[]
}) {
  if (!attachments.length) return null

  return (
    <ul className="flex max-w-[85%] flex-wrap justify-end gap-1.5 pb-1.5">
      {attachments.map((a) => (
        <li key={a._id}>
          {kindOf(a.mediaType) === 'image' ? (
            <Lightbox attachment={a} />
          ) : (
            <a
              href={attachmentUrl(a._id)}
              target="_blank"
              rel="noreferrer"
              className={cn(chip, 'hover:bg-zinc-800')}
            >
              <AttachmentIcon attachment={a} />
              <span className="min-w-0 truncate">{a.name}</span>
              <span className="shrink-0 text-zinc-500">
                {formatSize(a.size)}
              </span>
            </a>
          )}
        </li>
      ))}
    </ul>
  )
}

function Lightbox({ attachment }: { attachment: Attachment }) {
  const src = attachmentUrl(attachment._id)

  return (
    <Dialog.Root>
      <Dialog.Trigger
        aria-label={`Open ${attachment.name}`}
        className="block overflow-hidden rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <img src={src} alt={attachment.name} className="size-32 object-cover" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/80" />
        <Dialog.Popup className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none">
          <Dialog.Title className="sr-only">{attachment.name}</Dialog.Title>
          <Dialog.Close
            aria-label="Close"
            className="absolute top-4 right-4 rounded-md p-1 text-zinc-300 hover:bg-zinc-800"
          >
            <XIcon />
          </Dialog.Close>
          <img
            src={src}
            alt={attachment.name}
            className="max-h-full max-w-full object-contain"
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
