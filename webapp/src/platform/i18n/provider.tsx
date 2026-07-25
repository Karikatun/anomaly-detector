import { useMemo, type PropsWithChildren } from 'react'

import { I18nContext, type I18nContextValue } from './context'
import { messages } from './translations'

export function I18nProvider({ children }: PropsWithChildren) {
  const value = useMemo<I18nContextValue>(() => ({
    t: (key, params) => {
      let text: string = (messages as Record<string, string>)[key] ?? key
      if (params) {
        for (const [param, replacement] of Object.entries(params)) {
          text = text.replace(`{${param}}`, String(replacement))
        }
      }
      return text
    },
  }), [])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
