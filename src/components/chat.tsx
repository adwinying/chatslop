import type { Id } from '@/convex/_generated/dataModel'
import type { Part } from '@/convex/parts'
import type { FunctionReturnType } from 'convex/server'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { MenuIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/convex/_generated/api'
import { reasoningLevelFor } from '@/convex/reasoning'
import { Answer } from '~/components/answer'
import { AppSidebar } from '~/components/app-sidebar'
import {
  Composer,
  MESSAGE_ID,
  ReasoningSelect,
  WebSearchToggle,
} from '~/components/composer'
import { ModelPicker } from '~/components/model-picker'
import {
  DeleteButton,
  PinButton,
  TitleInput,
} from '~/components/thread-actions'
import { Button } from '~/components/ui/button'
import { draftKey, useDraft } from '~/lib/draft'
import { cn } from '~/lib/utils'

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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const thread = useQuery(api.threads.get, args)
  const deleted = !!threadId && thread === null && !!me

  // Another tab deleted it.
  useEffect(() => {
    if (deleted) void navigate({ to: '/' })
  }, [deleted, navigate])

  return (
    <div className="flex h-dvh">
      <AppSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <ThreadHeader thread={thread} onMenu={() => setSidebarOpen(true)} />
        {/* Reversed, so the view stays pinned to the newest text as it streams. */}
        <div className="flex flex-1 flex-col-reverse overflow-y-auto px-4 pb-40">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pt-8">
            {!threadId && me && (
              <Greeting name={me.name} draft={draftKey(me.id)} />
            )}
            {messages?.map((message) =>
              message.role === 'user' ? (
                <Prompt key={message._id} parts={message.parts} />
              ) : (
                <Answer
                  key={message._id}
                  parts={message.parts}
                  status={message.status}
                  error={message.error}
                  made={message}
                />
              ),
            )}
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
            onSend={async (text) => {
              if (!model) return
              const id = await send({
                threadId,
                text,
                modelId: model._id,
                reasoningLevel: choices.reasoningLevel,
                webSearch: choices.webSearch,
              })
              if (!threadId)
                await navigate({
                  to: '/chat/$threadId',
                  params: { threadId: id },
                })
            }}
            onStop={() => threadId && void stop({ threadId })}
          />
        </div>
      </main>
    </div>
  )
}

/** The sidebar button on phones, then the open Thread's title (click to rename), pin and delete. */
function ThreadHeader({
  thread,
  onMenu,
}: {
  thread?: FunctionReturnType<typeof api.threads.get>
  onMenu: () => void
}) {
  const [renaming, setRenaming] = useState(false)

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 px-2">
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Open sidebar"
        className="md:hidden"
        onClick={onMenu}
      >
        <MenuIcon />
      </Button>
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

function Prompt({ parts }: { parts: Part[] }) {
  return (
    <article aria-label="Prompt" className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-zinc-800 px-4 py-2.5 whitespace-pre-wrap">
        {parts.map((part) => (part.type === 'text' ? part.text : '')).join('')}
      </div>
    </article>
  )
}
