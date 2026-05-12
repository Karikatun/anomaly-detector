import { useForm } from '@tanstack/react-form'
import {
  loginRequestSchema,
  registerRequestSchema,
  type LoginRequest,
  type RegisterRequest,
} from '@web-app-demo/contracts'
import { useState } from 'react'

import { ApiRequestError } from '../lib/api'
import { useAuth } from '../lib/use-auth'

type AuthMode = 'login' | 'register'

export function AuthForm() {
  const auth = useAuth()
  const [mode, setMode] = useState<AuthMode>('register')
  const [error, setError] = useState<string | null>(null)
  const isRegister = mode === 'register'

  const form = useForm({
    defaultValues: {
      email: '',
      password: '',
      displayName: '' as string | undefined,
    },
    validators: {
      onChange: ({ value }) => {
        const result = registerRequestSchema.safeParse(value)
        return result.success ? undefined : result.error.issues
      },
    },
    onSubmit: async ({ value }) => {
      setError(null)

      try {
        if (isRegister) {
          await auth.register(registerRequestSchema.parse(value) as RegisterRequest)
        } else {
          await auth.login(loginRequestSchema.parse(value) as LoginRequest)
        }
      } catch (caughtError) {
        if (caughtError instanceof ApiRequestError) {
          setError(caughtError.message)
          return
        }
        setError('Unexpected auth error')
      }
    },
  })

  return (
    <section className="auth-panel" aria-label="Authentication">
      <div className="mode-switch" role="tablist" aria-label="Auth mode">
        <button
          type="button"
          className={isRegister ? 'active' : ''}
          onClick={() => setMode('register')}
        >
          Register
        </button>
        <button
          type="button"
          className={!isRegister ? 'active' : ''}
          onClick={() => setMode('login')}
        >
          Login
        </button>
      </div>

      <form
        className="auth-form"
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
      >
        {isRegister && (
          <form.Field
            name="displayName"
            children={(field) => (
              <label>
                <span>Name</span>
                <input
                  name={field.name}
                  value={field.state.value ?? ''}
                  autoComplete="name"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
                <FieldErrors errors={field.state.meta.errors} />
              </label>
            )}
          />
        )}

        <form.Field
          name="email"
          children={(field) => (
            <label>
              <span>Email</span>
                <input
                  name={field.name}
                  value={field.state.value}
                  type="text"
                  inputMode="email"
                  autoComplete="email"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
              />
              <FieldErrors errors={field.state.meta.errors} />
            </label>
          )}
        />

        <form.Field
          name="password"
          children={(field) => (
            <label>
              <span>Password</span>
              <input
                name={field.name}
                value={field.state.value}
                type="password"
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
              <FieldErrors errors={field.state.meta.errors} />
            </label>
          )}
        />

        {error && <p className="form-error">{error}</p>}

        <form.Subscribe
          selector={(state) => [state.canSubmit, state.isSubmitting] as const}
          children={([canSubmit, isSubmitting]) => (
            <button type="submit" className="primary-action" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? 'Working...' : isRegister ? 'Create account' : 'Login'}
            </button>
          )}
        />
      </form>
    </section>
  )
}

function FieldErrors({ errors }: { errors: unknown[] }) {
  if (!errors.length) return null

  return <small className="field-error">{errors.map(formatError).join(', ')}</small>
}

function formatError(error: unknown) {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message)
  }
  return 'Invalid value'
}
