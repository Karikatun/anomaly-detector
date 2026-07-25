import { useForm } from '@tanstack/react-form'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Typography } from '@/components/ui/typography'
import { useI18n } from '@/platform/i18n'
import { parseProfileForm } from '../form-validation'
import { useAuth } from '../use-auth'
import { ProtectedPage } from '../components/AuthSessionGate'

export function ProfilePage() {
  const auth = useAuth()
  const { t } = useI18n()
  const user = auth.user

  return (
    <ProtectedPage>
      {user && (
        <section className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
          <div className="grid gap-3">
            <Badge variant="outline" className="w-fit">
              {t('app.profile.badge')}
            </Badge>
            <Typography variant="h1">
              {user.displayName ?? user.login}
            </Typography>
            <Typography tone="muted">{user.login}</Typography>
          </div>

          <Separator />

          <Card>
            <CardHeader>
              <CardTitle>{t('auth.displayName')}</CardTitle>
              <CardDescription>
                Измените отображаемое имя. Оно видно другим игрокам в матче.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DisplayNameEditor
                currentName={user.displayName ?? ''}
                onSave={(input) => auth.updateProfile(input)}
              />
            </CardContent>
          </Card>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <Card size="sm">
              <CardHeader>
                <CardTitle>{t('app.profile.userId')}</CardTitle>
                <CardDescription wrap="break">{user.id}</CardDescription>
              </CardHeader>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>{t('app.profile.created')}</CardTitle>
                <CardDescription>{new Date(user.createdAt).toLocaleString('ru-RU')}</CardDescription>
              </CardHeader>
            </Card>
          </div>
        </section>
      )}
    </ProtectedPage>
  )
}

function DisplayNameEditor({
  currentName,
  onSave,
}: {
  currentName: string
  onSave: (input: { displayName: string }) => Promise<void>
}) {
  const [done, setDone] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const form = useForm({
    defaultValues: { displayName: currentName },
    onSubmit: async ({ value }) => {
      const parsed = parseProfileForm(value)
      if (!parsed.success || !parsed.data.displayName || parsed.data.displayName === currentName) return
      setServerError(null)
      try {
        await onSave({ displayName: parsed.data.displayName })
        setDone(true)
        setTimeout(() => setDone(false), 2_000)
      } catch (saveError) {
        setServerError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить имя')
      }
    },
  })

  return (
    <FieldGroup className="gap-4">
      <form.Field name="displayName">
        {(field) => {
          const validation = parseProfileForm({ displayName: field.state.value })
          return (
            <Field>
              <FieldLabel htmlFor="profile-display-name">Отображаемое имя</FieldLabel>
              <div className="flex gap-3">
                <Input
                  id="profile-display-name"
                  type="text"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    field.handleChange(event.target.value)
                    setDone(false)
                    setServerError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void form.handleSubmit()
                  }}
                  className="flex-1"
                />
                <form.Subscribe selector={(state) => state.isSubmitting}>
                  {(isSubmitting) => (
                    <Button
                      type="button"
                      disabled={isSubmitting
                        || !validation.success
                        || !validation.data.displayName
                        || validation.data.displayName === currentName}
                      onClick={() => void form.handleSubmit()}
                    >
                      {done ? 'Сохранено!' : isSubmitting ? 'Сохраняем...' : 'Сохранить'}
                    </Button>
                  )}
                </form.Subscribe>
              </div>
              {!validation.success && field.state.value.length > 0 && (
                <Typography role="alert" variant="bodySm" tone="destructive">
                  Имя должно содержать от 2 до 80 символов.
                </Typography>
              )}
              {serverError && (
                <Typography role="alert" variant="bodySm" tone="destructive">
                  {serverError}
                </Typography>
              )}
            </Field>
          )
        }}
      </form.Field>
    </FieldGroup>
  )
}
