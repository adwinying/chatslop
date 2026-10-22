import type { Id } from '@/convex/_generated/dataModel'
import type { AttachmentKind } from '@/convex/intake'
import type { Part } from '@/convex/parts'
import type { FunctionReturnType } from 'convex/server'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import {
  type DragEvent,
  Fragment,
  type ReactNode,
  useEffect,
  useState,
} from 'react'
import { toast } from 'sonner'
import { api } from '@/convex/_generated/api'
import { reasoningLevelFor } from '@/convex/reasoning'
import { Answer } from '~/components/answer'
import { SidebarButton } from '~/components/app-sidebar'
import {
  type Intake,
  PromptAttachments,
  useIntake,
} from '~/components/attachments'
import {
  Composer,
  MESSAGE_ID,
  ReasoningSelect,
  WebSearchToggle,
} from '~/components/composer'
import {
  AnswerActions,
  PromptActions,
  PromptEditor,
} from '~/components/message-actions'
import { ModelPicker } from '~/components/model-picker'
import {
  attempt,
  DeleteButton,
  PinButton,
  TitleInput,
} from '~/components/thread-actions'
import {
  type DraftAttachment,
  draftKey,
  useDraft,
  useDraftAttachments,
} from '~/lib/draft'
import { cn } from '~/lib/utils'

/** Runs a regenerate or edit, then toasts how many Messages it removed. */
const truncate = (run: () => Promise<number>) =>
  void attempt(run).then((removed) => {
    if (removed)
      toast(`${removed} ${removed === 1 ? 'Message' : 'Messages'} removed`)
  })

/** The Thread view, or a new Thread without a `threadId`. */
export function Chat({ threadId }: { threadId?: Id<'threads'> }) {
  const navigate = useNavigate()
  const args = threadId ? { threadId } : 'skip'
  const messages = useQuery(api.threads.messages, args)
  const live = useQuery(api.liveAnswers.get, args)
  const send = useMutation(api.threads.send)
  const stop = useMutation(api.threads.stop)
  const choices = useChoices(threadId)
  const { options, model } = choices
  const me = useQuery(api.users.me)
  const draft = me ? draftKey(me.id, threadId) : undefined
  const thread = useQuery(api.threads.get, args)
  const deleted = !!threadId && thread === null && !!me
  const regenerate = useMutation(api.threads.regenerate)
  const edit = useMutation(api.threads.edit)
  const lastAnswer = messages?.findLast((m) => m.role === 'assistant')
  const lastAnswerId = lastAnswer?._id
  const intake = useIntake(useDraftAttachments(draft), model?.attachmentTypes)

  // Another tab deleted it.
  useEffect(() => {
    if (deleted) void navigate({ to: '/' })
  }, [deleted, navigate])

  return (
    <DropZone intake={intake}>
      <ThreadHeader thread={thread} />
      {/* Reversed, so the view stays pinned to the newest text as it streams. */}
      <div className="flex flex-1 flex-col-reverse overflow-y-auto px-4 pb-40">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pt-8">
          {!threadId && me && (
            <Greeting name={me.name} draft={draftKey(me.id)} />
          )}
          {messages?.map((message) => (
            <Fragment key={message._id}>
              {message._id === lastAnswer?.contextStartMessageId && (
                <p className="flex items-center gap-3 text-xs text-zinc-500 before:h-px before:flex-1 before:bg-zinc-800 after:h-px after:flex-1 after:bg-zinc-800">
                  Earlier messages weren't sent to the Model
                </p>
              )}
              {message.role === 'user' ? (
                <Prompt
                  text={textOf(message.parts)}
                  attachments={message.attachments}
                  readable={model?.attachmentTypes}
                  busy={!!live}
                  canSend={!!model}
                  onSend={(text, attachmentIds) =>
                    model &&
                    truncate(() =>
                      edit({
                        promptId: message._id,
                        text,
                        attachmentIds,
                        modelId: model._id,
                        reasoningLevel: choices.reasoningLevel,
                        webSearch: choices.webSearch,
                      }),
                    )
                  }
                />
              ) : (
                <Answer
                  parts={message.parts}
                  status={message.status}
                  error={message.error}
                  made={message}
                  actions={
                    <AnswerActions
                      text={textOf(message.parts)}
                      modelId={message.modelId}
                      options={options}
                      always={
                        message._id === lastAnswerId ||
                        message.status === 'error'
                      }
                      disabled={!!live}
                      onRegenerate={(modelId) =>
                        truncate(() =>
                          regenerate({ answerId: message._id, modelId }),
                        )
                      }
                    />
                  }
                />
              )}
            </Fragment>
          ))}
          {live && <Answer parts={live.parts} streaming />}
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 px-2 sm:px-4">
        <Composer
          draftKey={draft}
          streaming={!!live}
          blockReason={
            options === undefined
              ? 'Loading Models…'
              : model
                ? undefined
                : 'No Model to send with. Ask an Admin to enable one.'
          }
          controls={
            options &&
            model && (
              <>
                <ModelPicker
                  options={options}
                  model={model}
                  onPick={(modelId) => choices.pick({ modelId })}
                />
                {choices.reasoningLevel && (
                  <ReasoningSelect
                    levels={model.reasoningLevels}
                    value={choices.reasoningLevel}
                    onChange={(reasoningLevel) =>
                      choices.pick({ reasoningLevel })
                    }
                  />
                )}
                <WebSearchToggle
                  on={choices.webSearch}
                  onChange={(webSearch) => choices.pick({ webSearch })}
                />
              </>
            )
          }
          intake={intake}
          onSend={async (text) => {
            if (!model) return
            const attachmentIds = intake.attachments.map((a) => a._id)
            const id = await send({
              threadId,
              text,
              attachmentIds,
              modelId: model._id,
              reasoningLevel: choices.reasoningLevel,
              webSearch: choices.webSearch,
            })
            intake.setAttachments((list) =>
              list.filter((a) => !attachmentIds.includes(a._id)),
            )
            if (!threadId)
              await navigate({
                to: '/chat/$threadId',
                params: { threadId: id },
              })
          }}
          onStop={() => threadId && void stop({ threadId })}
        />
      </div>
    </DropZone>
  )
}

