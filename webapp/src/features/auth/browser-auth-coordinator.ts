export type BrowserAuthCoordinator = <T>(mutation: () => Promise<T>) => Promise<T>

const browserAuthLockName = 'the_game:auth-cookie-mutation'

export const coordinateBrowserAuthMutation: BrowserAuthCoordinator = async (mutation) => {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks) return mutation()

  return locks.request(browserAuthLockName, { mode: 'exclusive' }, mutation)
}
