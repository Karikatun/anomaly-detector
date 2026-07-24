import type {
  FieldType,
  Polarity,
  SignalId,
} from '@anomaly-detector/contracts'

import type { TranslationKey } from '@/platform/i18n/translations'

export const signalIds = [
  'aster',
  'boreal',
  'cinder',
  'delta',
  'eclipse',
  'ferro',
] as const satisfies readonly SignalId[]

export const fieldTypes = [
  'inertial',
  'electromagnetic',
  'phase',
] as const satisfies readonly FieldType[]

export const polarities = [
  'positive',
  'negative',
] as const satisfies readonly Polarity[]

export const signalLabelKeys: Record<SignalId, TranslationKey> = {
  aster: 'tender.signal.aster',
  boreal: 'tender.signal.boreal',
  cinder: 'tender.signal.cinder',
  delta: 'tender.signal.delta',
  eclipse: 'tender.signal.eclipse',
  ferro: 'tender.signal.ferro',
}

export const fieldTypeLabelKeys: Record<FieldType, TranslationKey> = {
  inertial: 'tender.field.inertial',
  electromagnetic: 'tender.field.electromagnetic',
  phase: 'tender.field.phase',
}

export const polarityLabelKeys: Record<Polarity, TranslationKey> = {
  positive: 'tender.polarity.positive',
  negative: 'tender.polarity.negative',
}

export function isSignalId(value: string): value is SignalId {
  return signalIds.some((signalId) => signalId === value)
}
