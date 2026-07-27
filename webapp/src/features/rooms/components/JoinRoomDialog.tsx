import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

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
import { useAuth } from '@/features/auth'
import { useI18n } from '@/platform/i18n'
import { RoomsApi } from '../api'
import { useJoinRoomByCodeMutation } from '../queries'
import styles from './RoomDialog.module.css'

export function JoinRoomDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useI18n()
  const auth = useAuth()
  const navigate = useNavigate()
  const [roomCode, setRoomCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const api = useMemo(() => new RoomsApi(auth.transport), [auth.transport])
  const { mutateAsync: joinRoom, isPending } = useJoinRoomByCodeMutation({ api })

  const handleJoin = async () => {
    if (!roomCode.trim()) {
      setError(t('rooms.join.error.required'))
      return
    }

    setError(null)
    try {
      const room = await joinRoom({ code: roomCode })
      onOpenChange(false)
      setRoomCode('')
      await navigate({ to: '/rooms/$roomId', params: { roomId: room.roomId } })
    } catch {
      setError(t('rooms.join.error.invalid'))
    }
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
              value={roomCode}
              placeholder={t('rooms.join.placeholder')}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => { setRoomCode(event.target.value); setError(null) }}
              onKeyDown={(event) => { if (event.key === 'Enter') void handleJoin() }}
            />
          </Field>
          {error && <FieldError className={styles.error} errors={[{ message: error }]} />}
        </div>

        <DialogFooter className={styles.footer}>
          <DialogClose asChild>
            <Button type="button" variant="ghost" className={styles.cancel}>{t('rooms.join.cancel')}</Button>
          </DialogClose>
          <Button type="button" className={styles.submit} disabled={isPending} onClick={() => void handleJoin()}>
            {isPending ? t('rooms.join.pending') : t('rooms.join.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
