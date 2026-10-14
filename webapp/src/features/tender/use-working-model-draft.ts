import { useEffect, useState } from 'react'
import type { WorkingModel } from '@anomaly-detector/contracts'
import { WorkingModelDraftController, type WorkingModelSaveStatus } from './working-model-draft'

export type WorkingModelDraft = {
  model: WorkingModel
  status: WorkingModelSaveStatus
  update: (model: WorkingModel) => void
  retry: () => Promise<void>
}

// The feature owner is keyed by Tender and actor; editor placements never own saves.
export function useWorkingModelDraft(model: WorkingModel, save: (model: WorkingModel) => Promise<void>): WorkingModelDraft {
  const [draft, setDraft] = useState(model)
  const [status, setStatus] = useState<WorkingModelSaveStatus>({ state: 'idle' })
  const [controller] = useState(() => new WorkingModelDraftController({
    initialModel: model,
    onDraft: setDraft,
    onStatus: setStatus,
    save,
    schedule: (callback, delay) => setTimeout(callback, delay),
    cancel: (timer) => clearTimeout(timer),
  }))
  useEffect(() => { controller.setSave(save) }, [controller, save])
  useEffect(() => { controller.receiveServerModel(model) }, [controller, model])
  useEffect(() => {
    controller.resume()
    return () => { void controller.dispose() }
  }, [controller])
  return { model: draft, status, update: (next) => controller.update(next), retry: () => controller.retry() }
}
