import { createRoomRequestSchema } from '@anomaly-detector/contracts'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Separator } from '@/components/ui/separator'
import { Typography } from '@/components/ui/typography'
import { useAuth } from '@/features/auth'
import { RoomsApi, useCreateRoomMutation } from '@/features/rooms'
import { useI18n } from '@/platform/i18n'

export function RoomListPage() {
  const { t } = useI18n()
  const auth = useAuth()
  const navigate = useNavigate()
  const [capacity, setCapacity] = useState<2 | 3 | 4>(2)

  useEffect(() => {
    if (!auth.isBootstrapping && !auth.user) {
      void navigate({ to: '/', replace: true })
    }
  }, [auth.isBootstrapping, auth.user, navigate])

  const [createError, setCreateError] = useState<string | null>(null)
  const [joinCode, setJoinCode] = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)

  if (auth.isBootstrapping || !auth.user) return null

  const api = new RoomsApi(auth.transport)
  const { mutateAsync: createRoom, isPending: isCreating } = useCreateRoomMutation({ api })

  const handleCreate = async () => {
    setCreateError(null)
    const result = createRoomRequestSchema.safeParse({ capacity })
    if (!result.success) {
      setCreateError(t('rooms.create.error.invalid'))
      return
    }
    try {
      const room = await createRoom(result.data)
      await navigate({ to: '/rooms/$roomId', params: { roomId: room.roomId } })
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t('rooms.create.error.generic'))
    }
  }

  const handleJoinByCode = () => {
    const trimmed = joinCode.trim()
    if (!trimmed) return
    setJoinError(null)
    void navigate({ to: '/rooms/$roomId', params: { roomId: trimmed } })
  }

  return (
    <section className="mx-auto grid w-full max-w-2xl gap-6 px-5 py-16">
      <div className="grid gap-2">
        <Typography variant="h1">{t('rooms.title')}</Typography>
        <Typography tone="muted">{t('rooms.description')}</Typography>
      </div>

      {/* Join by code */}
      <Card>
        <CardHeader>
          <CardTitle className="tracking-wide uppercase">{t('rooms.join.title')}</CardTitle>
          <CardDescription>{t('rooms.join.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="join-code">{t('rooms.join.placeholder')}</FieldLabel>
              <Input
                id="join-code"
                value={joinCode}
                placeholder={t('rooms.join.placeholder')}
                className="font-mono"
                onChange={(e) => { setJoinCode(e.target.value); setJoinError(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleJoinByCode() }}
              />
            </Field>
            {joinError && <FieldError id="join-error" errors={[{ message: joinError }]} />}
            <Button type="button" size="lg" className="w-full" onClick={handleJoinByCode}>
              {t('rooms.join.submit')}
            </Button>
          </FieldGroup>
        </CardContent>
      </Card>

      <Separator />

      {/* Create room */}
      <Card>
        <CardHeader>
          <CardTitle className="tracking-wide uppercase">{t('rooms.create.title')}</CardTitle>
          <CardDescription>{t('rooms.create.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="room-capacity">{t('rooms.create.capacity')}</FieldLabel>
              <NativeSelect
                id="room-capacity"
                value={String(capacity)}
                onChange={(e) => setCapacity(Number(e.target.value) as 2 | 3 | 4)}
              >
                <option value="2">{t('rooms.create.capacity.2')}</option>
                <option value="3">{t('rooms.create.capacity.3')}</option>
                <option value="4">{t('rooms.create.capacity.4')}</option>
              </NativeSelect>
            </Field>
            {createError && <FieldError id="create-error" errors={[{ message: createError }]} />}
            <Button type="button" size="lg" className="w-full" disabled={isCreating} onClick={() => void handleCreate()}>
              {isCreating ? t('rooms.create.submitting') : t('rooms.create.submit')}
            </Button>
          </FieldGroup>
        </CardContent>
      </Card>
    </section>
  )
}