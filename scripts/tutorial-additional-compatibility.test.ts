import { expect, test } from 'bun:test'

import { createContractPlanning } from '../backend/src/modules/tender/domain/contract-eligibility'
import { createTenderModule } from '../backend/src/modules/tender'
import { createInMemoryTenderStore } from '../backend/src/modules/tender/infrastructure/in-memory-tender-store'
import type { TenderPhase } from '@anomaly-detector/contracts'
import {
  additionalTutorialView,
  advanceAdditionalTutorial,
  createAdditionalTutorialState,
  type AdditionalAction,
  type AdditionalTutorialState,
} from '../webapp/src/features/tutorial/additional-scenario'

// This root test compares two application boundaries. Production modules do not
// import across applications, and the authoritative rule is not copied here.
function authoritativeContractState(state: AdditionalTutorialState) {
  return {
    corporateTrustByPlayer: { [state.playerId]: state.corporateTrust },
    publicScientificJournal: state.journal,
    researchCertificationsByPlayer: { [state.playerId]: state.certifications },
    round: state.round,
    usedContractEvidenceTestIds: state.usedEvidence,
  }
}

test('prepared additional contract planning matches authoritative own evidence and final eligibility', () => {
  const state = createAdditionalTutorialState('additional-compatibility-player')
  const view = additionalTutorialView(state)
  for (const contract of [...view.publicContracts, view.publicFinalContract!]) {
    expect(contract.planning).toEqual(createContractPlanning(
      authoritativeContractState(state), state.playerId, contract,
    ))
  }
})

const fixtureSignals = {
  aster: { fieldType: 'inertial', polarity: 'positive' },
  boreal: { fieldType: 'electromagnetic', polarity: 'positive' },
  cinder: { fieldType: 'phase', polarity: 'negative' },
  delta: { fieldType: 'inertial', polarity: 'negative' },
  eclipse: { fieldType: 'electromagnetic', polarity: 'negative' },
  ferro: { fieldType: 'phase', polarity: 'positive' },
} as const

function advance(state: AdditionalTutorialState, action: AdditionalAction) {
  const result = advanceAdditionalTutorial(state, action)
  expect(result.error).toBeUndefined()
  expect(result.state).not.toBe(state)
  return result.state
}

function mainResearch(mode: 'deep' | 'broad', contractId = 'lesson-light') {
  let state = createAdditionalTutorialState('additional-compatibility-player')
  for (const action of [
    { type: 'start-additional' },
    { type: 'choose-contract', contractId },
    { type: 'request-access-slot', slot: 4 },
    { type: 'allocate-power', allocation: { laboratory: 2, modelAnalysis: 1, contracts: 1, reconnaissance: 0 } },
  ] satisfies AdditionalAction[]) state = advance(state, action)
  return advance(state, { type: 'run-laboratory-test', laboratory: mode === 'deep'
    ? { mode, pair: { sourceSignal: 'aster', receiverSignal: 'boreal' } }
    : { mode, pairs: [{ sourceSignal: 'aster', receiverSignal: 'boreal' }, { sourceSignal: 'aster', receiverSignal: 'eclipse' }] },
  })
}

// Preparing a checkpoint is test setup, not a real server round or a learner
// action. All transitions checked below then use the actual service commands.
async function serviceCheckpoint(state: AdditionalTutorialState, phase: TenderPhase) {
  const store = createInMemoryTenderStore()
  const tender = createTenderModule({ store, now: () => new Date('2026-11-03T12:00:00.000Z') })
  const { tenderId } = await tender.createTender({ players: [
    { id: state.playerId, tiePriority: 1 }, { id: 'tutorial-opponent', tiePriority: 2 },
  ] })
  const initial = await store.read(tenderId)
  if (!initial || !state.allocation) throw new Error('Missing prepared checkpoint')
  await store.commit({ tenderId, expectedVersion: initial.version, auditEvents: [], nextTender: {
    ...initial, phase, round: state.round,
    anomalyConfiguration: { seed: 'explicit-additional-lesson-fixture', signals: fixtureSignals },
    accessSlots: { [state.playerId]: 4, 'tutorial-opponent': 5 },
    budgetByPlayer: { [state.playerId]: state.budget, 'tutorial-opponent': 2 },
    ratingByPlayer: { [state.playerId]: state.rating },
    corporateTrustByPlayer: { [state.playerId]: state.corporateTrust },
    corporateReviewByPlayer: { [state.playerId]: state.corporateReviewActive },
    powerAllocations: { [state.playerId]: state.allocation, 'tutorial-opponent': { laboratory: 0, modelAnalysis: 1, contracts: 1, reconnaissance: 0, reserve: 2 } },
    publicContracts: state.publicContracts, publicFinalContract: state.publicFinalContract,
    publicScientificJournal: state.journal, usedContractEvidenceTestIds: state.usedEvidence,
    samplesByPlayer: { [state.playerId]: state.samples },
    privateThesesByPlayer: { [state.playerId]: state.privateTheses },
    researchCertificationsByPlayer: { [state.playerId]: state.certifications },
    certifiedSignalsByPlayer: { [state.playerId]: state.certifiedSignals },
  } })
  let sequence = 0
  return {
    execute: (action: Extract<AdditionalAction, { type: 'run-laboratory-test' | 'submit-thesis' | 'reserve-contract' | 'submit-contract-bid' | 'skip-contract' | 'submit-scientific-model' }>) => tender.execute({ ...action, actorId: state.playerId, tenderId, commandId: `compatibility-${++sequence}` }),
    view: () => tender.readTenderView({ tenderId, playerId: state.playerId }),
  }
}

