import { useNavigate, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'

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
  const [now, setNow] = useState(Date.now())
  const initialJoinRequest = useRef<{ roomId: string; promise: Promise<RoomView> } | null>(null)

  useEffect(() => {
    if (!auth.isBootstrapping && !auth.user) {
      void navigate({ to: '/', replace: true })
    }
  }, [auth.isBootstrapping, auth.user, navigate])

  const api = new RoomsApi(auth.transport)
  const { mutateAsync: joinRoom, isPending: isJoining } = useJoinRoomMutation({ api })
  const { mutateAsync: leaveRoom, isPending: isLeaving } = useLeaveRoomMutation({ api })
  const { mutateAsync: setRoomReady, isPending: isSettingReady } = useSetRoomReadyMutation({ api })
  const { mutateAsync: startRoom, isPending: isStarting } = useStartRoomMutation({ api })
  const { mutateAsync: cancelRoomStart, isPending: isCancellingStart } = useCancelRoomStartMutation({ api })

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
    if (!room || room.status === 'started') return

    let active = true
    const interval = setInterval(async () => {
      try {
        const updated = await api.join(roomId)
        if (active) setRoom(updated)
      } catch {
        // The next navigation or user action will surface a meaningful error.
      }
    }, room.status === 'starting' ? 1_000 : 3_000)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [roomId, room?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (room?.status !== 'starting') return
    const interval = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(interval)
  }, [room?.status])

  useEffect(() => {
    if (room?.status === 'started' && room.tenderId) {
      void navigate({ to: '/tenders/$tenderId', params: { tenderId: room.tenderId } })
    }
  }, [room, navigate])

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

  const handleJoin = useCallback(async () => {
    try {
      setRoom(await joinRoom(roomId))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('rooms.create.error.generic'))
    }
  }, [joinRoom, roomId, t])

  const handleLeave = useCallback(async () => {
    try {
      await leaveRoom(roomId)
      await navigate({ to: '/' })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('rooms.create.error.generic'))
    }
  }, [leaveRoom, navigate, roomId, t])

  const handleStart = useCallback(async () => {
    try {
      setRoom(await startRoom(roomId))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('rooms.create.error.generic'))
    }
  }, [startRoom, roomId, t])

  const handleReadyChange = useCallback(async (ready: boolean) => {
    try {
      setError(null)
      setRoom(await setRoomReady({ ready, roomId }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('rooms.create.error.generic'))
    }
  }, [roomId, setRoomReady, t])

  const handleCancelStart = useCallback(async () => {
    try {
      setRoom(await cancelRoomStart(roomId))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('rooms.create.error.generic'))
    }
  }, [cancelRoomStart, roomId, t])

  if (loading) {
    return <main className={styles.loading}><Spinner /></main>
  }

  if (!room) {
    return (
      <main className={styles.errorScreen}>
        <Typography variant="h3">{t('lobby.error.notFound')}</Typography>
        <Typography tone="muted">{error ?? t('lobby.error.notFound.description')}</Typography>
        <Button asChild><a href="/">{t('lobby.button.back')}</a></Button>
      </main>
    )
  }

  const isHost = room.hostId === auth.user?.id
  const isMember = room.members.some((member) => member.userId === auth.user?.id)
  const isFull = room.members.length >= room.capacity
  const readyCount = room.members.filter((member) => member.ready).length
  const allPlayersReady = isFull && readyCount === room.capacity
  const isCountdown = room.status === 'starting'
  const secondsLeft = room.startsAt
    ? Math.max(0, Math.ceil((Date.parse(room.startsAt) - now) / 1_000))
    : 5
  const canLeave = isMember && room.status === 'waiting'

  return (
    <main className={styles.screen}>
      <section className={styles.panel} aria-label={t('lobby.title')}>
        <header className={styles.header}>
          <button type="button" className={styles.roomCode} onClick={() => void handleCopy()}>
            <span>{t('lobby.room.id')}</span>
            <strong>{room.roomId.slice(0, 8).toUpperCase()}</strong>
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
                {Array.from({ length: room.capacity }, (_, index) => {
                  const seat = index + 1
                  const member = room.members.find((candidate) => candidate.seat === seat)
                  const isPlayerHost = member?.userId === room.hostId
                  return (
                    <div className={styles.player} data-empty={!member || undefined} key={seat}>
                      <span className={styles.avatar} aria-hidden="true">{member ? seat : '+'}</span>
                      <div className={styles.playerCopy}>
                        <Typography className={styles.playerName}>
                          {member ? t('lobby.player.label', { seat }) : t('lobby.player.waiting')}
                        </Typography>
                        {isPlayerHost ? <span className={styles.hostLabel}>{t('lobby.player.host')}</span> : null}
                      </div>
                      {member && member.userId === auth.user?.id && room.status === 'waiting' ? (
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
                <div><dt>{t('lobby.settings.players')}</dt><dd>{room.capacity}</dd></div>
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
                          ? t('lobby.ready.progress', { count: readyCount, capacity: room.capacity })
                          : t('lobby.waiting.hint', { count: room.capacity - room.members.length })}
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
              ) : !isMember && room.status === 'waiting' ? (
                <>
                  <div className={styles.statusCopy}>
                    <Typography className={styles.statusTitle}>{t('lobby.waiting.hint', { count: room.capacity - room.members.length })}</Typography>
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
                        ? t('lobby.ready.progress', { count: readyCount, capacity: room.capacity })
                        : t('lobby.waiting.hint', { count: room.capacity - room.members.length })}
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
            </section>
          </div>
        </div>
      </section>
    </main>
  )
}
