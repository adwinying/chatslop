import { createFileRoute } from '@tanstack/react-router'
import { Admin } from '~/components/admin'

export const Route = createFileRoute('/_app/admin')({
  component: Admin,
})