async function expectServiceProjection(service: Awaited<ReturnType<typeof serviceCheckpoint>>, state: AdditionalTutorialState) {
  const actual = await service.view()
  const player = actual.players.find((candidate) => candidate.playerId === state.playerId)
  expect(player).toMatchObject({ budget: state.budget, rating: state.rating, corporateTrust: state.corporateTrust })
  expect(actual.privateResearchCertifications).toEqual(state.certifications)
  expect(actual.privateUsedContractEvidenceTestIds).toEqual(state.usedEvidence)
  expect(actual.corporateReviewActive).toBe(state.corporateReviewActive)
  expect(actual.privateTheses.map(({ id: _id, ...thesis }) => thesis)).toEqual(state.privateTheses.map(({ id: _id, ...thesis }) => thesis))
}

for (const mode of ['deep', 'broad'] as const) test(`${mode} evidence and new Cinder certification match the current service`, async () => {
  const researched = mainResearch(mode)
  const beforeResearch = { ...researched, journal: researched.journal.filter((entry) => !entry.testId.startsWith('additional-own-')) }
  const serviceLab = await serviceCheckpoint(beforeResearch, 'laboratory')
  await serviceLab.execute({ type: 'run-laboratory-test', laboratory: mode === 'deep'
    ? { mode, pair: { sourceSignal: 'aster', receiverSignal: 'boreal' } }
    : { mode, pairs: [{ sourceSignal: 'aster', receiverSignal: 'boreal' }, { sourceSignal: 'aster', receiverSignal: 'eclipse' }] },
  })
  const serviceJournal = (await serviceLab.view()).publicScientificJournal.map(({ testId: _id, ...entry }) => entry)
  expect(serviceJournal).toEqual(researched.journal.map(({ testId: _id, ...entry }) => entry))
  const service = await serviceCheckpoint(researched, 'model-analysis')
  const action = { type: 'submit-thesis', signalId: 'cinder', fieldType: 'phase', polarity: 'negative' } as const
  await service.execute(action)
  const certified = advance(researched, action)
  await expectServiceProjection(service, certified)
  expect(certified.certifications).toEqual(['aster', 'cinder'])
  expect(certified.rating).toBe(2)
})

function ordinaryContracts(contractId: 'lesson-light' | 'lesson-scientific') {
  let state = advance(mainResearch('deep', contractId), { type: 'submit-thesis', signalId: 'cinder', fieldType: 'phase', polarity: 'negative' })
  state = advance(state, { type: 'begin-review' })
  state = advance(state, { type: 'allocate-power', allocation: { laboratory: 1, modelAnalysis: 2, contracts: 1, reconnaissance: 0 } })
  for (const fieldType of ['phase', 'inertial'] as const) state = advance(state, { type: 'submit-thesis', signalId: 'aster', fieldType, polarity: 'positive' })
  return advance(state, { type: 'continue-additional' })
}

for (const contractId of ['lesson-light', 'lesson-scientific'] as const) test(`${contractId} preserves a reservation through stale evidence and awards only a bid once`, async () => {
  let state = ordinaryContracts(contractId)
  const service = await serviceCheckpoint(state, 'contracts')
  const initialBudget = state.budget
  const reserve = { type: 'reserve-contract', contractId } as const
  await service.execute(reserve)
  state = advance(state, reserve)
  await expectServiceProjection(service, state)
  const stale = { type: 'submit-contract-bid', contractId, evidenceTestIds: ['prepared-foreign'] } as const
  await expect(service.execute(stale)).rejects.toMatchObject({ kind: 'contract_evidence_stale' })
  expect(advanceAdditionalTutorial(state, stale)).toEqual({ state, error: 'evidence-stale' })
  expect((await service.view()).publicContracts.find((contract) => contract.contractId === contractId)).toMatchObject({ reservedByPlayerId: state.playerId })
  expect(advanceAdditionalTutorial(state, { type: 'skip-contract' })).toEqual({ state, error: 'contract-reserved' })
  await expect(service.execute({ type: 'skip-contract' })).rejects.toMatchObject({ kind: 'invalid_tender_state' })
  await expect(service.execute(reserve)).rejects.toMatchObject({ kind: 'invalid_tender_state' })
  expect(advanceAdditionalTutorial(state, reserve)).toEqual({ state, error: 'contract-reserved' })
  const bid = { type: 'submit-contract-bid', contractId, ...contractId === 'lesson-scientific'
    ? { researchCertificationSignal: 'aster' as const, evidenceTestIds: [] }
    : { evidenceTestIds: [state.journal.find((entry) => entry.testId.startsWith('additional-own-'))!.testId] },
  } as const
  await service.execute(bid)
  state = advance(state, bid)
  await expectServiceProjection(service, state)
  expect(state.budget).toBe(initialBudget)
  expect(state.corporateTrust).toBe(2)
  expect((await service.view()).publicContracts.find((contract) => contract.contractId === contractId)).toMatchObject({ bidOutcome: 'awarded', awardedToPlayerId: state.playerId })
  expect(advanceAdditionalTutorial(state, bid).state).toBe(state)
  await expect(service.execute(bid)).rejects.toMatchObject({ kind: 'invalid_tender_state' })
  await expectServiceProjection(service, state)
})

