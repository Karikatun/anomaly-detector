export type RoomFailureKind = 'room_already_joined' | 'room_full' | 'room_not_found' | 'room_not_joinable'

export class RoomFailure extends Error {
  constructor(
    public readonly kind: RoomFailureKind,
    message: string,
  ) {
    super(message)
  }
}
