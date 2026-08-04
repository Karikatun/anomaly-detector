import { messages, type TranslationKey } from './translations'

export type TranslationParams = Record<string, string | number>

export function translate(key: TranslationKey | string, params?: TranslationParams) {
  let text: string = (messages as Record<string, string>)[key] ?? key

  if (params) {
    for (const [param, replacement] of Object.entries(params)) {
      text = text.replaceAll(`{${param}}`, String(replacement))
    }
  }

  return text
}
