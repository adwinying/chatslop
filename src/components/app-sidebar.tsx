import type { Doc } from '@/convex/_generated/dataModel'
import type { ReactNode } from 'react'
import { getRouteApi, Link, useLocation } from '@tanstack/react-router'
import { usePaginatedQuery, useQuery } from 'convex/react'
import {
  Loader2Icon,
  LogOutIcon,
  MenuIcon,
  SearchIcon,
  SettingsIcon,
  XIcon,
} from 'lucide-react'
import {
  createContext,
  use,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { api } from '@/convex/_generated/api'
import { queryPattern } from '@/convex/searchText'
import {
  DeleteButton,
  PinButton,
  RenameButton,
  TitleInput,
} from '~/components/thread-actions'
import { Button, buttonVariants } from '~/components/ui/button'
import { authClient } from '~/lib/auth-client'
import { orPreloaded } from '~/lib/preload'
import { cn } from '~/lib/utils'

const PAGE_SIZE = 50
/** Search results re-run whenever indexed documents change, so typing waits this long. */
const SEARCH_DEBOUNCE_MS = 300

const appRoute = getRouteApi('/_app')

const OpenSidebar = createContext<(opener: HTMLElement) => void>(() => {})

/**
 * The sidebar beside every signed-in page. It stays mounted across
 * navigation, and on phones its overlay closes when the page changes.
 */
export function AppShell({ children }: { children: ReactNode }) {
  // With the hash, so jumping to a Message in the open Thread closes it too.
  const path = useLocation({
    select: (location) => location.pathname + location.hash,
  })
  const [opened, setOpened] = useState<{ opener: HTMLElement; path: string }>()
  const close = () => {
    opened?.opener.focus()
    setOpened(undefined)
  }

  return (
    <OpenSidebar value={(opener) => setOpened({ opener, path })}>
      <div className="flex h-dvh">
        <AppSidebar open={opened?.path === path} onClose={close} />
        {children}
      </div>
    </OpenSidebar>
  )
}

/** Opens the sidebar on phones. */
export function SidebarButton() {
  const open = use(OpenSidebar)

  return (
    <Button
      variant="ghost"
      size="icon-lg"
      aria-label="Open sidebar"
      className="md:hidden"
      onClick={(event) => open(event.currentTarget)}
    >
      <MenuIcon />
    </Button>
  )
}

/** Persistent from `md` up; an overlay on phones while `open`. */
function AppSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null)
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS)
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (open && event.key === 'Escape') onClose()
  })

  useEffect(() => {
    if (open) closeButton.current?.focus()
  }, [open])

  useEffect(() => {
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      {open && (
        <div
          aria-hidden
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-72 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:static md:flex',
          open ? 'flex' : 'hidden',
        )}
      >
        <div className="relative flex items-center justify-center gap-1 px-3 pt-4 pb-2 font-semibold tracking-tight">
          <img src="/favicon.svg" alt="" className="size-5" />
          chatslop
          <Button
            ref={closeButton}
            variant="ghost"
            size="icon-lg"
            aria-label="Close sidebar"
            className="absolute top-2.5 right-2 md:hidden"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </div>
        <div className="px-3">
          <Link
            to="/"
            className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
            onClick={onClose}
          >
            New Chat
          </Link>
        </div>
        <SearchBox query={query} onChange={setQuery} />
        {/* Hidden, not unmounted, while searching, so it keeps its loaded
            pages and live results instead of falling back to the preload. */}
        <ThreadList hidden={!!query.trim()} />
        {query.trim() && <SearchResults query={debounced} />}
        <UserFooter />
      </aside>
    </>
  )
}

