import type { FieldType, Polarity, SignalId, TenderCommand, TenderView } from '@anomaly-detector/contracts'

export type BotDifficulty = 'easy' | 'hard'

export type ChooseBotCommandOptions = {
  commandId: string
  difficulty: BotDifficulty
  playerId: string
  seed: string
}

const fieldTypes: FieldType[] = ['inertial', 'electromagnetic', 'phase']
const polarities: Polarity[] = ['positive', 'negative']

const seededValue = (seed: string) => {
  let value = 2_166_136_261
  for (const character of seed) {
    value ^= character.charCodeAt(0)
    value = Math.imul(value, 16_777_619)
  }
  return value >>> 0
}

const seededIndex = (seed: string, size: number) => seededValue(seed) % size

const stableOrder = <T>(items: T[], seed: string, key: (item: T) => string) => [...items].sort((left, right) => {
  const leftRank = seededValue(`${seed}:${key(left)}`)
  const rightRank = seededValue(`${seed}:${key(right)}`)
  return leftRank - rightRank || key(left).localeCompare(key(right))
})

const commandBase = (view: TenderView, options: ChooseBotCommandOptions) => ({
  actorId: options.playerId,
  commandId: options.commandId,
  tenderId: view.tenderId,
})

const isSequentialTurn = (view: TenderView, playerId: string) => view.activePlayerId === playerId

const allocationForRound = (view: TenderView) => {
  const samples = new Set(view.privateSamples).size
  const reconnaissance = Math.min(2, 6 - samples)
  if (view.round === 1) return { contracts: 0, laboratory: 2, modelAnalysis: 0, reconnaissance: 2, reserve: 0 }
  if (view.round === 2) return { contracts: 1, laboratory: 0, modelAnalysis: 1, reconnaissance, reserve: 4 - reconnaissance - 2 }
  if (view.round === 3) {
    const laboratory = samples + reconnaissance >= 2 ? 2 : 0
    return { contracts: 0, laboratory, modelAnalysis: 0, reconnaissance, reserve: 4 - reconnaissance - laboratory }
  }
  if (view.round === 4) return { contracts: 1, laboratory: 0, modelAnalysis: 2, reconnaissance: 0, reserve: 1 }
  return { contracts: 1, laboratory: 0, modelAnalysis: 1, reconnaissance: 0, reserve: 2 }
}

const thesisFor = (view: TenderView, options: ChooseBotCommandOptions, signalId: SignalId) => {
  const index = seededIndex(`${options.seed}:${view.round}:${signalId}`, fieldTypes.length * polarities.length)
  return {
    fieldType: fieldTypes[index % fieldTypes.length]!,
    polarity: polarities[Math.floor(index / fieldTypes.length)]!,
  }
}

/**
 * Produces one deterministic command from an already-authorised participant view.
 * It deliberately has no access to stored Tender state, anomaly configuration, or
 * the match seed; `options.seed` only gives stable bot tie choices.
 */
