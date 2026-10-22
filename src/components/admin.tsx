import type { Doc } from '@/convex/_generated/dataModel'
import type { FunctionReturnType } from 'convex/server'
import { Navigate } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { ConvexError } from 'convex/values'
import { RefreshCwIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/convex/_generated/api'
import { AppSidebar } from '~/components/app-sidebar'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

type Provider = FunctionReturnType<typeof api.providers.list>[number]

/** Providers, Models and the Title Model. Convex refuses non-Admins too. */
export function Admin() {
  const me = useQuery(api.users.me)
  if (me === undefined) return null
  if (me?.role !== 'admin') return <Navigate to="/" />

  return (
    <div className="flex h-dvh">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto px-4 py-8">
        <div className="mx-auto flex max-w-3xl flex-col gap-10">
          <h1 className="text-xl font-semibold">Admin</h1>
          <Providers />
          <TitleModel />
          <Models />
        </div>
      </main>
    </div>
  )
}

/** Runs a mutation, keeping its ConvexError message for display. */
function useAttempt() {
  const [error, setError] = useState<string | null>(null)
  const attempt = async (run: () => Promise<unknown>) => {
    setError(null)
    try {
      await run()
    } catch (cause) {
      setError(
        cause instanceof ConvexError && typeof cause.data === 'string'
          ? cause.data
          : 'Something went wrong. Try again.',
      )
    }
  }
  return { error, attempt }
}

function Alert({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p role="alert" className="text-xs text-destructive">
      {error}
    </p>
  )
}

function Providers() {
  const providers = useQuery(api.providers.list)
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-semibold">Providers</h2>
      {providers?.map((provider) => (
        <ProviderForm key={provider._id} provider={provider} />
      ))}
    </section>
  )
}

function ProviderForm({ provider }: { provider: Provider }) {
  const update = useMutation(api.providers.update)
  const remove = useMutation(api.providers.remove)
  const { error, attempt } = useAttempt()
  const id = (field: string) => `${provider._id}-${field}`

  return (
    <form
      aria-label={provider.name}
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault()
        const form = event.currentTarget
        const data = new FormData(form)
        const text = (name: string) => {
          const value = data.get(name)
          return typeof value === 'string' ? value : ''
        }
        void attempt(async () => {
          await update({
            providerId: provider._id,
            name: text('name'),
            baseUrl: text('baseUrl'),
            apiKey: text('apiKey'),
          })
          form.reset()
        })
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id('name')}>Name</Label>
          <Input
            id={id('name')}
            name="name"
            defaultValue={provider.name}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id('baseUrl')}>Base URL</Label>
          <Input
            id={id('baseUrl')}
            name="baseUrl"
            type="url"
            defaultValue={provider.baseUrl}
            placeholder="http://cli-proxy-api:8317/v1"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id('apiKey')}>API key</Label>
        <Input
          id={id('apiKey')}
          name="apiKey"
          type="password"
          autoComplete="off"
          placeholder={
            provider.hasApiKey ? 'Set. Leave blank to keep it.' : 'Not set'
          }
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {provider.apiFormat} · models.dev {provider.modelsDevProviderId}
        </span>
        <Alert error={error} />
        <Button
          type="button"
          variant="destructive"
          className="ml-auto"
          onClick={() => {
            if (confirm(`Delete ${provider.name} and its Models?`))
              void attempt(() => remove({ providerId: provider._id }))
          }}
        >
          Delete
        </Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  )
}

function TitleModel() {
  const settings = useQuery(api.settings.get)
  const models = useQuery(api.models.list)
  const update = useMutation(api.settings.update)
  const { error, attempt } = useAttempt()

  return (
    <section className="flex flex-col gap-2">
      <Label htmlFor="title-model" className="font-semibold">
        Title Model
      </Label>
      <select
        id="title-model"
        value={settings?.titleModelId ?? ''}
        onChange={(event) => {
          const model = models?.find((m) => m._id === event.target.value)
          if (model) void attempt(() => update({ titleModelId: model._id }))
        }}
        className="h-7 max-w-xs rounded-md border border-input bg-input/30 px-2 text-xs"
      >
        {!settings?.titleModelId && <option value="">None yet</option>}
        {models?.map((m) => (
          <option key={m._id} value={m._id}>
            {m.name}
          </option>
        ))}
      </select>
      <Alert error={error} />
    </section>
  )
}

function Models() {
  const providers = useQuery(api.providers.list)
  const models = useQuery(api.models.list)
  const syncNow = useMutation(api.models.syncNow)
  const { error, attempt } = useAttempt()

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold">Models</h2>
        <Alert error={error} />
        <Button
          variant="outline"
          className="ml-auto"
          onClick={() => void attempt(() => syncNow())}
        >
          <RefreshCwIcon data-icon="inline-start" />
          Sync now
        </Button>
      </div>
      {providers?.map((provider) => (
        <ModelTable
          key={provider._id}
          name={provider.name}
          models={models?.filter((m) => m.providerId === provider._id) ?? []}
        />
      ))}
    </section>
  )
}

function ModelTable({
  name,
  models,
}: {
  name: string
  models: Doc<'models'>[]
}) {
  return (
    <table className="w-full text-left text-xs">
      <caption className="pb-1 text-left text-sm font-medium">{name}</caption>
      <thead className="text-muted-foreground">
        <tr>
          <th className="py-1 font-normal">Model</th>
          <th className="py-1 font-normal">Released</th>
          <th className="py-1 font-normal">Enabled</th>
          <th className="py-1 font-normal">Admin-only</th>
          <th>
            <span className="sr-only">Delete</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {models.map((model) => (
          <ModelRow key={model._id} model={model} />
        ))}
      </tbody>
    </table>
  )
}

function ModelRow({ model }: { model: Doc<'models'> }) {
  // Optimistic, so the checkbox flips on click rather than after the round trip.
  const update = useMutation(api.models.update).withOptimisticUpdate(
    (store, { modelId, ...fields }) => {
      const models = store.getQuery(api.models.list, {})
      if (models)
        store.setQuery(
          api.models.list,
          {},
          models.map((m) => (m._id === modelId ? { ...m, ...fields } : m)),
        )
    },
  )
  const remove = useMutation(api.models.remove)
  const { error, attempt } = useAttempt()
  const set = (fields: { enabled?: boolean; adminOnly?: boolean }) =>
    void attempt(() =>
      update({
        modelId: model._id,
        enabled: model.enabled,
        adminOnly: model.adminOnly,
        ...fields,
      }),
    )

  return (
    <tr className="border-t border-border">
      <td className="py-1.5">
        <div>{model.name}</div>
        <div className="text-muted-foreground">{model.modelId}</div>
        <Alert error={error} />
      </td>
      <td className="py-1.5">{model.releaseDate}</td>
      <td className="py-1.5">
        <Toggle
          label={`Enable ${model.name}`}
          checked={model.enabled}
          onChange={(enabled) => set({ enabled })}
        />
      </td>
      <td className="py-1.5">
        <Toggle
          label={`${model.name} is Admin-only`}
          checked={model.adminOnly}
          onChange={(adminOnly) => set({ adminOnly })}
        />
      </td>
      <td className="py-1.5 text-right">
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${model.name}`}
          onClick={() => void attempt(() => remove({ modelId: model._id }))}
        >
          <Trash2Icon />
        </Button>
      </td>
    </tr>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      className="size-4 accent-brand-600"
    />
  )
}
