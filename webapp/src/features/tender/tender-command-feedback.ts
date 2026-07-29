import type { TenderView } from '@anomaly-detector/contracts'

import { ApiRequestError } from '@/platform/api'
import type { TranslationKey } from '@/platform/i18n'
import type { TenderCommandInput } from './commands'

type CommandFeedbackView = Pick<TenderView, 'publicTheses' | 'version'>

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
  && latestView.publicTheses.filter((thesis) => (
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
)

export function getTenderCommandErrorKey(context: CommandErrorContext): TranslationKey | null {
  if (acceptedThesisIsVisible(context)) return null
  if (context.error instanceof ApiRequestError && context.error.code === 'TENDER_DEADLINE_EXPIRED') {
    return 'tender.command.deadlineExpired'
  }
  if (context.error instanceof ApiRequestError && context.error.code === 'CONFLICT') {
    return 'tender.command.conflict'
  }
  return 'tender.command.fallback'
}

export function getWaitingForTurnDescription(
  phase: TenderView['phase'],
  playerName?: string,
  finalScientificModelSubmitted = false,
) {
  if (!playerName) return 'Ожидаем синхронизацию следующего хода.'
  if (phase === 'final-scientific-model') {
    return finalScientificModelSubmitted
      ? `Сейчас действует ${playerName}. Ваша финальная модель отправлена и принята сервером.`
      : `Сейчас действует ${playerName}. Ваш черновик финальной модели сохранён только в этой форме и ещё не отправлен.`
  }
  return `Сейчас действует ${playerName}. Ваш подтверждённый выбор сохранён в форме ниже.`
}
