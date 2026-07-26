import { expect, test } from 'bun:test'

import type { WorkingModel } from '@anomaly-detector/contracts'

import { WorkingModelDraftController } from '../src/features/tender/working-model-draft'

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
