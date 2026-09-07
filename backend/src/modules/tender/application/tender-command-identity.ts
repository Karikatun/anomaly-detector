import type { TenderCommand } from '@anomaly-detector/contracts'
import {
  tenderReservedCommandIdPrefix,
  tenderStorageCommandIdPrefix,
} from '@anomaly-detector/contracts'
import { createHash } from 'node:crypto'

const hashCommandId = (domain: string, commandId: string) => createHash('sha256')
  .update(domain)
  .update(commandId)
  .digest('hex')

export const tenderStorageCommandId = (commandId: string) =>
  `${tenderStorageCommandIdPrefix}${hashCommandId('tender-command-storage-v1\0', commandId)}`

export const tenderDeletedCommandId = (commandId: string) =>
  `${tenderReservedCommandIdPrefix}${hashCommandId('tender-command-deletion-v1\0', commandId)}`

export const tenderCommandLookupIds = (commandId: string) => [
  tenderStorageCommandId(commandId),
  commandId,
  tenderDeletedCommandId(commandId),
]

export const tenderCommandFingerprint = (command: TenderCommand) => JSON.stringify({
  ...command,
  commandId: tenderStorageCommandId(command.commandId),
})

const legacyTenderCommandFingerprint = (command: TenderCommand) => JSON.stringify(command)

export const tenderCommandFingerprintMatches = (
  storedFingerprint: string,
  command: TenderCommand,
) => storedFingerprint === tenderCommandFingerprint(command)
  || storedFingerprint === legacyTenderCommandFingerprint(command)
