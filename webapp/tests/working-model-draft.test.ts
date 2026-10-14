import { expect, test } from 'bun:test'

import type { WorkingModel } from '@anomaly-detector/contracts'

import { WorkingModelDraftController, type WorkingModelSaveStatus } from '../src/features/tender/working-model-draft'

test('Working Model keeps a dirty draft when an older realtime snapshot arrives', async () => {
  const saved: WorkingModel[] = []
  const drafts: WorkingModel[] = []
  const controller = createController(emptyModel(), {
    onDraft: (draft) => drafts.push(draft),
    save: async (draft) => {
      saved.push(draft)
    },
  })
  const localDraft = modelWithNote('локальная гипотеза')

  controller.update(localDraft)
  controller.receiveServerModel(modelWithNote('устаревший серверный снимок'))
  await controller.flush()

  expect(drafts.at(-1)).toEqual(localDraft)
  expect(saved).toEqual([localDraft])
})

test('Working Model flushes the latest pending draft when its UI is disposed', async () => {
  let scheduledSave: (() => void) | null = null
  const saved: WorkingModel[] = []
  const controller = new WorkingModelDraftController({
    initialModel: emptyModel(),
    onDraft: () => undefined,
    onStatus: () => undefined,
    save: async (draft) => {
      saved.push(draft)
    },
    schedule: (callback) => {
      scheduledSave = callback
      return 1
    },
    cancel: () => {
      scheduledSave = null
    },
  })
  const latestDraft = modelWithNote('последняя запись')

  controller.update(latestDraft)
  expect(scheduledSave).not.toBeNull()
  await controller.dispose()

  expect(saved).toEqual([latestDraft])
  expect(scheduledSave).toBeNull()
})

test('Working Model controller resumes after a React development effect replay', async () => {
  const drafts: WorkingModel[] = []
  const controller = createController(emptyModel(), {
    onDraft: (draft) => drafts.push(draft),
  })
  const resumedDraft = modelWithNote('изменение после повторного эффекта')

  await controller.dispose()
  controller.resume()
  controller.update(resumedDraft)

  expect(drafts.at(-1)).toEqual(resumedDraft)
  await controller.dispose()
})

function createController(
  initialModel: WorkingModel,
  overrides: Partial<ConstructorParameters<typeof WorkingModelDraftController>[0]>,
) {
  return new WorkingModelDraftController({
    initialModel,
    onDraft: () => undefined,
    onStatus: () => undefined,
    save: async () => undefined,
    schedule: (callback) => setTimeout(callback, 800),
    cancel: clearTimeout,
    ...overrides,
  })
}

function emptyModel(): WorkingModel {
  return { signals: {} }
}

function modelWithNote(note: string): WorkingModel {
  return {
    signals: {
      aster: { note },
    },
  }
}


test('one Working Model owner serializes the newest edit made during an accepted save', async () => {
  let acceptFirst!: () => void
  const firstAccepted = new Promise<void>((resolve) => { acceptFirst = resolve })
  const saved: WorkingModel[] = []
  const status: WorkingModelSaveStatus[] = []
  const controller = createController(emptyModel(), {
    onStatus: (next) => status.push(next),
    save: async (draft) => {
      saved.push(draft)
      if (saved.length === 1) await firstAccepted
    },
  })
  controller.update(modelWithNote('первая гипотеза'))
  const saving = controller.flush()
  controller.update(modelWithNote('последняя гипотеза'))
  const latest = controller.flush()
  expect(saved).toEqual([modelWithNote('первая гипотеза')])
  acceptFirst()
  await Promise.all([saving, latest])
  expect(saved).toEqual([modelWithNote('первая гипотеза'), modelWithNote('последняя гипотеза')])
  expect(status.at(-1)).toEqual({ state: 'idle' })
  await controller.dispose()
})

test('Working Model keeps an unsaved edit through failure and stale refetch until retry succeeds', async () => {
  let fail = true
  const accepted: WorkingModel[] = []
  const drafts: WorkingModel[] = []
  const status: WorkingModelSaveStatus[] = []
  const controller = createController(emptyModel(), {
    onDraft: (draft) => drafts.push(draft),
    onStatus: (next) => status.push(next),
    save: async (draft) => {
      if (fail) throw new Error('temporary transport failure')
      accepted.push(draft)
    },
  })
  const latest = modelWithNote('не потерять после ошибки')
  controller.update(latest)
  await controller.flush()
  expect(status.at(-1)?.state).toBe('error')
  controller.receiveServerModel(emptyModel())
  expect(drafts.at(-1)).toEqual(latest)
  fail = false
  await controller.retry()
  expect(accepted).toEqual([latest])
  expect(status.at(-1)).toEqual({ state: 'idle' })
  await controller.dispose()
})
