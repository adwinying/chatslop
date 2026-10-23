import { createFileRoute } from '@tanstack/react-router'
import { Chat } from '~/components/chat'
import { preloadChat } from '~/lib/preload'

export const Route = createFileRoute('/_app/')({
  loader: ({ context }) => preloadChat(context.token),
  component: NewThreadPage,
})

function NewThreadPage() {
  return <Chat preloaded={Route.useLoaderData()} />
}
