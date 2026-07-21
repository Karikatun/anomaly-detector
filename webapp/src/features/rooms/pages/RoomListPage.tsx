import { createRoomRequestSchema } from '@anomaly-detector/contracts'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { NativeSelect } from '@/components/ui/native-select'
import { Typography } from '@/components/ui/typography'
import { useAuth } from '@/features/auth'
import { RoomsApi, useCreateRoomMutation } from '@/features/rooms'
import { useI18n } from '@/platform/i18n'

export function RoomListPage() {
  const { t } = useI18n()
  const auth = useAuth()
  const navigate = useNavigate()
  const [capacity, setCapacity] = useState<2 | 3 | 4>(2)
  const [createError, setCreateError] = useState<string | null>(null)

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

  return (
    <section className="mx-auto grid w-full max-w-2xl gap-6 px-5 py-16">
      <div className="grid gap-2">
        <Typography variant="h1">{t('rooms.title')}</Typography>
        <Typography tone="muted">{t('rooms.description')}</Typography>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('rooms.create.title')}</CardTitle>
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

            {createError && (
              <FieldError id="create-error" errors={[{ message: createError }]} />
            )}

            <Button
              type="button"
              size="lg"
              className="w-full"
              disabled={isCreating}
              onClick={() => void handleCreate()}
            >
              {isCreating ? t('rooms.create.submitting') : t('rooms.create.submit')}
            </Button>
          </FieldGroup>
        </CardContent>
      </Card>
    </section>
  )
}