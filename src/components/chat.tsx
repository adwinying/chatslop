import type { Id } from '@/convex/_generated/dataModel'
import type { AttachmentKind } from '@/convex/intake'
import type { FunctionReturnType } from 'convex/server'
import { getRouteApi, useLocation, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { Fragment, type ReactNode, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { api } from '@/convex/_generated/api'
import { reasoningLevelFor } from '@/convex/reasoning'
import { Answer, textOf } from '~/components/answer'
import { jumpToMessage, SidebarButton } from '~/components/app-sidebar'
import {
  hasFiles,
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
  useDraftUploads,
} from '~/lib/draft'
import { type ChatPreload, orPreloaded } from '~/lib/preload'
import { cn } from '~/lib/utils'

const appRoute = getRouteApi('/_app')

/** Runs a regenerate or edit, then toasts how many Messages it removed. True once it succeeds. */
async function truncate(run: () => Promise<number>) {
  const removed = await attempt(run)
  if (removed)
    toast(`${removed} ${removed === 1 ? 'Message' : 'Messages'} removed`)
  return removed !== undefined
}

/** The Thread view, or a new Thread without a `threadId`. */
export function Chat({
  threadId,
  preloaded,
}: {
  threadId?: Id<'threads'>
  preloaded?: ChatPreload
}) {
  const navigate = useNavigate()
  const shell = appRoute.useLoaderData()
  const args = threadId ? { threadId } : 'skip'
  // A Thread search hit links to its Message by hash, which can be older
  // than the newest Messages, so it loads on its own.
  const hash = useLocation({ select: (location) => location.hash })
  const latest = orPreloaded(
    useQuery(api.threads.messages, args),
    preloaded?.messages,
  )
  const hitArgs = threadId && hash ? { threadId, messageId: hash } : 'skip'
  const hit = useQuery(api.threads.message, hitArgs)
  const messages =
    hit && latest && !latest.some((m) => m._id === hit._id)
      ? [hit, ...latest]
      : latest
  const live = orPreloaded(useQuery(api.liveAnswers.get, args), preloaded?.live)
  const send = useMutation(api.threads.send)
  const stop = useMutation(api.threads.stop)
  const choices = useChoices(threadId, preloaded?.options)
  const { options, model } = choices
  const me = orPreloaded(useQuery(api.users.me), shell?.me)
  const draft = me ? draftKey(me.id, threadId) : undefined
  const thread = orPreloaded(useQuery(api.threads.get, args), preloaded?.thread)
  const deleted = !!threadId && thread === null && !!me
  const regenerate = useMutation(api.threads.regenerate)
  const edit = useMutation(api.threads.edit)
  const lastAnswer = messages?.findLast((m) => m.role === 'assistant')
  const lastAnswerId = lastAnswer?._id
  const draftIntake = useIntake(
    useDraftAttachments(draft),
    useDraftUploads(draft),
    model?.attachmentTypes,
  )
  // Until the Draft is known, an upload would have nowhere to go.
  const intake = draft ? draftIntake : undefined

  // Another tab deleted it.
  useEffect(() => {
    if (deleted) void navigate({ to: '/' })
  }, [deleted, navigate])

  // Jump to the search hit once loaded.
  const loaded =
    latest !== undefined && (hitArgs === 'skip' || hit !== undefined)
  useEffect(() => {
    if (loaded && hash) jumpToMessage(hash)
  }, [hash, loaded])

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
              {/* Focused by a search jump, which flashes it. */}
              <div
                id={message._id}
                tabIndex={-1}
                className="rounded-xl outline-none focus:animate-flash"
              >
                {message.role === 'user' ? (
                  <Prompt
                    text={textOf(message.parts)}
                    attachments={message.attachments}
                    readable={model?.attachmentTypes}
                    busy={!!live}
                    canSend={!!model}
                    onSend={async (text, attachmentIds) =>
                      !!model &&
                      (await truncate(() =>
                        edit({
                          promptId: message._id,
                          text,
                          attachmentIds,
                          modelId: model._id,
                          reasoningLevel: choices.reasoningLevel,
                          webSearch: choices.webSearch,
                        }),
                      ))
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
                          void truncate(() =>
                            regenerate({ answerId: message._id, modelId }),
                          )
                        }
                      />
                    }
                  />
                )}
              </div>
            </Fragment>
          ))}
          {live && <Answer key={live._id} parts={live.parts} streaming />}
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
            const attachmentIds = draftIntake.attachments.map((a) => a._id)
            const id = await send({
              threadId,
              text,
              attachmentIds,
              modelId: model._id,
              reasoningLevel: choices.reasoningLevel,
              webSearch: choices.webSearch,
            })
            draftIntake.setAttachments((list) =>
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

/** The Thread view, which attaches files dropped anywhere on it. */
function DropZone({
  intake,
  children,
}: {
  intake?: Intake
  children: ReactNode
}) {
  const [dragging, setDragging] = useState(false)

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- dropping is a pointer shortcut; Attach and paste serve keyboards.
    <main
      className="relative flex min-w-0 flex-1 flex-col"
      onDragOver={(event) => {
        if (!intake || !hasFiles(event)) return
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
        setDragging(false)
        intake?.drop(event)
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
function useChoices(
  threadId?: Id<'threads'>,
  preloaded?: FunctionReturnType<typeof api.models.options>,
) {
  const options = orPreloaded(
    useQuery(api.models.options, { threadId }),
    preloaded,
  )
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
  /** Resolves true once the edit succeeds. */
  onSend: (text: string, attachmentIds: Id<'attachments'>[]) => Promise<boolean>
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
          // Stays open on refusal, keeping the edited text and Attachments.
          onSend={async (edited, attachmentIds) => {
            if (await onSend(edited, attachmentIds)) setEditing(false)
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
