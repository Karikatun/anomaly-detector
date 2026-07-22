import type { CommandReceipt, TenderCommand } from '@anomaly-detector/contracts'
import { commandReceiptSchema } from '@anomaly-detector/contracts'
import { useCallback } from 'react'

import type { AuthenticatedTransport } from '@/platform/api'

function randomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for HTTP origins where crypto.randomUUID is not available
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function useTenderCommands(transport: AuthenticatedTransport, tenderId: string) {
  const execute = useCallback(
    async (command: Omit<TenderCommand, 'commandId' | 'tenderId' | 'actorId'> & {
      type: TenderCommand['type']
      actorId: string
    }): Promise<CommandReceipt> => {
      const fullCommand = {
        ...command,
        commandId: randomUUID(),
        tenderId,
      } as TenderCommand

      return transport.request(
        `/api/tenders/${tenderId}/commands`,
        commandReceiptSchema,
        { method: 'POST', body: fullCommand },
      )
    },
    [transport, tenderId],
  )

  return { execute }
}
