export type RoomFailureKind =
  | 'room_already_joined'
  | 'room_account_unavailable'
  | 'room_bots_not_allowed'
  | 'room_bot_creation_disabled'
  | 'room_bot_not_found'
  | 'room_current_match_exists'
  | 'room_client_update_required'
  | 'room_format_writes_disabled'
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

export function requireSupportedRoomMode(mode: string | null | undefined, standardOnly?: boolean) {
  if (standardOnly && mode === 'simple') {
    throw new RoomFailure('room_client_update_required', 'Client update required for Simple mode')
  }
}
