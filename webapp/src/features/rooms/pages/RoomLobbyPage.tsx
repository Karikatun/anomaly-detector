import { useNavigate, useParams } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'

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

export function RoomLobbyPage() {
  const { roomId } = useParams({ from: '/rooms/$roomId' })
  const auth = useAuth()
  const navigate = useNavigate()
  const [room, setRoom] = useState<RoomView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const api = new RoomsApi(auth.transport)
  const { mutateAsync: joinRoom, isPending: isJoining } = useJoinRoomMutation({ api })
  const { mutateAsync: leaveRoom, isPending: isLeaving } = useLeaveRoomMutation({ api })
  const { mutateAsync: startRoom, isPending: isStarting } = useStartRoomMutation({ api })

  // Fetch room on mount
  useEffect(() => {
    let cancelled = false

    const fetchRoom = async () => {
      try {
        const data = await api.join(roomId)
        if (!cancelled) {
          setRoom(data)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load room')
          setLoading(false)
        }
      }
    }

    void fetchRoom()
    return () => {
      cancelled = true
    }
  }, [roomId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for room updates while waiting
  useEffect(() => {
    if (!room || room.status === 'started') return

    const interval = setInterval(async () => {
      try {
        const updated = await api.join(roomId)
        setRoom(updated)
      } catch {
        // Ignore poll errors
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [roomId, room]) // eslint-disable-line react-hooks/exhaustive-deps

  // Redirect to tender when started
  useEffect(() => {
    if (room?.status === 'started' && room.tenderId) {
      // Tender started — for now navigate to /app
      void navigate({ to: '/app' })
    }
  }, [room, navigate])

  const handleJoin = useCallback(async () => {
    try {
      const updated = await joinRoom(roomId)
      setRoom(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join room')
    }
  }, [joinRoom, roomId])

  const handleLeave = useCallback(async () => {
    try {
      await leaveRoom(roomId)
      await navigate({ to: '/rooms' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave room')
    }
  }, [leaveRoom, navigate, roomId])

  const handleStart = useCallback(async () => {
    try {
      const updated = await startRoom(roomId)
      setRoom(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start room')
    }
  }, [startRoom, roomId])

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
              Room not found
            </Typography>
            <Typography tone="muted">{error}</Typography>
            <Button asChild className="w-fit">
              <a href="/rooms">Back to rooms</a>
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
            <Typography variant="h4">Room not found</Typography>
            <Typography tone="muted">
              This room does not exist or has expired.
            </Typography>
            <Button asChild className="w-fit">
              <a href="/rooms">Back to rooms</a>
            </Button>
          </CardContent>
        </Card>
      </section>
    )
  }

  return (
    <section className="mx-auto grid w-full max-w-2xl gap-6 px-5 py-16">
      <div className="grid gap-2">
        <Typography variant="h1">Tender Room</Typography>
        <Typography tone="muted">
          Share the room ID with other players to invite them.
        </Typography>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Room {room.roomId.slice(0, 8)}</CardTitle>
          <CardDescription>
            {room.members.length}/{room.capacity} players joined
            {room.status === 'started' ? ' — Tender in progress' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            {/* Room ID for sharing */}
            <div className="rounded-lg border bg-muted/50 p-3">
              <Typography variant="control" tone="muted" className="mb-1">
                Room ID
              </Typography>
              <Typography variant="body" className="font-mono text-sm">
                {room.roomId}
              </Typography>
            </div>

            <Separator />

            {/* Player list */}
            <div className="grid gap-2">
              <Typography variant="control" tone="muted">
                Players
              </Typography>
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
                      Player {member.seat}
                      {member.userId === room.hostId ? (
                        <Typography as="span" variant="control" tone="muted" className="ml-2">
                          (Host)
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
                    Waiting for player...
                  </Typography>
                </div>
              ))}
            </div>

            <Separator />

            {/* Error message */}
            {error && (
              <Typography role="alert" variant="bodySm" tone="destructive">
                {error}
              </Typography>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-3">
              {isMember && !isHost && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={isLeaving}
                  onClick={() => void handleLeave()}
                >
                  {isLeaving ? 'Leaving...' : 'Leave room'}
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
                    {isLeaving ? 'Cancelling...' : 'Cancel room'}
                  </Button>
                  <Button
                    type="button"
                    size="lg"
                    disabled={!isFull || isStarting}
                    onClick={() => void handleStart()}
                  >
                    {isStarting
                      ? 'Starting...'
                      : isFull
                        ? 'Start Tender'
                        : 'Waiting for players...'}
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
                  {isJoining ? 'Joining...' : 'Join room'}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}