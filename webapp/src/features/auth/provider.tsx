import { useQueryClient } from '@tanstack/react-query'
import type {
  LoginRequest,
  OAuthProviderId,
  OAuthStartRequest,
  RegisterRequest,
  UpdateProfileRequest,
} from '@anomaly-detector/contracts'
import {
  type PropsWithChildren,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { productAnalytics } from '@/platform/analytics/product-analytics'
import { isMetrikaOAuthLoginSuccess, metrika } from '@/platform/analytics/metrika'
import { AuthApi } from './api'
import {
  clearAuthenticatedSession,
  useCurrentUserQuery,
  useDeleteAccountMutation,
  useLoginMutation,
  useLogoutMutation,
  useRegisterMutation,
} from './queries'
import { AuthContext, type AuthContextValue } from './context'
import { bootstrapAuthSession } from './bootstrap'
import { subscribeToBrowserSessionChanges } from './session-coordinator'

const metrikaOAuthPendingStorageKey = 'anomaly-detector:metrika-oauth-pending'

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient()
  const [accessToken, setAccessTokenState] = useState<string | null>(null)
  const [isBootstrapping, setIsBootstrapping] = useState(true)
  const [bootstrapError, setBootstrapError] = useState<Error | null>(null)
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0)
  const bootstrapGeneration = useRef(0)
  const sentRegistrationAnalyticsVersion = useRef(0)
  const [passwordLoginTransition, setPasswordLoginTransition] = useState(0)
  const [oauthCallbackSearch] = useState(() => {
    if (typeof window === 'undefined') return ''
    return window.location.search
  })
  const [registrationAnalyticsVersion, setRegistrationAnalyticsVersion] = useState(() => {
    if (typeof window === 'undefined') return 0
    return new URL(window.location.href).searchParams.get('analytics_registration') === '1' ? 1 : 0
  })

  const setAccessToken = useCallback(
    (nextAccessToken: string | null) => setAccessTokenState(nextAccessToken),
    [],
  )
  const clearLocalSession = useCallback(async () => {
    await clearAuthenticatedSession(queryClient, setAccessToken)
  }, [queryClient, setAccessToken])
  const handleAuthExpired = useCallback(async () => {
    await clearLocalSession()
  }, [clearLocalSession])

  useEffect(
    () =>
      subscribeToBrowserSessionChanges((sessionEvent) => {
        const generation = ++bootstrapGeneration.current
        const shouldBootstrap = sessionEvent.state === 'authenticated'
        setBootstrapError(null)
        setIsBootstrapping(shouldBootstrap)
        void clearLocalSession()
          .catch(() => undefined)
          .then(() => {
            if (bootstrapGeneration.current !== generation) return
            if (shouldBootstrap) {
              setBootstrapAttempt((attempt) => attempt + 1)
            } else {
              setIsBootstrapping(false)
            }
          })
      }),
    [clearLocalSession],
  )

  const api = useMemo(
    () =>
      new AuthApi({
        getAccessToken: () => accessToken,
        setAccessToken,
        onAuthExpired: handleAuthExpired,
      }),
    [accessToken, handleAuthExpired, setAccessToken],
  )

  useEffect(() => {
    let isMounted = true
    const generation = ++bootstrapGeneration.current
    const shouldApply = () => isMounted && bootstrapGeneration.current === generation
    const bootstrapApi = new AuthApi({
      getAccessToken: () => null,
      setAccessToken,
      onAuthExpired: handleAuthExpired,
    })

    bootstrapAuthSession({
      api: bootstrapApi,
      shouldApply,
      setAccessToken,
    })
      .catch((error: unknown) => {
        if (shouldApply()) {
          setBootstrapError(toError(error))
        }
      })
      .finally(() => {
        if (shouldApply()) {
          setIsBootstrapping(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [bootstrapAttempt, handleAuthExpired, setAccessToken])

  const meQuery = useCurrentUserQuery({
    api,
    enabled: !isBootstrapping && Boolean(accessToken),
  })
  const { mutateAsync: registerAsync } = useRegisterMutation({ api, setAccessToken })
  const { mutateAsync: loginAsync } = useLoginMutation({ api, setAccessToken })
  const { mutateAsync: logoutAsync } = useLogoutMutation({ api, setAccessToken })
  const { mutateAsync: deleteAccountAsync } = useDeleteAccountMutation({ api, setAccessToken })

  useEffect(() => {
    if (typeof window !== 'undefined' && new URL(window.location.href).searchParams.has('auth_error')) {
      clearMetrikaOAuthPending()
    }
  }, [])

  useEffect(() => {
    if (passwordLoginTransition === 0) return
    metrika.record('login_success', `password:${passwordLoginTransition}`)
  }, [passwordLoginTransition])

  useEffect(() => {
    if (!meQuery.data?.user || typeof window === 'undefined') return
    const transitionId = sessionStorage.getItem(metrikaOAuthPendingStorageKey)
    if (!transitionId) return
    sessionStorage.removeItem(metrikaOAuthPendingStorageKey)
    if (isMetrikaOAuthLoginSuccess(oauthCallbackSearch)) {
      metrika.record('login_success', `oauth:${transitionId}`)
    }
  }, [meQuery.data?.user, oauthCallbackSearch])

  useEffect(() => {
    if (
      registrationAnalyticsVersion === 0
      || !meQuery.data?.user
      || sentRegistrationAnalyticsVersion.current === registrationAnalyticsVersion
    ) return
    sentRegistrationAnalyticsVersion.current = registrationAnalyticsVersion
    const url = new URL(window.location.href)
    url.searchParams.delete('analytics_registration')
    window.history.replaceState(window.history.state, '', url)
    void productAnalytics.record('registration_complete')
    metrika.record('registration_complete', `registration:${registrationAnalyticsVersion}`)
  }, [meQuery.data?.user, registrationAnalyticsVersion])

  const updateProfile = useCallback(
    async (input: UpdateProfileRequest) => {
      await api.updateProfile(input)
      await meQuery.refetch()
    },
    [api, meQuery],
  )

  const register = useCallback(
    async (input: RegisterRequest) => {
      clearMetrikaOAuthPending()
      await registerAsync(input)
      setRegistrationAnalyticsVersion((version) => version + 1)
    },
    [registerAsync],
  )

  const login = useCallback(
    async (input: LoginRequest) => {
      clearMetrikaOAuthPending()
      await loginAsync(input)
      setPasswordLoginTransition((transition) => transition + 1)
    },
    [loginAsync],
  )

  const startOAuth = useCallback(
    async (
      provider: OAuthProviderId,
      registration?: OAuthStartRequest['registration'],
    ) => {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(metrikaOAuthPendingStorageKey, crypto.randomUUID())
      }
      try {
        await api.startOAuth(provider, registration)
      } catch (error) {
        clearMetrikaOAuthPending()
        throw error
      }
    },
    [api],
  )

  const logout = useCallback(async () => {
    await logoutAsync()
  }, [logoutAsync])

  const deleteAccount = useCallback(async () => {
    await deleteAccountAsync()
  }, [deleteAccountAsync])

  const retrySession = useCallback(async () => {
    if (accessToken) {
      await meQuery.refetch()
      return
    }

    setIsBootstrapping(true)
    setBootstrapError(null)
    setBootstrapAttempt((attempt) => attempt + 1)
  }, [accessToken, meQuery])

  const sessionError = bootstrapError ?? (accessToken ? toOptionalError(meQuery.error) : null)
  const isSessionLoading = isBootstrapping || Boolean(accessToken && meQuery.isPending)
  const transport = useMemo(
    () => ({
      request: api.requestAuthenticated.bind(api),
      requestNoContent: api.requestAuthenticatedNoContent.bind(api),
    }),
    [api],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data?.user ?? null,
      isBootstrapping: isSessionLoading,
      isAuthenticated: Boolean(meQuery.data?.user),
      sessionError,
      retrySession,
      transport,
      register,
      login,
      startOAuth,
      deleteAccount,
      logout,
      updateProfile,
    }),
    [deleteAccount, isSessionLoading, login, logout, meQuery.data?.user, register, retrySession, sessionError, startOAuth, transport, updateProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function clearMetrikaOAuthPending() {
  if (typeof window !== 'undefined') sessionStorage.removeItem(metrikaOAuthPendingStorageKey)
}

function toOptionalError(error: unknown) {
  return error === null || error === undefined ? null : toError(error)
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error('Unknown session error')
}
