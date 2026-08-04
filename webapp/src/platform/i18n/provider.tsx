import { useMemo, type PropsWithChildren } from 'react'

import { I18nContext, type I18nContextValue } from './context'
import { translate } from './translate'

export function I18nProvider({ children }: PropsWithChildren) {
  const value = useMemo<I18nContextValue>(() => ({
    t: translate,
  }), [])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
