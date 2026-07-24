import { useNavigate, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { RoomView } from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { useAuth } from '@/features/auth'
import {
  RoomsApi,
  useCancelRoomStartMutation,
  useJoinRoomMutation,
  useLeaveRoomMutation,
  useRoomQuery,
  useSetRoomReadyMutation,
  useStartRoomMutation,
} from '@/features/rooms'
import { useI18n } from '@/platform/i18n'

import styles from './RoomLobbyPage.module.css'

export function RoomLobbyPage() {
  const { t } = useI18n()
  const { roomId } = useParams({ from: '/rooms/$roomId' })
  const auth = useAuth()
  const navigate = useNavigate()
  const [room, setRoom] = useState<RoomView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const initialJoinRequest = useRef<{ roomId: string; promise: Promise<RoomView> } | null>(null)

  useEffect(() => {
    if (!auth.isBootstrapping && !auth.user) {
      void navigate({ to: '/', replace: true })
    }
  }, [auth.isBootstrapping, auth.user, navigate])

  const api = useMemo(() => new RoomsApi(auth.transport), [auth.transport])
  const { mutateAsync: joinRoom, isPending: isJoining } = useJoinRoomMutation({ api })
  const { mutateAsync: leaveRoom, isPending: isLeaving } = useLeaveRoomMutation({ api })
  const { mutateAsync: setRoomReady, isPending: isSettingReady } = useSetRoomReadyMutation({ api })
  const { mutateAsync: startRoom, isPending: isStarting } = useStartRoomMutation({ api })
  const { mutateAsync: cancelRoomStart, isPending: isCancellingStart } = useCancelRoomStartMutation({ api })
  const roomQuery = useRoomQuery({ api, enabled: room !== null, roomId })
  const currentRoom = roomQuery.data ?? room

  useEffect(() => {
    let cancelled = false
    const request = initialJoinRequest.current?.roomId === roomId
      ? initialJoinRequest.current.promise
      : api.join(roomId)
    initialJoinRequest.current = { roomId, promise: request }

    void request
      .then((data) => {
        if (!cancelled) {
          setRoom(data)
          setError(null)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('lobby.error.loadFailed'))
          setLoading(false)
        }
      })

    return () => { cancelled = true }
  }, [roomId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (currentRoom?.status !== 'starting') return
    const interval = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(interval)
  }, [currentRoom?.status])

  useEffect(() => {
    if (currentRoom?.status === 'started' && currentRoom.tenderId) {
      void navigate({ to: '/tenders/$tenderId', params: { tenderId: currentRoom.tenderId } })
    }
  }, [currentRoom, navigate])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(roomId)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = roomId
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2_000)
  }, [roomId])

  const runRoomAction = useCallback(async <T,>(
    action: () => Promise<T>,
    onSuccess: (result: T) => void | Promise<void>,
  ) => {
    setError(null)
    try {
      await onSuccess(await action())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('rooms.create.error.generic'))
    }
  }, [t])

  const handleJoin = useCallback(
    () => runRoomAction(
      () => joinRoom(roomId),
      (nextRoom) => setRoom(nextRoom),
    ),
    [joinRoom, roomId, runRoomAction],
  )

  const handleLeave = useCallback(
    () => runRoomAction(
      () => leaveRoom(roomId),
      () => navigate({ to: '/' }),
    ),
    [leaveRoom, navigate, roomId, runRoomAction],
  )

  const handleStart = useCallback(
    () => runRoomAction(
      () => startRoom(roomId),
      (nextRoom) => setRoom(nextRoom),
    ),
    [roomId, runRoomAction, startRoom],
  )

  const handleReadyChange = useCallback(
    (ready: boolean) => runRoomAction(
      () => setRoomReady({ ready, roomId }),
      (nextRoom) => setRoom(nextRoom),
    ),
    [roomId, runRoomAction, setRoomReady],
  )

  const handleCancelStart = useCallback(
    () => runRoomAction(
      () => cancelRoomStart(roomId),
      (nextRoom) => setRoom(nextRoom),
    ),
    [cancelRoomStart, roomId, runRoomAction],
  )

  if (loading) {
    return <main className={styles.loading}><Spinner /></main>
  }

  if (!currentRoom) {
    return (
      <main className={styles.errorScreen}>
        <Typography variant="h3">{t('lobby.error.notFound')}</Typography>
        <Typography tone="muted">{error ?? t('lobby.error.notFound.description')}</Typography>
        <Button asChild><a href="/">{t('lobby.button.back')}</a></Button>
      </main>
    )
  }

  const isHost = currentRoom.hostId === auth.user?.id
  const isMember = currentRoom.members.some((member) => member.userId === auth.user?.id)
  const isFull = currentRoom.members.length >= currentRoom.capacity
  const readyCount = currentRoom.members.filter((member) => member.ready).length
  const allPlayersReady = isFull && readyCount === currentRoom.capacity
  const isCountdown = currentRoom.status === 'starting'
  const secondsLeft = currentRoom.startsAt
    ? Math.max(0, Math.ceil((Date.parse(currentRoom.startsAt) - now) / 1_000))
    : 5
  const canLeave = isMember && currentRoom.status === 'waiting'

  return (
    <main className={styles.screen}>
      <section className={styles.panel} aria-label={t('lobby.title')}>
        <header className={styles.header}>
          <button type="button" className={styles.roomCode} onClick={() => void handleCopy()}>
            <span>{t('lobby.room.id')}</span>
            <strong>{currentRoom.roomId.slice(0, 8).toUpperCase()}</strong>
            <span className={styles.copyIcon} aria-hidden="true" />
            <span className="sr-only">{copied ? t('lobby.copied') : t('lobby.copyId')}</span>
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
              <div className={styles.playerList}>
                  {Array.from({ length: currentRoom.capacity }, (_, index) => {
                  const seat = index + 1
                  const member = currentRoom.members.find((candidate) => candidate.seat === seat)
                  const isPlayerHost = member?.userId === currentRoom.hostId
                  return (
                    <div className={styles.player} data-empty={!member || undefined} key={seat}>
                      <span className={styles.avatar} aria-hidden="true">{member ? seat : '+'}</span>
                      <div className={styles.playerCopy}>
                        <Typography className={styles.playerName}>
                          {member ? t('lobby.player.label', { seat }) : t('lobby.player.waiting')}
                        </Typography>
                        {isPlayerHost ? <span className={styles.hostLabel}>{t('lobby.player.host')}</span> : null}
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
                        <span className={styles.playerReadiness} data-ready={member.ready || undefined}>
                          <span className={styles.playerState} aria-hidden="true" />
                          {member.ready ? t('lobby.player.ready') : t('lobby.player.notReady')}
                        </span>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </section>

            <section className={styles.settingsPanel}>
              <Typography as="h2" className={styles.sectionTitle}>{t('lobby.settings.title')}</Typography>
              <dl className={styles.settingsList}>
                <div><dt>{t('lobby.settings.mode')}</dt><dd>{t('lobby.settings.mode.value')}</dd></div>
                <div><dt>{t('lobby.settings.players')}</dt><dd>{currentRoom.capacity}</dd></div>
                <div><dt>{t('lobby.settings.turnTime')}</dt><dd>{t('lobby.settings.turnTime.value')}</dd></div>
              </dl>
            </section>
          </aside>

          <div className={styles.rightColumn}>
            <section
              className={styles.startPanel}
              data-state={isCountdown ? 'starting' : allPlayersReady ? 'ready' : 'waiting'}
              aria-live="polite"
            >
              <span className={styles.statusIndicator} aria-hidden="true">
                {isCountdown ? secondsLeft : null}
              </span>
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
              ) : !isMember && currentRoom.status === 'waiting' ? (
                <>
                  <div className={styles.statusCopy}>
                    <Typography className={styles.statusTitle}>{t('lobby.waiting.hint', { count: currentRoom.capacity - currentRoom.members.length })}</Typography>
                    <Typography className={styles.statusHint}>{t('lobby.waiting.description')}</Typography>
                  </div>
                  <Button className={styles.joinButton} type="button" disabled={isJoining} onClick={() => void handleJoin()}>
                    {isJoining ? t('lobby.button.joining') : t('lobby.button.join')}
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
              {error ? <Typography role="alert" className={styles.error}>{error}</Typography> : null}
              {roomQuery.error ? (
                <div className="grid gap-2">
                  <Typography role="alert" className={styles.error}>
                    Не удалось обновить состояние комнаты. Показаны последние полученные данные.
                  </Typography>
                  <Button type="button" variant="outline" onClick={() => void roomQuery.refetch()}>
                    Повторить обновление
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
