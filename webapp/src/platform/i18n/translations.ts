import { appMessages } from './messages/app'
import { authMessages } from './messages/auth'
import { legalMessages } from './messages/legal'
import { profileMessages } from './messages/profile'
import { roomsMessages } from './messages/rooms'
import { rulesMessages } from './messages/rules'
import { tenderMessages } from './messages/tender'

// Russian translations are the primary locale and the fallback for missing locales.
export const messages = {
  ...appMessages,
  ...authMessages,
  ...legalMessages,
  ...profileMessages,
  ...roomsMessages,
  ...rulesMessages,
  ...tenderMessages,
} as const satisfies Record<string, string>

export type TranslationKey = keyof typeof messages
