import type { Id } from '@/convex/_generated/dataModel'
import type { FunctionReturnType } from 'convex/server'
import type { KeyboardEvent, ReactElement } from 'react'
import { Popover } from '@base-ui/react/popover'
import { useMutation } from 'convex/react'
import { ChevronDownIcon, SearchIcon, StarIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { api } from '@/convex/_generated/api'
import { useShortcut } from '~/lib/shortcut'
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
  const button = useRef<HTMLButtonElement>(null)
  const shortcut = useShortcut('m', () => button.current?.click(), {
    shift: true,
  })

  return (
    <ModelMenu
      options={options}
      modelId={model._id}
      onPick={onPick}
      trigger={
        <button
          ref={button}
          aria-keyshortcuts={shortcut}
          type="button"
          aria-label={`Model: ${model.name}`}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm outline-none hover:bg-zinc-800 focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <ProviderIcon options={options} providerId={model.providerId} />
          {model.name}
          <ChevronDownIcon className="size-3.5 text-zinc-500" />
        </button>
      }
    />
  )
}

/** The Model popover, opened by `trigger`. */
export function ModelMenu({
  options,
  modelId,
  onPick,
  trigger,
}: {
  options: Options
  modelId: Id<'models'>
  onPick: (modelId: Id<'models'>) => void
  trigger: ReactElement
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger render={trigger} />
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8}>
          <PickerPopup
            options={options}
            modelId={modelId}
            onPick={(picked) => {
              onPick(picked)
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
      icon: <StarIcon className="size-4 text-yellow-400" fill="currentColor" />,
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

/** The Provider's logo, from its API format. */
function ProviderIcon({
  options,
  providerId,
}: {
  options: Options
  providerId: Id<'providers'>
}) {
  const provider = options.providers.find((p) => p._id === providerId)
  const anthropic = provider?.apiFormat === 'anthropic-messages'
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={cn(
        'size-4 shrink-0',
        anthropic ? 'text-[#d97757]' : 'text-zinc-100',
      )}
    >
      <path d={anthropic ? CLAUDE_PATH : OPENAI_PATH} />
    </svg>
  )
}

// Logos from Simple Icons (CC0).
const CLAUDE_PATH =
  'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'
const OPENAI_PATH =
  'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z'