test('late Final Contract checkpoint matches service round/trust gate and does not add ordinary trust', async () => {
  let state = ordinaryContracts('lesson-light')
  const ownEvidence = state.journal.find((entry) => entry.testId.startsWith('additional-own-'))!.testId
  state = advance(state, { type: 'reserve-contract', contractId: 'lesson-light' })
  state = advance(state, { type: 'submit-contract-bid', contractId: 'lesson-light', evidenceTestIds: [ownEvidence] })
  state = advance(state, { type: 'begin-recovery' })
  state = advance(state, { type: 'reserve-contract', contractId: 'lesson-complex' })
  const recoveryBid = { type: 'submit-contract-bid', contractId: 'lesson-complex', evidenceTestIds: ['recovery-own'] } as const
  const interrupted = advanceAdditionalTutorial(state, recoveryBid)
  expect(interrupted.error).toBe('training-interruption')
  state = advance(interrupted.state, recoveryBid)
  state = advance(state, { type: 'continue-additional' })
  state = advance(state, { type: 'prepare-final' })
  const service = await serviceCheckpoint(state, 'contracts')
  const localContract = additionalTutorialView(state).publicFinalContract!
  expect(localContract.planning).toEqual((await service.view()).publicFinalContract!.planning)
  expect(localContract.planning?.eligible).toBe(true)
  const reserve = { type: 'reserve-contract', contractId: 'final-contract' } as const
  for (const altered of [{ ...state, round: 4 }, { ...state, corporateTrust: 1 }]) {
    const deniedService = await serviceCheckpoint(altered, 'contracts')
    await expect(deniedService.execute(reserve)).rejects.toMatchObject({ kind: 'invalid_tender_state' })
    expect(advanceAdditionalTutorial(altered, reserve)).toEqual({ state: altered, error: 'contract-unavailable' })
  }
  await service.execute(reserve)
  state = advance(state, reserve)
  const initialRating = state.rating
  const bid = { type: 'submit-contract-bid', contractId: 'final-contract', evidenceTestIds: ['prepared-late-final'] } as const
  await service.execute(bid)
  state = advance(state, bid)
  await expectServiceProjection(service, state)
  expect(state.rating - initialRating).toBe(8)
  expect(state.corporateTrust).toBe(2)
  expect((await service.view()).publicFinalContract).toMatchObject({ bidOutcome: 'awarded', awardedToPlayerId: state.playerId })
  state = advance(state, { type: 'continue-additional' })
  for (const [signals, expectedScore] of [
    [fixtureSignals, 21],
    [{ aster: fixtureSignals.aster, boreal: fixtureSignals.boreal, cinder: fixtureSignals.cinder }, 9],
  ] as const) {
    const modelService = await serviceCheckpoint(state, 'final-scientific-model')
    const action = { type: 'submit-scientific-model', scientificModel: { signals } } as const
    await modelService.execute(action)
    const completed = advance(state, action)
    expect(completed.modelScore).toBe(expectedScore)
    expect(completed.rating - state.rating).toBe(expectedScore)
    expect((await modelService.view()).players.find((player) => player.playerId === state.playerId)?.rating).toBe(completed.rating)
    expect(completed.finalSubmission).toEqual({ signals })
  }
})

test('controlled wrong thesis and paid correction keep service costs and do not re-award Aster', async () => {
  let state = advance(mainResearch('deep'), { type: 'submit-thesis', signalId: 'cinder', fieldType: 'phase', polarity: 'negative' })
  state = advance(state, { type: 'begin-review' })
  state = advance(state, { type: 'allocate-power', allocation: { laboratory: 1, modelAnalysis: 2, contracts: 1, reconnaissance: 0 } })
  const service = await serviceCheckpoint(state, 'model-analysis')
  for (const fieldType of ['phase', 'inertial'] as const) {
    const action = { type: 'submit-thesis', signalId: 'aster', fieldType, polarity: 'positive' } as const
    await service.execute(action)
    state = advance(state, action)
    await expectServiceProjection(service, state)
  }
  expect(state.budget).toBe(0)
  expect(state.rating).toBe(1)
  expect(state.certifications).toEqual(['aster'])
  expect(advanceAdditionalTutorial(state, { type: 'submit-thesis', signalId: 'aster', fieldType: 'inertial', polarity: 'positive' }).state).toBe(state)
  await expect(service.execute({ type: 'submit-thesis', signalId: 'aster', fieldType: 'inertial', polarity: 'positive' })).rejects.toMatchObject({ kind: 'invalid_tender_state' })
})
