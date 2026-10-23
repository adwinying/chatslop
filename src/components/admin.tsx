import type { Doc } from '@/convex/_generated/dataModel'
import type { FunctionReturnType } from 'convex/server'
import { Navigate } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import { ConvexError } from 'convex/values'
import { RefreshCwIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { api } from '@/convex/_generated/api'
import { listedSince } from '@/convex/listing'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'

// The Admin list's window, as of today.
const listArgs = () => ({ since: listedSince(new Date()) })

type Provider = FunctionReturnType<typeof api.providers.list>[number]
type User = FunctionReturnType<typeof api.users.list>[number]

/** Users, Providers, Models and the Title Model. Convex refuses non-Admins too. */
export function Admin() {
  const me = useQuery(api.users.me)
  if (me === undefined) return null
  if (me?.role !== 'admin') return <Navigate to="/" />

  return (
    <main className="flex-1 overflow-y-auto px-4 py-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-10">
        <h1 className="text-xl font-semibold">Admin</h1>
        <Users myId={me.id} />
        <Providers />
        <TitleModel />
        <Models />
      </div>
    </main>
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

/** The form's text field, or '' when missing. */
const textOf = (data: FormData, name: string) => {
  const value = data.get(name)
  return typeof value === 'string' ? value : ''
}

function Users({ myId }: { myId: string }) {
  const users = useQuery(api.users.list)
  const create = useAction(api.users.create)
  const { error, attempt } = useAttempt()

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-semibold">Users</h2>
      <form
        aria-label="New User"
        className="flex flex-col gap-3 rounded-lg border border-border p-4"
        onSubmit={(event) => {
          event.preventDefault()
          const form = event.currentTarget
          const data = new FormData(form)
          void attempt(async () => {
            await create({
              username: textOf(data, 'username'),
              email: textOf(data, 'email'),
              password: textOf(data, 'password'),
            })
            form.reset()
          })
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-user-username">Username</Label>
            <Input
              id="new-user-username"
              name="username"
              autoComplete="off"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-user-email">Email</Label>
            <Input
              id="new-user-email"
              name="email"
              type="email"
              autoComplete="off"
              placeholder="Optional"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-user-password">Password</Label>
            <Input
              id="new-user-password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Alert error={error} />
          <Button type="submit" className="ml-auto">
            Create
          </Button>
        </div>
      </form>
      <table className="w-full text-left text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-1 font-normal">User</th>
            <th className="py-1 font-normal">Role</th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {users?.map((user) => (
            <UserRow key={user.id} user={user} isMe={user.id === myId} />
          ))}
        </tbody>
      </table>
    </section>
  )
}

function UserRow({ user, isMe }: { user: User; isMe: boolean }) {
  const disable = useAction(api.users.disable)
  const enable = useAction(api.users.enable)
  const promote = useAction(api.users.promote)
  const remove = useAction(api.users.remove)
  const [resetting, setResetting] = useState(false)
  const { error, attempt } = useAttempt()
  const label = user.username ?? user.name
  const target = { userId: user.id }

  return (
    <tr className="border-t border-border align-top">
      <td className="py-1.5">
        <div>
          {label}
          {user.banned && (
            <span className="text-muted-foreground"> · Disabled</span>
          )}
        </div>
        <div className="text-muted-foreground">{user.email}</div>
        <Alert error={error} />
        {resetting && (
          <ResetPassword user={user} onDone={() => setResetting(false)} />
        )}
      </td>
      <td className="py-1.5">{user.role === 'admin' ? 'Admin' : 'User'}</td>
      <td className="py-1.5">
        <div className="flex justify-end gap-1">
          <Button variant="ghost" onClick={() => setResetting(!resetting)}>
            Reset password
          </Button>
          {user.role !== 'admin' && (
            <Button
              variant="ghost"
              onClick={() => {
                if (confirm(`Make ${label} an Admin?`))
                  void attempt(() => promote(target))
              }}
            >
              Make Admin
            </Button>
          )}
          {!isMe && (
            <>
              <Button
                variant="ghost"
                onClick={() =>
                  void attempt(() =>
                    user.banned ? enable(target) : disable(target),
                  )
                }
              >
                {user.banned ? 'Enable' : 'Disable'}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (confirm(`Delete ${label} and all their Threads?`))
                    void attempt(() => remove(target))
                }}
              >
                Delete
              </Button>
            </>
          )}
        </div>
      </td>
    </tr>
  )
}

function ResetPassword({ user, onDone }: { user: User; onDone: () => void }) {
  const resetPassword = useAction(api.users.resetPassword)
  const { error, attempt } = useAttempt()
  const id = `${user.id}-password`

  return (
    <form
      aria-label={`New password for ${user.username ?? user.name}`}
      className="flex flex-col gap-1.5 pt-2"
      onSubmit={(event) => {
        event.preventDefault()
        const password = textOf(new FormData(event.currentTarget), 'password')
        void attempt(async () => {
          await resetPassword({ userId: user.id, password })
          onDone()
        })
      }}
    >
      <Label htmlFor={id}>New password</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          className="max-w-xs"
        />
        <Button type="submit">Save</Button>
      </div>
      <Alert error={error} />
    </form>
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
        void attempt(async () => {
          await update({
            providerId: provider._id,
            name: textOf(data, 'name'),
            baseUrl: textOf(data, 'baseUrl'),
            apiKey: textOf(data, 'apiKey'),
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
  const models = useQuery(api.models.list, listArgs())
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
  const models = useQuery(api.models.list, listArgs())
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
      const args = listArgs()
      const models = store.getQuery(api.models.list, args)
      if (models)
        store.setQuery(
          api.models.list,
          args,
          models.map((m) => (m._id === modelId ? { ...m, ...fields } : m)),
        )
    },
  )
  const remove = useMutation(api.models.remove)
  const { error, attempt } = useAttempt()
  const save = (fields: { enabled?: boolean; adminOnly?: boolean }) =>
    void attempt(() => update({ modelId: model._id, ...fields }))

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
          onChange={(enabled) => save({ enabled })}
        />
      </td>
      <td className="py-1.5">
        <Toggle
          label={`${model.name} is Admin-only`}
          checked={model.adminOnly}
          onChange={(adminOnly) => save({ adminOnly })}
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
