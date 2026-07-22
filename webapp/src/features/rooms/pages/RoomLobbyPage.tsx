import { useNavigate, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { RoomView } from '@anomaly-detector/contracts'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Typography } from '@/components/ui/typography'
import { useAuth } from '@/features/auth'
import {
  RoomsApi,
  useJoinRoomMutation,
  useLeaveRoomMutation,
  useStartRoomMutation,
} from '@/features/rooms'
import { useI18n } from '@/platform/i18n'

export function RoomLobbyPage() {
  const { t } = useI18n()
  const { roomId } = useParams({ from: '/rooms/$roomId' })
  const auth = useAuth()
  const navigate = useNavigate()
  const [room, setRoom] = useState<RoomView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const initialJoinRequest = useRef<{ roomId: string; promise: Promise<RoomView> } | null>(null)

  useEffect(() => {
    if (!auth.isBootstrapping && !auth.user) {
      void navigate({ to: '/', replace: true })
    }
  }, [auth.isBootstrapping, auth.user, navigate])

  const api = new RoomsApi(auth.transport)
  const { mutateAsync: joinRoom, isPending: isJoining } = useJoinRoomMutation({ api })
  const { mutateAsync: leaveRoom, isPending: isLeaving } = useLeaveRoomMutation({ api })
  const { mutateAsync: startRoom, isPending: isStarting } = useStartRoomMutation({ api })

  useEffect(() => {
    let cancelled = false

    const request = initialJoinRequest.current?.roomId === roomId
      ? initialJoinRequest.current.promise
      : api.join(roomId)

    initialJoinRequest.current = { roomId, promise: request }

    const fetchRoom = async () => {
      try {
        const data = await request
        if (!cancelled) {
          setRoom(data)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('lobby.error.loadFailed'))
          setLoading(false)
        }
      }
    }

    void fetchRoom()
    return () => {
      cancelled = true
    }
  }, [roomId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!room || room.status === 'started') return

    let active = true
    const interval = setInterval(async () => {
      try {
        const updated = await api.join(roomId)
        if (active) setRoom(updated)
      } catch {
        // Ignore poll errors — room may have been deleted
      }
    }, 3000)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [roomId, room]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
      if (room?.status === 'started' && room.tenderId) {
        void navigate({ to: '/tenders/$tenderId', params: { tenderId: room.tenderId } })
      }
    }, [room, navigate])

  const handleCopy = useCallback(async () => {
    try {
      // Try modern clipboard API first (requires secure context or localhost)
      await navigator.clipboard.writeText(roomId)
    } catch {
      // Fallback for HTTP origins (e.g. LAN IP access)
      const textarea = document.createElement('textarea')
      textarea.value = roomId
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      try {
        document.execCommand('copy')
      } catch {
        // Copy failed silently — user can still select the text manually
      }
      document.body.removeChild(textarea)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [roomId])

  const handleJoin = useCallback(async () => {
    try {
      const updated = await joinRoom(roomId)
      setRoom(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('rooms.create.error.generic'))
    }
  }, [joinRoom, roomId, t])

  const handleLeave = useCallback(async () => {
    try {
      await leaveRoom(roomId)
      await navigate({ to: '/rooms' })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('rooms.create.error.generic'))
    }
  }, [leaveRoom, navigate, roomId, t])

  const handleStart = useCallback(async () => {
    try {
      const updated = await startRoom(roomId)
      setRoom(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('rooms.create.error.generic'))
    }
  }, [startRoom, roomId, t])

  const isHost = room?.hostId === auth.user?.id
  const isMember = room?.members.some((m) => m.userId === auth.user?.id) ?? false
  const isFull = room ? room.members.length >= room.capacity : false

  if (loading) {
    return (
      <section className="mx-auto grid w-full max-w-2xl gap-6 px-5 py-16">
        <Card>
          <CardContent className="flex items-center justify-center py-8">
            <Spinner />
          </CardContent>
        </Card>
      </section>
    )
  }

  if (error && !room) {
    return (
      <section className="mx-auto grid w-full max-w-2xl gap-6 px-5 py-16">
        <Card>
          <CardContent className="grid gap-4 py-8">
            <Typography variant="h4" tone="destructive">
              {t('lobby.error.notFound')}
            </Typography>
            <Typography tone="muted">{error}</Typography>
            <Button asChild className="w-fit">
              <a href="/rooms">{t('lobby.button.back')}</a>
            </Button>
          </CardContent>
        </Card>
      </section>
    )
  }

  if (!room) {
    return (
      <section className="mx-auto grid w-full max-w-2xl gap-6 px-5 py-16">
        <Card>
          <CardContent className="grid gap-4 py-8">
            <Typography variant="h4">{t('lobby.error.notFound')}</Typography>
            <Typography tone="muted">{t('lobby.error.notFound.description')}</Typography>
            <Button asChild className="w-fit">
              <a href="/rooms">{t('lobby.button.back')}</a>
            </Button>
          </CardContent>
        </Card>
      </section>
    )
  }

  return (
    <section className="mx-auto grid w-full max-w-2xl gap-6 px-5 py-16">
      <div className="grid gap-2">
        <Typography variant="h1">{t('lobby.title')}</Typography>
        <Typography tone="muted">{t('lobby.description')}</Typography>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('lobby.room.id')} {room.roomId.slice(0, 8)}</CardTitle>
          <CardDescription>
            {t('lobby.players.joined', { count: room.members.length, capacity: room.capacity })}
            {room.status === 'started' ? t('lobby.players.inProgress') : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="rounded-lg border bg-muted/50 p-3">
              <Typography variant="control" tone="muted" className="mb-1">
                {t('lobby.room.id')}
              </Typography>
              <div className="flex items-center gap-3">
                <Typography variant="body" className="flex-1 select-all font-mono text-sm">{room.roomId}</Typography>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleCopy()}
                  className="shrink-0"
                >
                  {copied ? t('lobby.copied') : t('lobby.copyId')}
                </Button>
              </div>
            </div>

            <Separator />

            <div className="grid gap-2">
              <Typography variant="control" tone="muted">{t('lobby.players')}</Typography>
              {room.members.map((member) => (
                <div
                  key={member.userId}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-sm font-medium">
                    {member.seat}
                  </div>
                  <div className="grid gap-0.5">
                    <Typography variant="bodySm">
                      {t('lobby.player.label', { seat: member.seat })}
                      {member.userId === room.hostId ? (
                        <Typography as="span" variant="control" tone="muted" className="ml-2">
                          {t('lobby.player.host')}
                        </Typography>
                      ) : null}
                    </Typography>
                    <Typography variant="control" tone="muted" className="font-mono text-xs">
                      {member.userId.slice(0, 8)}
                    </Typography>
                  </div>
                </div>
              ))}
              {Array.from({ length: room.capacity - room.members.length }, (_, i) => (
                <div
                  key={`empty-${i}`}
                  className="flex items-center gap-3 rounded-lg border border-dashed p-3 opacity-50"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
                    {room.members.length + i + 1}
                  </div>
                  <Typography variant="bodySm" tone="muted">
                    {t('lobby.player.waiting')}
                  </Typography>
                </div>
              ))}
            </div>

            <Separator />

            {error && (
              <Typography role="alert" variant="bodySm" tone="destructive">{error}</Typography>
            )}

            <div className="flex flex-wrap gap-3">
              {isMember && !isHost && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isLeaving}
                  onClick={() => void handleLeave()}
                >
                  {isLeaving ? t('lobby.button.leaving') : t('lobby.button.leave')}
                </Button>
              )}

              {isHost && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isLeaving}
                    onClick={() => void handleLeave()}
                  >
                    {isLeaving ? t('lobby.button.cancelling') : t('lobby.button.cancel')}
                  </Button>
                  <Button
                    type="button"
                    size="lg"
                    disabled={!isFull || isStarting}
                    onClick={() => void handleStart()}
                  >
                    {isStarting
                      ? t('lobby.button.starting')
                      : isFull
                        ? t('lobby.button.start')
                        : t('lobby.button.waiting')}
                  </Button>
                </>
              )}

              {!isMember && room.status === 'waiting' && (
                <Button
                  type="button"
                  size="lg"
                  disabled={isJoining}
                  onClick={() => void handleJoin()}
                >
                  {isJoining ? t('lobby.button.joining') : t('lobby.button.join')}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
