// Browsers reach Convex only through this route (ADR 0001). Only the sync
// socket and file storage pass; the admin API on :3210 stays unreachable.
// The route sits under /convex/api so it never shadows the dev server's
// /convex/* source modules (convex/_generated/api.js and friends).
import { createWebSocketProxy } from 'crossws'
import { defineHandler, defineWebSocketHandler, HTTPError } from 'nitro'
import { proxyRequest } from 'nitro/h3'
import { CONVEX_ORIGIN } from '~/lib/convex-origin'

const SYNC = /^\/api\/\d+\.\d+\.\d+\/sync$/
const STORAGE = /^\/api\/storage\//

/** The pathname Convex serves: `/convex/api/…` → `/api/…`. */
const stripPrefix = (url: URL) => url.pathname.slice('/convex'.length)
const upstreamPath = (url: URL) => stripPrefix(url) + url.search

const sync = createWebSocketProxy({
  target: (peer) =>
    CONVEX_ORIGIN.replace(/^http/, 'ws') +
    upstreamPath(new URL(peer.request.url)),
  // Compression on the loopback leg only costs CPU.
  webSocketOptions: { perMessageDeflate: false },
})

export default defineWebSocketHandler(
  {
    ...sync,
    upgrade(request) {
      if (!SYNC.test(stripPrefix(new URL(request.url)))) {
        throw new Response('Not found', { status: 404 })
      }
      return sync.upgrade?.(request)
    },
  },
  defineHandler((event) => {
    if (!STORAGE.test(stripPrefix(event.url))) {
      throw new HTTPError('Not found', { status: 404 })
    }
    return proxyRequest(event, CONVEX_ORIGIN + upstreamPath(event.url))
  }),
)
