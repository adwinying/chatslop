import { useForm } from '@tanstack/react-form'
import { useHydrated } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { Button } from '~/components/ui/button'
import { Input } from '~/components/ui/input'
import { Label } from '~/components/ui/label'
import { authClient } from '~/lib/auth-client'

const schema = z.object({
  identifier: z.string().trim().min(1, 'Enter your username or email'),
  password: z.string().min(1, 'Enter your password'),
})

const fields = [
  {
    name: 'identifier',
    label: 'Username or email',
    type: 'text',
    autoComplete: 'username',
  },
  {
    name: 'password',
    label: 'Password',
    type: 'password',
    autoComplete: 'current-password',
  },
] as const

/** Username or email + password. Uses no Convex query, so it works signed out. */
export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [error, setError] = useState<string | null>(null)
  // Before hydration a submit would be a native GET with the password in the
  // URL, and controlled inputs would drop typed text. So the form waits.
  const hydrated = useHydrated()

  const form = useForm({
    defaultValues: { identifier: '', password: '' },
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      setError(null)
      const identifier = value.identifier.trim()
      const { password } = value
      const result = identifier.includes('@')
        ? await authClient.signIn.email({ email: identifier, password })
        : await authClient.signIn.username({ username: identifier, password })

      if (result.error) setError('Wrong username, email or password')
      else onSuccess()
    },
  })

  return (
    <form
      method="post"
      onSubmit={(event) => {
        event.preventDefault()
        void form.handleSubmit()
      }}
    >
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <fieldset
            disabled={!hydrated || isSubmitting}
            className="flex flex-col gap-4"
          >
            {fields.map(({ name, label, type, autoComplete }) => (
              <form.Field key={name} name={name}>
                {(field) => {
                  const invalid =
                    field.state.meta.isTouched && !field.state.meta.isValid
                  const errorId = `${name}-error`
                  return (
                    <div className="flex flex-col gap-2">
                      <Label htmlFor={name}>{label}</Label>
                      <Input
                        id={name}
                        name={name}
                        type={type}
                        autoComplete={autoComplete}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        aria-invalid={invalid}
                        aria-describedby={invalid ? errorId : undefined}
                      />
                      {invalid && (
                        <p id={errorId} className="text-sm text-destructive">
                          {field.state.meta.errors[0]?.message}
                        </p>
                      )}
                    </div>
                  )
                }}
              </form.Field>
            ))}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" size="lg">
              Log in
            </Button>
          </fieldset>
        )}
      </form.Subscribe>
    </form>
  )
}
