import { createFileRoute } from '@tanstack/react-router'
import { getToken } from '~/lib/auth-server'
import { CONVEX_ORIGIN } from '~/lib/convex-origin'

// fetch has already decoded the body, so encoding and length headers would lie.
const PASSED_HEADERS = [
  'Content-Type',
  'Content-Disposition',
  'X-Content-Type-Options',
  'Cache-Control',
]

/**
 * An Attachment's file, for the User who owns it. The session cookie becomes
 * a Convex token, and the Convex HTTP action checks ownership and streams the
 * blob, which passes through unbuffered. The browser never sees a storage ID.
 */
export const Route = createFileRoute('/api/attachments/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const token = await getToken()
        if (!token) return new Response('Log in first', { status: 401 })
        const upstream = await fetch(
          `${CONVEX_ORIGIN}/http/attachments/${encodeURIComponent(params.id)}`,
          { headers: { Authorization: `Bearer ${token}` } },
        )
        const headers = new Headers()
        for (const name of PASSED_HEADERS) {
          const value = upstream.headers.get(name)
          if (value) headers.set(name, value)
        }
        return new Response(upstream.body, { status: upstream.status, headers })
      },
    },
  },
})
