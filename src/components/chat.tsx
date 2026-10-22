import type { Id } from '@/convex/_generated/dataModel'
import type { Part } from '@/convex/parts'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { Answer } from '~/components/answer'
import { AppSidebar } from '~/components/app-sidebar'
import { Composer } from '~/components/composer'

/** The Thread view, or a new Thread without a `threadId`. */
export function Chat({ threadId }: { threadId?: Id<'threads'> }) {
  const navigate = useNavigate()
  const args = threadId ? { threadId } : 'skip'
  const messages = useQuery(api.threads.messages, args)
  const live = useQuery(api.liveAnswers.get, args)
  const send = useMutation(api.threads.send)
  const stop = useMutation(api.threads.stop)

  return (
    <div className="flex h-dvh">
      <AppSidebar />
      <main className="relative flex flex-1 flex-col">
        {/* Reversed, so the view stays pinned to the newest text as it streams. */}
        <div className="flex flex-1 flex-col-reverse overflow-y-auto px-4 pb-40">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pt-8">
            {messages?.map((message) =>
              message.role === 'user' ? (
                <Prompt key={message._id} parts={message.parts} />
              ) : (
                <Answer
                  key={message._id}
                  parts={message.parts}
                  status={message.status}
                  error={message.error}
                />
              ),
            )}
            {live && <Answer parts={live.parts} streaming />}
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 px-2 sm:px-4">
          <Composer
            streaming={!!live}
            onSend={async (text) => {
              const id = await send({ threadId, text })
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

function Prompt({ parts }: { parts: Part[] }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl bg-zinc-800 px-4 py-2.5 whitespace-pre-wrap">
        {parts.map((part) => (part.type === 'text' ? part.text : '')).join('')}
      </div>
    </div>
  )
}
