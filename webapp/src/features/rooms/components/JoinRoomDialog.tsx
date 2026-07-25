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
import { Input } from '@/components/ui/input'
import { useI18n } from '@/platform/i18n'
import styles from './RoomDialog.module.css'

export function JoinRoomDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [roomId, setRoomId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleJoin = () => {
    const normalizedRoomId = roomId.trim()
    if (!normalizedRoomId) {
      setError(t('rooms.join.error.required'))
      return
    }

    onOpenChange(false)
    void navigate({ to: '/rooms/$roomId', params: { roomId: normalizedRoomId } })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={styles.content} showCloseButton={false}>
        <DialogHeader className={styles.header}>
          <DialogTitle className={styles.title}>{t('rooms.join.title')}</DialogTitle>
          <DialogDescription className={styles.description}>{t('rooms.join.description')}</DialogDescription>
        </DialogHeader>

        <div className={styles.form}>
          <Field className={styles.field}>
            <FieldLabel className={styles.label} htmlFor="join-room-id">{t('rooms.join.placeholder')}</FieldLabel>
            <Input
              id="join-room-id"
              className={styles.input}
              value={roomId}
              placeholder={t('rooms.join.placeholder')}
              onChange={(event) => { setRoomId(event.target.value); setError(null) }}
              onKeyDown={(event) => { if (event.key === 'Enter') handleJoin() }}
            />
          </Field>
          {error && <FieldError className={styles.error} errors={[{ message: error }]} />}
        </div>

        <DialogFooter className={styles.footer}>
          <DialogClose asChild>
            <Button type="button" variant="ghost" className={styles.cancel}>{t('rooms.join.cancel')}</Button>
          </DialogClose>
          <Button type="button" className={styles.submit} onClick={handleJoin}>{t('rooms.join.submit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
