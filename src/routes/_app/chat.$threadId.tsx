import type { Id } from '@/convex/_generated/dataModel'
import { createFileRoute } from '@tanstack/react-router'
import { Chat } from '~/components/chat'
import { preloadChat } from '~/lib/preload'

// Convex validates the ID; a malformed one fails like a missing Thread.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const threadIdOf = (param: string) => param as Id<'threads'>

export const Route = createFileRoute('/_app/chat/$threadId')({
  loader: ({ context, params }) =>
    preloadChat(context.token, threadIdOf(params.threadId)),
  component: ThreadPage,
})

function ThreadPage() {
  const threadId = threadIdOf(Route.useParams().threadId)
  return (
    <Chat
      key={threadId}
      threadId={threadId}
      preloaded={Route.useLoaderData()}
    />
  )
}