function ThreadList({ hidden }: { hidden: boolean }) {
  const preloaded = appRoute.useLoaderData()
  const pinned = orPreloaded(useQuery(api.threads.pinned), preloaded?.pinned)
  const { results, status, loadMore } = usePaginatedQuery(
    api.threads.list,
    {},
    { initialNumItems: PAGE_SIZE },
  )
  const recent =
    status === 'LoadingFirstPage' ? (preloaded?.threads ?? []) : results
  const live = new Set(
    orPreloaded(useQuery(api.liveAnswers.threadIds), preloaded?.liveThreadIds),
  )
  const groups = [
    { label: 'Pinned', threads: pinned ?? [] },
    ...dateGroups(recent, useToday(preloaded?.today)),
  ]

  return (
    <nav
      aria-label="Threads"
      hidden={hidden}
      className="flex-1 overflow-y-auto px-2 py-2 text-sm"
    >
      {groups.map(
        ({ label, threads }) =>
          threads.length > 0 && (
            <section key={label} aria-label={label} className="mb-3">
              <h2 className="px-2 py-1 text-xs font-medium text-brand-300">
                {label}
              </h2>
              <ul>
                {threads.map((thread) => (
                  <ThreadRow
                    key={thread._id}
                    thread={thread}
                    live={live.has(thread._id)}
                  />
                ))}
              </ul>
            </section>
          ),
      )}
      {status === 'CanLoadMore' && (
        <Button
          variant="ghost"
          className="w-full text-zinc-400"
          onClick={() => loadMore(PAGE_SIZE)}
        >
          Show more
        </Button>
      )}
    </nav>
  )
}

function SearchBox({
  query,
  onChange,
}: {
  query: string
  onChange: (query: string) => void
}) {
  return (
    <div className="mx-3 mt-3 flex items-center gap-2 border-b border-sidebar-border pb-2 text-zinc-500">
      <SearchIcon aria-hidden className="size-3.5 shrink-0" />
      <input
        type="search"
        aria-label="Search Threads"
        placeholder="Search your Threads…"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500 [&::-webkit-search-cancel-button]:hidden"
      />
      {query && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Clear search"
          onClick={() => onChange('')}
        >
          <XIcon />
        </Button>
      )}
    </div>
  )
}

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

/** Scrolls a shown Message to the center and focuses it, which flashes it. */
export function jumpToMessage(id: string) {
  const message = document.getElementById(id)
  message?.scrollIntoView({ block: 'center' })
  message?.focus({ preventScroll: true })
}

