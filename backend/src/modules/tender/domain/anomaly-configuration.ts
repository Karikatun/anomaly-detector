export const signalIds = ['aster', 'boreal', 'cinder', 'delta', 'eclipse', 'ferro'] as const
export const fieldTypes = ['inertial', 'electromagnetic', 'phase'] as const
export const polarities = ['positive', 'negative'] as const

export type SignalId = (typeof signalIds)[number]
export type FieldType = (typeof fieldTypes)[number]
export type Polarity = (typeof polarities)[number]
export type PublicResult = 'attenuation' | 'reflection' | 'transmission_gain' | 'unstable_collapse'

export type SignalProperties = {
  fieldType: FieldType
  polarity: Polarity
}

export type AnomalyConfiguration = {
  seed: string
  signals: Record<SignalId, SignalProperties>
}

const createSeededRandom = (seed: string) => {
  let value = 2_166_136_261
  for (const character of seed) {
    value ^= character.charCodeAt(0)
    value = Math.imul(value, 16_777_619)
  }

  return () => {
    value += 0x6d2b79f5
    let next = value
    next = Math.imul(next ^ (next >>> 15), next | 1)
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61)
    return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296
  }
}

const shuffledPropertyPairs = (seed: string): SignalProperties[] => {
  const random = createSeededRandom(seed)
  const pairs = fieldTypes.flatMap((fieldType) => polarities.map((polarity) => ({ fieldType, polarity })))

  for (let index = pairs.length - 1; index > 0; index -= 1) {
    const otherIndex = Math.floor(random() * (index + 1))
    ;[pairs[index], pairs[otherIndex]] = [pairs[otherIndex], pairs[index]]
  }
  return pairs
}

export function createAnomalyConfiguration(seed: string): AnomalyConfiguration {
  const properties = shuffledPropertyPairs(seed)
  return {
    seed,
    signals: Object.fromEntries(signalIds.map((signalId, index) => [signalId, properties[index]])) as Record<
      SignalId,
      SignalProperties
    >,
  }
}

export function resolvePublicResult(source: SignalProperties, receiver: SignalProperties): PublicResult {
  const polarityMatches = source.polarity === receiver.polarity
  if (source.fieldType === receiver.fieldType) {
    return polarityMatches ? 'transmission_gain' : 'attenuation'
  }

  const sourceIndex = fieldTypes.indexOf(source.fieldType)
  const receiverIndex = fieldTypes.indexOf(receiver.fieldType)
  const movesForward = (sourceIndex + 1) % fieldTypes.length === receiverIndex
  if (movesForward) return polarityMatches ? 'reflection' : 'unstable_collapse'
  return polarityMatches ? 'attenuation' : 'transmission_gain'
}
