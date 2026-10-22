/// <reference types="vite/client" />
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react"
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  redirect,
  Scripts,
} from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import type { ConvexReactClient } from "convex/react"
import type { ReactNode } from "react"
import { authClient } from "~/lib/auth-client"
import { getToken } from "~/lib/auth-server"
import appCss from "~/styles/app.css?url"

const getAuthToken = createServerFn({ method: "GET" }).handler(() => getToken())

export const Route = createRootRouteWithContext<{
  convex: ConvexReactClient
}>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "chatslop" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  beforeLoad: async ({ location }) => {
    const token = (await getAuthToken()) ?? null
    if (!token && location.pathname !== "/login")
      throw redirect({ to: "/login" })
    return { token }
  },
  component: RootComponent,
  shellComponent: RootDocument,
})

function RootComponent() {
  const { convex, token } = Route.useRouteContext()
  return (
    <ConvexBetterAuthProvider
      client={convex}
      // @ts-expect-error -- @convex-dev/better-auth 0.12.5's AuthClient type collapses the session to `never` on better-auth 1.6.33. Runtime is fine; drop this once upstream fixes the type.
      authClient={authClient}
      initialToken={token}
    >
      <Outlet />
    </ConvexBetterAuthProvider>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
