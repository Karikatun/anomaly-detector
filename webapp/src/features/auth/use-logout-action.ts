import { useCallback, useState } from 'react'

import { useAuth } from './use-auth'

export function useLogoutAction() {
  const auth = useAuth()
  const [error, setError] = useState<Error | null>(null)
  const [isPending, setIsPending] = useState(false)

  const logout = useCallback(async () => {
    if (isPending) return
    setError(null)
    setIsPending(true)
    try {
      await auth.logout()
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError : new Error('Logout failed'))
    } finally {
      setIsPending(false)
    }
  }, [auth, isPending])

  return { error, isPending, logout }
}
