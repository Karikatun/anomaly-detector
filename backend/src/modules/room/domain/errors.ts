export type RoomFailureKind =
  | 'room_already_joined'
  | 'room_full'
  | 'room_not_found'
  | 'room_not_host'
  | 'room_not_joinable'
  | 'room_not_member'
  | 'room_not_ready'

export class RoomFailure extends Error {
  constructor(
    public readonly kind: RoomFailureKind,
    message: string,
  ) {
    super(message)
  }
}
