import { useNavigate, useParams } from '@tanstack/react-router'
import { CheckmarkCircle02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { ExpeditionBackground } from '@/components/ExpeditionBackground'
import expeditionStyles from '@/components/ExpeditionShell.module.css'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { ProtectedPage, useAuth } from '@/features/auth'
import { useI18n } from '@/platform/i18n'
import { useSynchronizedCountdown } from '@/platform/time/synchronized-countdown'

import { RoomsApi } from '../api'
import {
  useCancelRoomStartMutation,
  useLeaveRoomMutation,
  useRoomQuery,
  useSetRoomReadyMutation,
  useStartRoomMutation,
} from '../queries'
import styles from './RoomLobbyPage.module.css'

export function RoomLobbyPage() {
  return (
    <ProtectedPage>
      <RoomLobbyContent />
    </ProtectedPage>
  )
}

function RoomLobbyContent() {
  const { t } = useI18n()
  const { roomId } = useParams({ from: '/rooms/$roomId' })
  const auth = useAuth()
  const navigate = useNavigate()
  const [actionError, setActionError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const api = useMemo(() => new RoomsApi(auth.transport), [auth.transport])
  const { mutateAsync: leaveRoom, isPending: isLeaving } = useLeaveRoomMutation({ api })
  const { mutateAsync: setRoomReady, isPending: isSettingReady } = useSetRoomReadyMutation({ api })
  const { mutateAsync: startRoom, isPending: isStarting } = useStartRoomMutation({ api })
  const { mutateAsync: cancelRoomStart, isPending: isCancellingStart } = useCancelRoomStartMutation({ api })
  const roomQuery = useRoomQuery({ api, roomId })
  const currentRoom = roomQuery.data
  const secondsLeft = useSynchronizedCountdown(
    currentRoom?.startsAt,
    currentRoom?.serverTime,
    { fallbackSeconds: 5, maximumSeconds: 5 },
  )

  useEffect(() => () => {
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current)
  }, [])

  useEffect(() => {
    if (currentRoom?.status === 'started' && currentRoom.tenderId) {
      void navigate({ to: '/tenders/$tenderId', params: { tenderId: currentRoom.tenderId }, search: { from: undefined } })
    }
  }, [currentRoom, navigate])

  const handleCopy = useCallback(async () => {
    const joinCredential = currentRoom?.joinCode ?? roomId
    try {
      await navigator.clipboard.writeText(joinCredential)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = joinCredential
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    setCopied(true)
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current)
    copyResetTimer.current = setTimeout(() => {
      setCopied(false)
      copyResetTimer.current = null
    }, 2_000)
  }, [currentRoom?.joinCode, roomId])

  const runRoomAction = useCallback(async <T,>(
    action: () => Promise<T>,
    onSuccess?: (result: T) => void | Promise<void>,
  ) => {
    setActionError(null)
    try {
      const result = await action()
      await onSuccess?.(result)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('rooms.create.error.generic'))
    }
  }, [t])

  const handleLeave = useCallback(
    () => runRoomAction(
      () => leaveRoom(roomId),
      () => navigate({ to: '/' }),
    ),
    [leaveRoom, navigate, roomId, runRoomAction],
  )

  const handleStart = useCallback(
    () => runRoomAction(() => startRoom(roomId)),
    [roomId, runRoomAction, startRoom],
  )

  const handleReadyChange = useCallback(
    (ready: boolean) => runRoomAction(() => setRoomReady({ ready, roomId })),
    [roomId, runRoomAction, setRoomReady],
  )

  const handleCancelStart = useCallback(
    () => runRoomAction(() => cancelRoomStart(roomId)),
    [cancelRoomStart, roomId, runRoomAction],
  )

  if (roomQuery.isPending) {
    return <main className={styles.loading}><Spinner /></main>
  }

  if (!currentRoom) {
    const loadError = roomQuery.error instanceof Error
      ? roomQuery.error.message
      : t('lobby.error.loadFailed')
    return (
      <main className={styles.errorScreen}>
        <Typography variant="h3">{t('lobby.error.notFound')}</Typography>
        <Typography tone="muted">{loadError}</Typography>
        <Button asChild>
          <a href="/"><Typography as="span" variant="control">{t('lobby.button.back')}</Typography></a>
        </Button>
      </main>
    )
  }

  const isHost = currentRoom.hostId === auth.user?.id
  const isMember = currentRoom.members.some((member) => member.userId === auth.user?.id)
  const isFull = currentRoom.members.length >= currentRoom.capacity
  const readyCount = currentRoom.members.filter((member) => member.ready).length
  const allPlayersReady = isFull && readyCount === currentRoom.capacity
  const isCountdown = currentRoom.status === 'starting'
  const canLeave = isMember && currentRoom.status === 'waiting'

  return (
    <main className={expeditionStyles.screen}>
      <ExpeditionBackground />
      <section className={expeditionStyles.panel} aria-label={t('lobby.title')}>
        <header className={styles.header}>
          <button type="button" className={styles.roomCode} onClick={() => void handleCopy()}>
            <Typography as="span" variant="control">{t('lobby.room.id')}</Typography>
            <Typography as="strong" variant="code" data-testid="room-join-code">
              {currentRoom.joinCode ?? currentRoom.roomId}
            </Typography>
            {copied
              ? (
                <HugeiconsIcon
                  icon={CheckmarkCircle02Icon}
                  strokeWidth={2}
                  className={styles.copySuccessIcon}
                  data-testid="room-copy-success"
                  aria-hidden="true"
                />
              )
              : <span className={styles.copyIcon} data-testid="room-copy-icon" aria-hidden="true" />}
            <Typography as="span" variant="srOnly" aria-live="polite">
              {copied ? t('lobby.copied') : t('lobby.copyId')}
            </Typography>
          </button>
          <Typography as="h1" className={styles.title}>{t('lobby.title')}</Typography>
          {canLeave ? (
            <Button className={styles.exitButton} type="button" disabled={isLeaving} onClick={() => void handleLeave()}>
              {isLeaving ? t('lobby.button.leaving') : t('lobby.button.exit')}
            </Button>
          ) : <span className={styles.headerSpacer} aria-hidden="true" />}
        </header>

        <div className={styles.layout}>
          <aside className={styles.leftColumn}>
            <section className={styles.playersPanel}>
              <Typography as="h2" className={styles.sectionTitle}>{t('lobby.players')}</Typography>
              <Typography as="div" className={styles.playerList}>
                {Array.from({ length: currentRoom.capacity }, (_, index) => {
                  const seat = index + 1
                  const member = currentRoom.members.find((candidate) => candidate.seat === seat)
                  const isPlayerHost = member?.userId === currentRoom.hostId
                  return (
                    <div className={styles.player} data-empty={!member || undefined} key={seat}>
                      <Typography as="span" variant="h6" className={styles.avatar} aria-hidden="true">
                        {member ? seat : '+'}
                      </Typography>
                      <div className={styles.playerCopy}>
                        <Typography className={styles.playerName}>
                          {member?.displayName ?? t('lobby.player.waiting')}
                        </Typography>
                        {isPlayerHost ? (
                          <Typography as="span" variant="control" className={styles.hostLabel}>
                            {t('lobby.player.host')}
                          </Typography>
                        ) : null}
                      </div>
                      {member && member.userId === auth.user?.id && currentRoom.status === 'waiting' ? (
                        <Button
                          className={styles.readyButton}
                          type="button"
                          disabled={isSettingReady}
                          onClick={() => void handleReadyChange(!member.ready)}
                        >
                          {isSettingReady
                            ? t('lobby.player.ready.updating')
                            : member.ready
                              ? t('lobby.player.ready.cancel')
                              : t('lobby.player.ready.action')}
                        </Button>
                      ) : member ? (
                        <Typography as="span" variant="control" className={styles.playerReadiness} data-ready={member.ready || undefined}>
                          <span className={styles.playerState} aria-hidden="true" />
                          {member.ready ? t('lobby.player.ready') : t('lobby.player.notReady')}
                        </Typography>
                      ) : null}
                    </div>
                  )
                })}
              </Typography>
            </section>

            <section className={styles.settingsPanel}>
              <Typography as="h2" className={styles.sectionTitle}>{t('lobby.settings.title')}</Typography>
              <dl className={styles.settingsList}>
                <div>
                  <Typography as="dt" variant="control">{t('lobby.settings.mode')}</Typography>
                  <Typography as="dd" variant="bodySm">{t('lobby.settings.mode.value')}</Typography>
                </div>
                <div>
                  <Typography as="dt" variant="control">{t('lobby.settings.players')}</Typography>
                  <Typography as="dd" variant="bodySm">{currentRoom.capacity}</Typography>
                </div>
                <div>
                  <Typography as="dt" variant="control">{t('lobby.settings.turnTime')}</Typography>
                  <Typography as="dd" variant="bodySm">{t('lobby.settings.turnTime.value')}</Typography>
                </div>
              </dl>
            </section>
          </aside>

          <div className={styles.rightColumn}>
            <section
              className={styles.startPanel}
              data-state={isCountdown ? 'starting' : allPlayersReady ? 'ready' : 'waiting'}
              aria-live="polite"
            >
              <Typography as="span" variant="h3" className={styles.statusIndicator} aria-hidden="true">
                {isCountdown ? secondsLeft : null}
              </Typography>
              {isCountdown ? (
                <>
                  <div className={styles.statusCopy}>
                    <Typography className={styles.statusTitle}>{t('lobby.starting.countdown', { seconds: secondsLeft })}</Typography>
                    <Typography className={styles.statusHint}>{t('lobby.starting.hint')}</Typography>
                  </div>
                  {isHost ? (
                    <Button className={styles.cancelStartButton} type="button" disabled={isCancellingStart} onClick={() => void handleCancelStart()}>
                      {isCancellingStart ? t('lobby.button.cancellingStart') : t('lobby.button.cancelStart')}
                    </Button>
                  ) : null}
                </>
              ) : isHost ? (
                <>
                  <div className={styles.statusCopy}>
                    <Typography className={styles.statusTitle}>
                      {allPlayersReady
                        ? t('lobby.ready.title')
                        : isFull
                          ? t('lobby.ready.progress', { count: readyCount, capacity: currentRoom.capacity })
                          : t('lobby.waiting.hint', { count: currentRoom.capacity - currentRoom.members.length })}
                    </Typography>
                    <Typography className={styles.statusHint}>
                      {allPlayersReady
                        ? t('lobby.ready.hint')
                        : isFull
                          ? t('lobby.ready.description')
                          : t('lobby.waiting.description')}
                    </Typography>
                  </div>
                  <Button className={styles.startButton} type="button" disabled={!allPlayersReady || isStarting} onClick={() => void handleStart()}>
                    {isStarting ? t('lobby.button.starting') : t('lobby.button.start')}
                  </Button>
                </>
              ) : (
                <div className={styles.statusCopy}>
                  <Typography className={styles.statusTitle}>
                    {allPlayersReady
                      ? t('lobby.ready.title')
                      : isFull
                        ? t('lobby.ready.progress', { count: readyCount, capacity: currentRoom.capacity })
                        : t('lobby.waiting.hint', { count: currentRoom.capacity - currentRoom.members.length })}
                  </Typography>
                  <Typography className={styles.statusHint}>
                    {allPlayersReady
                      ? t('lobby.ready.hint')
                      : isFull
                        ? t('lobby.ready.description')
                        : t('lobby.waiting.description')}
                  </Typography>
                </div>
              )}
              {actionError ? <Typography role="alert" className={styles.error}>{actionError}</Typography> : null}
              {roomQuery.error ? (
                <div className="grid gap-2">
                  <Typography role="alert" className={styles.error}>
                    {t('lobby.refresh.failed')}
                  </Typography>
                  <Button type="button" variant="outline" onClick={() => void roomQuery.refetch()}>
                    {t('lobby.refresh.retry')}
                  </Button>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </section>
    </main>
  )
}
