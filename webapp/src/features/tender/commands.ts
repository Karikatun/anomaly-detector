import type { CommandReceipt, TenderCommand } from '@anomaly-detector/contracts'
import { commandReceiptSchema } from '@anomaly-detector/contracts'
import { useCallback } from 'react'

import type { AuthenticatedTransport } from '@/platform/api'

export function useTenderCommands(transport: AuthenticatedTransport, tenderId: string) {
  const execute = useCallback(
    async (command: Omit<TenderCommand, 'commandId' | 'tenderId' | 'actorId'> & {
      type: TenderCommand['type']
      actorId: string
    }): Promise<CommandReceipt> => {
      const fullCommand = {
        ...command,
        commandId: crypto.randomUUID(),
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