const hasFiles = (event: DragEvent) =>
  event.dataTransfer.types.includes('Files')

/** The Thread view, which attaches files dropped anywhere on it. */
function DropZone({
  intake,
  children,
}: {
  intake: Intake
  children: ReactNode
}) {
  const [dragging, setDragging] = useState(false)

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- dropping is a pointer shortcut; Attach and paste serve keyboards.
    <main
      className="relative flex min-w-0 flex-1 flex-col"
      onDragOver={(event) => {
        if (!hasFiles(event)) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setDragging(false)
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return
        event.preventDefault()
        setDragging(false)
        intake.add([...event.dataTransfer.files])
      }}
    >
      {children}
      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-sky-500/60 bg-zinc-950/80 text-sm text-zinc-200">
          Drop files to attach
        </div>
      )}
    </main>
  )
}

/** The sidebar button on phones, then the open Thread's title (click to rename), pin and delete. */
function ThreadHeader({
  thread,
}: {
  thread?: FunctionReturnType<typeof api.threads.get>
}) {
  const [renaming, setRenaming] = useState(false)

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 px-2">
      <SidebarButton />
      {thread &&
        (renaming ? (
          <TitleInput
            thread={thread}
            onDone={() => setRenaming(false)}
            className="flex-1"
          />
        ) : (
          <>
            <button
              type="button"
              title="Rename"
              onClick={() => setRenaming(true)}
              className={cn(
                'min-w-0 truncate rounded-md px-2 py-1 text-sm font-medium hover:bg-zinc-800',
                thread.titlePending && 'animate-pulse',
              )}
            >
              {thread.title}
            </button>
            <div className="ml-auto flex">
              <PinButton thread={thread} />
              <DeleteButton thread={thread} />
            </div>
          </>
        ))}
    </header>
  )
}

/**
 * The composer's Model, Reasoning level and Web search: what the User picked
 * here, else the remembered choices. A pick that stops being usable falls
 * back the same way, and the level is re-resolved for each Model.
 */
function useChoices(threadId?: Id<'threads'>) {
  const options = useQuery(api.models.options, { threadId })
  const [picked, setPicked] = useState<{
    modelId?: Id<'models'>
    reasoningLevel?: string
    webSearch?: boolean
  }>({})
  const byId = (id?: Id<'models'> | null) =>
    options?.models.find((m) => m._id === id)
  const model = byId(picked.modelId) ?? byId(options?.modelId)

  return {
    options,
    model,
    reasoningLevel:
      model &&
      reasoningLevelFor(
        model.reasoningLevels,
        picked.reasoningLevel ?? options?.reasoningLevel,
      ),
    webSearch: picked.webSearch ?? options?.webSearch ?? false,
    pick: (choice: typeof picked) => setPicked({ ...picked, ...choice }),
  }
}

const SUGGESTIONS = [
  'Explain Convex search indexes',
  '京都の紅葉、いつが見頃？',
  'Write a Caddyfile for a WebSocket app',
  'Compare TCP and QUIC in a table',
]

function Greeting({ name, draft }: { name: string; draft: string }) {
  const [, setDraft] = useDraft(draft)

  return (
    <div className="mt-[12vh] w-full max-w-xl self-center">
      <h1 className="text-3xl font-semibold">How can I help you, {name}?</h1>
      <ul className="mt-6">
        {SUGGESTIONS.map((suggestion) => (
          <li key={suggestion}>
            <button
              type="button"
              onClick={() => {
                setDraft(suggestion)
                document.getElementById(MESSAGE_ID)?.focus()
              }}
              className="w-full border-b border-zinc-800 px-2 py-2.5 text-left text-sm text-zinc-300 hover:bg-zinc-900"
            >
              {suggestion}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

const textOf = (parts: Part[]) =>
  parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')

/** A Prompt bubble under its Attachments, with Edit and Copy, which becomes an editor in place. */
function Prompt({
  text,
  attachments,
  readable,
  busy,
  canSend,
  onSend,
}: {
  text: string
  attachments: DraftAttachment[]
  readable?: AttachmentKind[]
  /** While the Thread has a Live answer. */
  busy: boolean
  canSend: boolean
  onSend: (text: string, attachmentIds: Id<'attachments'>[]) => void
}) {
  const [editing, setEditing] = useState(false)

  return (
    <article aria-label="Prompt" className="group flex flex-col items-end">
      {editing ? (
        <PromptEditor
          text={text}
          attachments={attachments}
          readable={readable}
          disabled={busy || !canSend}
          onSend={(edited, attachmentIds) => {
            setEditing(false)
            onSend(edited, attachmentIds)
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <PromptAttachments attachments={attachments} />
          {text && (
            <div className="max-w-[85%] rounded-2xl bg-zinc-800 px-4 py-2.5 whitespace-pre-wrap">
              {text}
            </div>
          )}
          <PromptActions
            text={text}
            disabled={busy}
            onEdit={() => setEditing(true)}
          />
        </>
      )}
    </article>
  )
}