/** Thread search hits in place of the list: the title, then the best matching Message. */
function SearchResults({ query }: { query: string }) {
  const hits = useQuery(api.search.threads, query ? { query } : 'skip')

  return (
    <nav
      aria-label="Threads"
      aria-busy={hits === undefined}
      className="flex-1 overflow-y-auto px-2 py-2 text-sm"
    >
      {hits?.length === 0 && (
        <p className="px-3 py-6 text-center text-zinc-500">
          No Threads match “{query}”.
        </p>
      )}
      <ul>
        {hits?.map(({ _id, title, message }) => (
          <li key={_id} className="rounded-md px-2 py-1.5 hover:bg-zinc-800/60">
            <Link
              to="/chat/$threadId"
              params={{ threadId: _id }}
              className="block truncate font-medium text-zinc-300"
            >
              <Highlight text={title} query={query} />
            </Link>
            {message && (
              <Link
                to="/chat/$threadId"
                params={{ threadId: _id }}
                hash={message._id}
                // Clicked again, the URL stays the same and the Thread view
                // gets no new hash to jump on, so jump here when it's shown.
                onClick={() => jumpToMessage(message._id)}
                className="mt-0.5 line-clamp-2 text-xs text-zinc-400 hover:text-zinc-200"
              >
                <Highlight text={message.snippet} query={query} />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  )
}

function Highlight({ text, query }: { text: string; query: string }) {
  // Split on a capturing pattern, so the matches land at odd indexes.
  const pieces = text.split(
    new RegExp(`(${queryPattern(query).source})`, 'giu'),
  )
  return pieces.map((piece, i) =>
    i % 2 ? (
      <mark key={i} className="rounded bg-brand-500/30 text-brand-100">
        {piece}
      </mark>
    ) : (
      piece
    ),
  )
}

const DAY = 86_400_000
const startOfToday = () => new Date().setHours(0, 0, 0, 0)

const everyMinute = (tick: () => void) => {
  const timer = setInterval(tick, 60_000)
  return () => clearInterval(timer)
}

/**
 * The start of the local day, moving on at midnight and when a sleeping tab
 * wakes. Hydration keeps the server's day, whose timezone may differ.
 */
function useToday(serverToday?: number) {
  return useSyncExternalStore(
    everyMinute,
    startOfToday,
    () => serverToday ?? startOfToday(),
  )
}

/** Today, Yesterday, Last 7 days, Last 30 days, then Older, from the start of `today`; empty groups included. */
export function dateGroups<T extends { lastMessageAt: number }>(
  threads: T[],
  today: number,
) {
  const groups = [
    { label: 'Today', since: today },
    { label: 'Yesterday', since: today - DAY },
    { label: 'Last 7 days', since: today - 7 * DAY },
    { label: 'Last 30 days', since: today - 30 * DAY },
    { label: 'Older', since: -Infinity },
  ].map((group) => ({ ...group, threads: [] as T[] }))
  for (const thread of threads)
    groups.find((g) => thread.lastMessageAt >= g.since)!.threads.push(thread)
  return groups
}

function ThreadRow({
  thread,
  live,
}: {
  thread: Doc<'threads'>
  live: boolean
}) {
  const [renaming, setRenaming] = useState(false)

  if (renaming)
    return (
      <li className="py-0.5">
        <TitleInput
          thread={thread}
          onDone={() => setRenaming(false)}
          className="w-full"
        />
      </li>
    )

  return (
    <li className="group relative">
      <Link
        to="/chat/$threadId"
        params={{ threadId: thread._id }}
        onDoubleClick={() => setRenaming(true)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-zinc-300 hover:bg-zinc-800/60 data-[status=active]:bg-zinc-800 data-[status=active]:text-zinc-100"
      >
        <span
          className={cn('truncate', thread.titlePending && 'animate-pulse')}
        >
          {thread.title}
        </span>
        {live && (
          <Loader2Icon
            aria-label="Answering"
            className="ml-auto size-3.5 shrink-0 animate-spin text-zinc-400"
          />
        )}
      </Link>
      {/* Covers the end of the row on hover, the spinner included. */}
      <div className="absolute inset-y-0 right-0 hidden items-center rounded-r-md bg-zinc-800 pr-0.5 group-focus-within:flex group-hover:flex">
        <PinButton thread={thread} />
        <RenameButton onClick={() => setRenaming(true)} />
        <DeleteButton thread={thread} />
      </div>
    </li>
  )
}

// expectAuth makes a plain reload the only safe way back to signed out.
async function signOut() {
  await authClient.signOut()
  location.reload()
}

function UserFooter() {
  const me = orPreloaded(useQuery(api.users.me), appRoute.useLoaderData()?.me)

  return (
    <div className="flex items-center gap-2 border-t border-sidebar-border p-3 text-sm">
      <div className="grid size-8 place-items-center rounded-full bg-brand-600 font-semibold uppercase">
        {me?.name.charAt(0)}
      </div>
      <div className="leading-tight">
        <div>{me?.name}</div>
        <div className="text-xs text-muted-foreground">
          {me && (me.role === 'admin' ? 'Admin' : 'User')}
        </div>
      </div>
      <div className="ml-auto flex">
        {me?.role === 'admin' && (
          <Link
            to="/admin"
            aria-label="Admin"
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
          >
            <SettingsIcon />
          </Link>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Log out"
          onClick={signOut}
        >
          <LogOutIcon />
        </Button>
      </div>
    </div>
  )
}
