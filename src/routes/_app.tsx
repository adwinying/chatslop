import { createFileRoute, Outlet } from '@tanstack/react-router'
import { AppShell } from '~/components/app-sidebar'
import { preloadShell } from '~/lib/preload'

export const Route = createFileRoute('/_app')({
  loader: ({ context }) => preloadShell(context.token),
  component: AppLayout,
})

function AppLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
