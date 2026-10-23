import type { Id } from '@/convex/_generated/dataModel'
import { createIsomorphicFn } from '@tanstack/react-start'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '@/convex/_generated/api'
import { CONVEX_ORIGIN } from '~/lib/convex-origin'

/** Enough to fill the sidebar and the bottom of the Thread view on first paint. */
const PRELOAD_THREADS = 20
const PRELOAD_MESSAGES = 5

/**
 * Query results the server renders the first HTML with, so a reload doesn't
 * paint an empty shell while the websocket connects. In the browser the
 * websocket is already up, so these fetch nothing.
 */
const preloader = <Args extends unknown[], T>(
  load: (convex: ConvexHttpClient, ...args: Args) => Promise<T>,
) =>
  createIsomorphicFn()
    .server(async (token: string | null, ...args: Args) => {
      if (!token) return undefined
      const convex = new ConvexHttpClient(CONVEX_ORIGIN, { auth: token })
      // Best effort: the live queries still load whatever fails here.
      return await load(convex, ...args).catch(() => undefined)
    })
    .client(() => undefined)

/** The sidebar and the signed-in User. */
export const preloadShell = preloader(async (convex) => {
  const [pinned, threads, liveThreadIds, me] = await Promise.all([
    convex.query(api.threads.pinned),
    convex.query(api.threads.list, {
      paginationOpts: { numItems: PRELOAD_THREADS, cursor: null },
    }),
    convex.query(api.liveAnswers.threadIds),
    convex.query(api.users.me),
  ])
  // The server's local day, which the sidebar groups Threads by until hydrated.
  const today = new Date().setHours(0, 0, 0, 0)
  return { pinned, threads: threads.page, liveThreadIds, me, today }
})

/** The Thread view, or the composer alone for a new Thread. */
export const preloadChat = preloader(
  async (convex, threadId?: Id<'threads'>) => {
    const [messages, live, thread, options] = await Promise.all([
      threadId
        ? convex.query(api.threads.messages, {
            threadId,
            limit: PRELOAD_MESSAGES,
          })
        : undefined,
      threadId ? convex.query(api.liveAnswers.get, { threadId }) : undefined,
      threadId ? convex.query(api.threads.get, { threadId }) : undefined,
      convex.query(api.models.options, { threadId }),
    ])
    return { messages, live, thread, options }
  },
)

export type ChatPreload = Awaited<ReturnType<typeof preloadChat>>

/** The live result once the websocket answers, the preloaded one until then. */
export const orPreloaded = <T>(
  live: T | undefined,
  preloaded: T | undefined,
) => (live === undefined ? preloaded : live)
