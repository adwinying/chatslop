import type { Id } from '@/convex/_generated/dataModel'
import { createFileRoute } from '@tanstack/react-router'
import { Chat } from '~/components/chat'

export const Route = createFileRoute('/chat/$threadId')({
  component: ThreadPage,
})

function ThreadPage() {
  const { threadId } = Route.useParams()
  // Convex validates the ID; a malformed one fails like a missing Thread.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return <Chat key={threadId} threadId={threadId as Id<'threads'>} />
}
