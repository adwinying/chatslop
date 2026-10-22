import { createFileRoute } from '@tanstack/react-router'
import { Chat } from '~/components/chat'

export const Route = createFileRoute('/')({
  component: Chat,
})
