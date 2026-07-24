import type { WorkingModel } from '@anomaly-detector/contracts'

export type WorkingModelSaveStatus =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'error'; message: string }

type WorkingModelDraftControllerOptions = {
  cancel: (timer: ReturnType<typeof setTimeout>) => void
  initialModel: WorkingModel
  onDraft: (draft: WorkingModel) => void
  onStatus: (status: WorkingModelSaveStatus) => void
  save: (draft: WorkingModel) => Promise<void>
  schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
}

export class WorkingModelDraftController {
  private readonly cancel: WorkingModelDraftControllerOptions['cancel']
  private readonly onDraft: WorkingModelDraftControllerOptions['onDraft']
  private readonly onStatus: WorkingModelDraftControllerOptions['onStatus']
  private readonly schedule: WorkingModelDraftControllerOptions['schedule']
  private save: WorkingModelDraftControllerOptions['save']
  private draft: WorkingModel
  private revision = 0
  private savedRevision = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight: Promise<void> | null = null
  private saveFailed = false
  private disposed = false

  constructor(options: WorkingModelDraftControllerOptions) {
    this.cancel = options.cancel
    this.draft = options.initialModel
    this.onDraft = options.onDraft
    this.onStatus = options.onStatus
    this.save = options.save
    this.schedule = options.schedule
  }

  setSave(save: WorkingModelDraftControllerOptions['save']) {
    this.save = save
  }

  update(draft: WorkingModel) {
    if (this.disposed) return
    this.draft = draft
    this.revision += 1
    this.saveFailed = false
    this.onDraft(draft)
    this.scheduleSave()
  }

  receiveServerModel(model: WorkingModel) {
    if (this.disposed) return
    if (this.hasPendingChanges()) return
    this.draft = model
    this.onDraft(model)
  }

  async flush() {
    this.clearTimer()
    await this.persistLatest()
  }

  async retry() {
    this.saveFailed = false
    await this.flush()
  }

  async dispose() {
    this.disposed = true
    await this.flush()
  }

  private hasPendingChanges() {
    return this.savedRevision !== this.revision || this.inFlight !== null
  }

  private scheduleSave() {
    this.clearTimer()
    this.timer = this.schedule(() => {
      this.timer = null
      void this.persistLatest()
    }, 800)
  }

  private clearTimer() {
    if (this.timer === null) return
    this.cancel(this.timer)
    this.timer = null
  }

  private async persistLatest(): Promise<void> {
    if (this.inFlight) {
      await this.inFlight
      if (!this.saveFailed && this.savedRevision !== this.revision) {
        await this.persistLatest()
      }
      return
    }
    if (this.saveFailed || this.savedRevision === this.revision) return

    const revision = this.revision
    const draft = this.draft
    this.emitStatus({ state: 'saving' })

    this.inFlight = this.save(draft)
    try {
      await this.inFlight
      this.savedRevision = revision
      this.emitStatus({ state: 'idle' })
    } catch (error) {
      this.saveFailed = true
      this.emitStatus({
        state: 'error',
        message: error instanceof Error ? error.message : 'Не удалось сохранить рабочую модель',
      })
    } finally {
      this.inFlight = null
    }

    if (!this.saveFailed && this.savedRevision !== this.revision) {
      await this.persistLatest()
    }
  }

  private emitStatus(status: WorkingModelSaveStatus) {
    if (!this.disposed) {
      this.onStatus(status)
    }
  }
}
