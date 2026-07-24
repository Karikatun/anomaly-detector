import { createRoomRequestSchema } from '@anomaly-detector/contracts'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { NativeSelect } from '@/components/ui/native-select'
import { useAuth } from '@/features/auth'
import { useI18n } from '@/platform/i18n'
import { RoomsApi } from '../api'
import { useCreateRoomMutation } from '../queries'
import styles from './JoinRoomDialog.module.css'

export function CreateRoomDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  const auth = useAuth()
  const navigate = useNavigate()
  const [capacity, setCapacity] = useState<2 | 3 | 4>(2)
  const [error, setError] = useState<string | null>(null)
  const api = new RoomsApi(auth.transport)
  const { mutateAsync: createRoom, isPending } = useCreateRoomMutation({ api })

  const handleCreate = async () => {
    setError(null)
    const result = createRoomRequestSchema.safeParse({ capacity })
    if (!result.success) {
      setError(t('rooms.create.error.invalid'))
      return
    }

    try {
      const room = await createRoom(result.data)
      onOpenChange(false)
      await navigate({ to: '/rooms/$roomId', params: { roomId: room.roomId } })
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : t('rooms.create.error.generic'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${styles.content} ${styles.createContent}`} showCloseButton={false}>
        <DialogHeader className={styles.header}>
          <DialogTitle className={styles.title}>{t('rooms.create.title')}</DialogTitle>
          <DialogDescription className={styles.description}>{t('rooms.create.description')}</DialogDescription>
        </DialogHeader>

        <div className={styles.form}>
          <Field className={styles.field}>
            <FieldLabel className={styles.label} htmlFor="create-room-capacity">{t('rooms.create.capacity')}</FieldLabel>
            <NativeSelect
              id="create-room-capacity"
              value={String(capacity)}
              onChange={(event) => setCapacity(Number(event.target.value) as 2 | 3 | 4)}
            >
              <option value="2">{t('rooms.create.capacity.2')}</option>
              <option value="3">{t('rooms.create.capacity.3')}</option>
              <option value="4">{t('rooms.create.capacity.4')}</option>
            </NativeSelect>
          </Field>
          {error && <FieldError className={styles.error} errors={[{ message: error }]} />}
        </div>

        <DialogFooter className={styles.footer}>
          <DialogClose asChild>
            <Button type="button" variant="ghost" className={styles.cancel}>{t('rooms.join.cancel')}</Button>
          </DialogClose>
          <Button type="button" className={styles.createSubmit} disabled={isPending} onClick={() => void handleCreate()}>
            {isPending ? t('rooms.create.submitting') : t('rooms.create.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
