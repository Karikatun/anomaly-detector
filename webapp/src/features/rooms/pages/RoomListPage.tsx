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

export function RoomListPage() {
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
      setCreateError('Invalid room capacity')
      return
    }

    try {
      const room = await createRoom(result.data)
      await navigate({ to: '/rooms/$roomId', params: { roomId: room.roomId } })
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Failed to create room')
    }
  }

  return (
    <section className="mx-auto grid w-full max-w-2xl gap-6 px-5 py-16">
      <div className="grid gap-2">
        <Typography variant="h1">Tender Rooms</Typography>
        <Typography tone="muted">
          Create a private room and invite other players to start a Tender.
        </Typography>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create a room</CardTitle>
          <CardDescription>Choose the number of players for this Tender.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="room-capacity">Number of players</FieldLabel>
              <NativeSelect
                id="room-capacity"
                value={String(capacity)}
                onChange={(e) => setCapacity(Number(e.target.value) as 2 | 3 | 4)}
              >
                <option value="2">2 players</option>
                <option value="3">3 players</option>
                <option value="4">4 players</option>
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
              {isCreating ? 'Creating...' : 'Create room'}
            </Button>
          </FieldGroup>
        </CardContent>
      </Card>
    </section>
  )
}