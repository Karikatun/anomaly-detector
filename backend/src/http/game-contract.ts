import {
  gameContractVersionHeader,
  gameContractVersionSchema,
  type GameContractVersion,
} from '@anomaly-detector/contracts'
import { createMiddleware } from 'hono/factory'

import { AppError } from './errors'

export type GameContractHttpEnv = {
  Variables: { gameContractVersion: GameContractVersion }
}

export const withGameContractVersion = createMiddleware<GameContractHttpEnv>(async (c, next) => {
  c.set('gameContractVersion', requireGameContractVersion(c.req.header(gameContractVersionHeader)))
  c.header('Vary', gameContractVersionHeader, { append: true })
  await next()
})

function requireGameContractVersion(value: string | undefined) {
  const result = gameContractVersionSchema.safeParse(value)
  if (!result.success) throw new AppError(400, 'BAD_REQUEST', 'Unsupported game contract version')
  return result.data
}

export const gameClientUpdateMessage = 'Обновите страницу, чтобы открыть партию в простом режиме.'