export const chooseBotCommand = (view: TenderView, options: ChooseBotCommandOptions): TenderCommand | null => {
  const player = view.players.find((candidate) => candidate.playerId === options.playerId)
  if (!player || player.forfeited || view.hasForfeited || view.hasLeft || view.phase === 'complete') return null

  const base = commandBase(view, options)
  if (view.phase === 'access-slot-selection') {
    if (player.requestedAccessSlot !== undefined) return null
    return { ...base, slot: 6, type: 'request-access-slot' }
  }

  if (view.phase === 'power-allocation') {
    if (player.powerAllocationConfirmed) return null
    return { ...base, allocation: allocationForRound(view), type: 'allocate-power' }
  }

  if (view.phase === 'reconnaissance') {
    if (!isSequentialTurn(view, options.playerId)) return null
    const count = player.powerAllocation?.reconnaissance ?? 0
    if (count === 0) return null
    const knownUncollected = stableOrder(
      view.knownSignals.filter((signal) => !view.privateSamples.includes(signal)),
      options.seed,
      (signal) => signal,
    ).slice(0, count)
    return {
      ...base,
      targets: [
        ...knownUncollected,
        ...Array.from({ length: count - knownUncollected.length }, () => 'unknown-sector' as const),
      ],
      type: 'conduct-reconnaissance',
    }
  }

  if (view.phase === 'laboratory') {
    if (!isSequentialTurn(view, options.playerId)) return null
    const power = player.powerAllocation?.laboratory ?? 0
    if (power === 0) return null
    const samples = stableOrder([...new Set(view.privateSamples)], options.seed, (signal) => signal)
    const researched = new Set((view.publicScientificJournal ?? [])
      .filter((entry) => entry.playerId === options.playerId)
      .map((entry) => `${entry.sourceSignal}:${entry.receiverSignal}`))
    const pairs = samples.flatMap((sourceSignal) => samples
      .filter((receiverSignal) => receiverSignal !== sourceSignal)
      .map((receiverSignal) => ({ receiverSignal, sourceSignal }))
      .filter((pair) => !researched.has(`${pair.sourceSignal}:${pair.receiverSignal}`)))
    if (power === 1 && pairs[0]) {
      return { ...base, laboratory: { mode: 'impulse', pair: pairs[0] }, type: 'run-laboratory-test' }
    }
    if (power === 2 && pairs[0]) {
      return { ...base, laboratory: { mode: 'deep', pair: pairs[0] }, type: 'run-laboratory-test' }
    }
    return null
  }

  if (view.phase === 'model-analysis') {
    if (view.ruleset !== 'tender-v2' && !isSequentialTurn(view, options.playerId)) return null
    const maxTheses = player.powerAllocation?.modelAnalysis ?? 0
    const submitted = (view.privateTheses ?? []).filter((thesis) => thesis.round === view.round)
    if (player.modelAnalysisCompleted || submitted.length >= maxTheses) return null
    if (maxTheses >= 2 && submitted.length === 1 && view.corporateReviewActive && player.budget < 1) {
      return { ...base, type: 'finish-model-analysis' }
    }
    const candidates = stableOrder([...new Set(view.privateSamples)], options.seed, (signal) => signal)
      .filter((signal) => !submitted.some((thesis) => thesis.signalId === signal))
    const signalId = candidates[0]
    if (!signalId && maxTheses >= 2 && submitted.length === 1) return { ...base, type: 'finish-model-analysis' }
    if (!signalId) return null
    return { ...base, ...thesisFor(view, options, signalId), signalId, type: 'submit-thesis' }
  }

  if (view.phase === 'contracts') {
    if (!isSequentialTurn(view, options.playerId)) return null
    const contracts = [...view.publicContracts, ...(view.publicFinalContract ? [view.publicFinalContract] : [])]
    const reserved = contracts.find((contract) => contract.reservedByPlayerId === options.playerId && contract.bidOutcome === undefined)
    if (reserved?.planning) {
      const researchCertificationSignal = reserved.planning.suitableResearchCertificationSignals[0]
      const evidenceTestIds = reserved.planning.suitableEvidenceSelections[0]
      return {
        ...base,
        contractId: reserved.contractId,
        ...(evidenceTestIds ? { evidenceTestIds } : {}),
        ...(researchCertificationSignal ? { researchCertificationSignal } : {}),
        type: 'submit-contract-bid',
      }
    }
    const eligible = stableOrder(contracts.filter((contract) =>
      !contract.reservedByPlayerId && contract.bidOutcome === undefined && contract.planning?.eligible,
    ), options.seed, (contract) => contract.contractId)[0]
    if (eligible) return { ...base, contractId: eligible.contractId, type: 'reserve-contract' }
    return { ...base, type: 'skip-contract' }
  }

  if (view.phase === 'final-scientific-model') {
    if (view.ruleset !== 'tender-v2' && !isSequentialTurn(view, options.playerId)) return null
    if (player.finalScientificModelSubmitted || view.privateFinalScientificModelSubmission) return null
    const signals = Object.entries(view.privateWorkingModel.signals)
      .filter(([, claim]) => claim.hypothesis?.fieldType || claim.hypothesis?.polarity)
      .reduce<Record<string, { fieldType?: FieldType; polarity?: Polarity }>>((model, [signalId, claim]) => ({
        ...model,
        [signalId]: claim.hypothesis!,
      }), {})
    if (Object.keys(signals).length === 0) {
      const signalId = stableOrder([...new Set([...view.privateSamples, ...view.knownSignals])], options.seed, (signal) => signal)[0]
      if (!signalId) return null
      signals[signalId] = thesisFor(view, options, signalId)
    }
    return { ...base, scientificModel: { signals }, type: 'submit-scientific-model' }
  }

  return null
}
