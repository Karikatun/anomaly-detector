import type {
  LoginRequest,
  OAuthProviderId,
  RegisterRequest,
  UpdateProfileRequest,
  UserDto,
} from '@anomaly-detector/contracts'
import { createContext } from 'react'
import type { AuthenticatedTransport } from '@/platform/api'

export type AuthContextValue = {
  user: UserDto | null
  isBootstrapping: boolean
  isAuthenticated: boolean
  sessionError: Error | null
  retrySession: () => Promise<void>
  transport: AuthenticatedTransport
  register: (input: RegisterRequest) => Promise<void>
  login: (input: LoginRequest) => Promise<void>
  startOAuth: (provider: OAuthProviderId) => Promise<void>
  logout: () => Promise<void>
  updateProfile: (input: UpdateProfileRequest) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
