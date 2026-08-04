import { translate } from '../../platform/i18n'
import type { TenderView } from '@anomaly-detector/contracts'

import { ApiRequestError } from '@/platform/api'
import type { TranslationKey } from '@/platform/i18n'
import type { TenderCommandInput } from './commands'

type CommandFeedbackView = Pick<TenderView, 'privateTheses' | 'publicTheses' | 'version'>

type CommandErrorContext = {
  actorId: string
  command: TenderCommandInput
  error: unknown
  latestView: CommandFeedbackView | null | undefined
  startingView: CommandFeedbackView | null | undefined
}

const acceptedThesisIsVisible = ({
  actorId,
  command,
  latestView,
  startingView,
}: Omit<CommandErrorContext, 'error'>) => (
  command.type === 'submit-thesis'
  && startingView !== null
  && startingView !== undefined
  && latestView !== null
  && latestView !== undefined
  && latestView.version > startingView.version
  && (
    latestView.publicTheses.filter((thesis) => (
      thesis.playerId === actorId
      && thesis.signalId === command.signalId
      && thesis.fieldType === command.fieldType
      && thesis.polarity === command.polarity
    )).length > startingView.publicTheses.filter((thesis) => (
      thesis.playerId === actorId
      && thesis.signalId === command.signalId
      && thesis.fieldType === command.fieldType
      && thesis.polarity === command.polarity
    )).length
    || (latestView.privateTheses ?? []).filter((thesis) => (
      thesis.signalId === command.signalId
      && thesis.fieldType === command.fieldType
      && thesis.polarity === command.polarity
    )).length > (startingView.privateTheses ?? []).filter((thesis) => (
      thesis.signalId === command.signalId
      && thesis.fieldType === command.fieldType
      && thesis.polarity === command.polarity
    )).length
  )
)

export function getTenderCommandErrorKey(context: CommandErrorContext): TranslationKey | null {
  if (acceptedThesisIsVisible(context)) return null
  if (context.error instanceof ApiRequestError && context.error.code === 'TENDER_DEADLINE_EXPIRED') {
    return 'tender.command.deadlineExpired'
  }
  if (context.error instanceof ApiRequestError && context.error.code === 'TENDER_EVIDENCE_UNAVAILABLE') {
    return 'tender.command.evidenceUnavailable'
  }
  if (context.error instanceof ApiRequestError && context.error.code === 'TENDER_LABORATORY_PAIR_ALREADY_RESEARCHED') {
    return 'tender.command.laboratoryPairAlreadyResearched'
  }
  if (context.error instanceof ApiRequestError && (
    context.error.code === 'CONFLICT'
    || context.error.code === 'TENDER_ACTION_UNAVAILABLE'
    || context.error.code === 'TENDER_COMMAND_CONFLICT'
    || context.error.code === 'TENDER_VERSION_CONFLICT'
  )) {
    return 'tender.command.conflict'
  }
  return 'tender.command.fallback'
}

export function getWaitingForTurnDescription(
  phase: TenderView['phase'],
  playerName?: string,
  finalScientificModelSubmitted = false,
  progress?: TenderView['sequentialPhaseProgress'],
) {
  if (!playerName) return translate('tender.tender-command-feedback.copy.001')
  const progressText = progress
    ? translate('tender.tender-command-feedback.copy.002', { value1: progress.completed, value2: progress.total })
    : ''
  if (phase === 'final-scientific-model') {
    return finalScientificModelSubmitted
      ? translate('tender.tender-command-feedback.copy.003', { value1: playerName })
      : translate('tender.tender-command-feedback.copy.004', { value1: playerName })
  }
  return translate('tender.tender-command-feedback.copy.005', { value1: playerName, value2: progressText })
}
