import type { Doc } from '@/convex/_generated/dataModel'
import type { ReactNode } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { usePaginatedQuery, useQuery } from 'convex/react'
import {
  Loader2Icon,
  LogOutIcon,
  MenuIcon,
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
} from 'react'
import { api } from '@/convex/_generated/api'
import {
  DeleteButton,
  PinButton,
  RenameButton,
  TitleInput,
} from '~/components/thread-actions'
import { Button, buttonVariants } from '~/components/ui/button'
import { authClient } from '~/lib/auth-client'
import { cn } from '~/lib/utils'

const PAGE_SIZE = 50

const OpenSidebar = createContext<(opener: HTMLElement) => void>(() => {})

/**
 * The sidebar beside every signed-in page. It stays mounted across
 * navigation, and on phones its overlay closes when the page changes.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const path = useLocation({ select: (location) => location.pathname })
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
        <ThreadList />
        <UserFooter />
      </aside>
    </>
  )
}

function ThreadList() {
  const pinned = useQuery(api.threads.pinned)
  const { results, status, loadMore } = usePaginatedQuery(
    api.threads.list,
    {},
    { initialNumItems: PAGE_SIZE },
  )
  const live = new Set(useQuery(api.liveAnswers.threadIds))
  const groups = [
    { label: 'Pinned', threads: pinned ?? [] },
    ...dateGroups(results, useToday()),
  ]

  return (
    <nav
      aria-label="Threads"
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

const DAY = 86_400_000
const startOfToday = () => new Date().setHours(0, 0, 0, 0)

/** The start of the local day, moving on at midnight and when a sleeping tab wakes. */
function useToday() {
  const [today, setToday] = useState(startOfToday)
  useEffect(() => {
    const timer = setInterval(() => setToday(startOfToday()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return today
}

/** Today, Yesterday, Last 7 days, Last 30 days, then Older, by local day; empty groups included. */
export function dateGroups<T extends { lastMessageAt: number }>(
  threads: T[],
  now: number,
) {
  const today = new Date(now).setHours(0, 0, 0, 0)
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
  const me = useQuery(api.users.me)

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
