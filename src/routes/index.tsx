import { createFileRoute } from "@tanstack/react-router"
import { AppSidebar } from "~/components/app-sidebar"

export const Route = createFileRoute("/")({
  component: Home,
})

function Home() {
  return (
    <div className="flex h-dvh">
      <AppSidebar />
      <main className="flex-1" />
    </div>
  )
}
