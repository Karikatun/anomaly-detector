import type { UserDto } from '@anomaly-detector/contracts'

export type AuthUserRecord = {
  id: string
  login: string
  passwordHash: string | null
  displayName: string | null
  locale: string
  createdAt: Date
}

export type AuthenticatedPrincipal = UserDto & {
  sessionId: string
}

export function toBaseUserDto(user: AuthUserRecord): UserDto {
  return {
    id: user.id,
    login: user.login,
    displayName: user.displayName,
    locale: user.locale as 'ru' | 'en',
    createdAt: user.createdAt.toISOString(),
  }
}

export function userDtoFromPrincipal(principal: AuthenticatedPrincipal): UserDto {
  const { sessionId: _sessionId, ...user } = principal
  return user
}
