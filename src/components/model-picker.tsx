import type { Id } from '@/convex/_generated/dataModel'
import type { FunctionReturnType } from 'convex/server'
import type { KeyboardEvent } from 'react'
import { Popover } from '@base-ui/react/popover'
import { useMutation } from 'convex/react'
import {
  AsteriskIcon,
  ChevronDownIcon,
  HexagonIcon,
  SearchIcon,
  StarIcon,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { api } from '@/convex/_generated/api'
import { cn } from '~/lib/utils'

export type Options = NonNullable<FunctionReturnType<typeof api.models.options>>
type Model = Options['models'][number]

/** The Model button and its popover: Favorites, one tab per Provider, and name search. */
export function ModelPicker({
  options,
  model,
  onPick,
}: {
  options: Options
  model: Model
  onPick: (modelId: Id<'models'>) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`Model: ${model.name}`}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm outline-none hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <ProviderIcon options={options} providerId={model.providerId} />
        {model.name}
        <ChevronDownIcon className="size-3.5 text-zinc-500" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8}>
          <PickerPopup
            options={options}
            modelId={model._id}
            onPick={(modelId) => {
              onPick(modelId)
              setOpen(false)
            }}
          />
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** Mounts on each open, so it starts on Favorites, or the first Provider without any. */
function PickerPopup({
  options,
  modelId,
  onPick,
}: {
  options: Options
  modelId: Id<'models'>
  onPick: (modelId: Id<'models'>) => void
}) {
  const { providers, models, favoriteIds } = options
  const toggleFavorite = useMutation(api.userSettings.toggleFavorite)
  const search = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState(
    favoriteIds.length > 0 ? 'favorites' : providers[0]?._id,
  )
  const [query, setQuery] = useState('')

  const favorites = favoriteIds.flatMap((id) =>
    models.filter((m) => m._id === id),
  )
  const searching = query.trim() !== ''
  const list = searching
    ? models.filter((m) =>
        m.name.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : tab === 'favorites'
      ? favorites
      : models.filter((m) => m.providerId === tab)
  const shortcuts = !searching && tab === 'favorites'

  // ⌘1–9 (Ctrl elsewhere) pick the first nine Favorites.
  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || !/^[1-9]$/.test(event.key)) return
    const favorite = favorites[Number(event.key) - 1]
    if (!favorite) return
    event.preventDefault()
    onPick(favorite._id)
  }

  const tabs = [
    {
      id: 'favorites',
      name: 'Favorites',
      icon: <StarIcon className="size-4 text-yellow-400" />,
    },
    ...providers.map((p) => ({
      id: p._id,
      name: p.name,
      icon: <ProviderIcon options={options} providerId={p._id} />,
    })),
  ]

  return (
    <Popover.Popup
      aria-label="Models"
      initialFocus={search}
      onKeyDown={onKeyDown}
      className="flex h-80 w-[min(24rem,90vw)] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl outline-none"
    >
      <div className="flex flex-col gap-1 border-r border-zinc-800 p-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-label={t.name}
            title={t.name}
            aria-pressed={!searching && tab === t.id}
            onClick={() => {
              setTab(t.id)
              setQuery('')
            }}
            className="rounded-lg p-2 hover:bg-zinc-800/60 aria-pressed:bg-zinc-800"
          >
            {t.icon}
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <SearchIcon className="size-3.5 text-zinc-500" />
          <input
            ref={search}
            aria-label="Search Models"
            placeholder="Search Models…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || !list[0]) return
              event.preventDefault()
              onPick(list[0]._id)
            }}
            className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-500"
          />
        </div>
        <ul className="flex-1 overflow-y-auto p-1">
          {list.length === 0 && (
            <li className="p-4 text-center text-xs text-zinc-500">
              {shortcuts ? 'Star a Model to add it here.' : 'No Models match.'}
            </li>
          )}
          {list.map((m, i) => {
            const favorite = favoriteIds.includes(m._id)
            return (
              <li
                key={m._id}
                className={cn(
                  'group flex items-center gap-2 rounded-lg pr-2 text-sm hover:bg-zinc-800/60',
                  m._id === modelId && 'bg-zinc-800',
                )}
              >
                <button
                  type="button"
                  onClick={() => onPick(m._id)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  <ProviderIcon options={options} providerId={m.providerId} />
                  <span className="truncate">{m.name}</span>
                  {m.adminOnly && (
                    <span
                      title="Admin-only Model"
                      className="rounded bg-violet-500/20 px-1 text-[10px] text-violet-300"
                    >
                      admin
                    </span>
                  )}
                </button>
                {shortcuts && i < 9 && (
                  <kbd className="text-[10px] text-zinc-500">⌘{i + 1}</kbd>
                )}
                <button
                  type="button"
                  aria-label={`Favorite ${m.name}`}
                  aria-pressed={favorite}
                  onClick={() => void toggleFavorite({ modelId: m._id })}
                  className={cn(
                    'rounded outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/30',
                    favorite
                      ? 'text-yellow-400'
                      : 'text-zinc-600 opacity-0 group-hover:opacity-100',
                  )}
                >
                  <StarIcon
                    className="size-3.5"
                    fill={favorite ? 'currentColor' : 'none'}
                  />
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </Popover.Popup>
  )
}

/** Derived from the Provider's API format. */
function ProviderIcon({
  options,
  providerId,
}: {
  options: Options
  providerId: Id<'providers'>
}) {
  const provider = options.providers.find((p) => p._id === providerId)
  return provider?.apiFormat === 'anthropic-messages' ? (
    <AsteriskIcon className="size-4 shrink-0 text-orange-400" />
  ) : (
    <HexagonIcon className="size-4 shrink-0 text-emerald-400" />
  )
}
