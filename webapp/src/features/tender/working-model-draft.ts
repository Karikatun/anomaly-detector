import type { WorkingModel } from '@anomaly-detector/contracts'

export type WorkingModelSaveStatus =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'error'; message: string }

type WorkingModelDraftControllerOptions<TDraft> = {
  cancel: (timer: ReturnType<typeof setTimeout>) => void
  errorMessage?: string
  initialModel: TDraft
  onDraft: (draft: TDraft) => void
  onStatus: (status: WorkingModelSaveStatus) => void
  save: (draft: TDraft) => Promise<void>
  schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
}

export class WorkingModelDraftController<TDraft = WorkingModel> {
  private readonly cancel: WorkingModelDraftControllerOptions<TDraft>['cancel']
  private readonly errorMessage: string
  private readonly onDraft: WorkingModelDraftControllerOptions<TDraft>['onDraft']
  private readonly onStatus: WorkingModelDraftControllerOptions<TDraft>['onStatus']
  private readonly schedule: WorkingModelDraftControllerOptions<TDraft>['schedule']
  private save: WorkingModelDraftControllerOptions<TDraft>['save']
  private draft: TDraft
  private revision = 0
  private savedRevision = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private inFlight: Promise<void> | null = null
  private saveFailed = false
  private disposed = false

  constructor(options: WorkingModelDraftControllerOptions<TDraft>) {
    this.cancel = options.cancel
    this.draft = options.initialModel
    this.errorMessage = options.errorMessage ?? 'Не удалось сохранить рабочую модель'
    this.onDraft = options.onDraft
    this.onStatus = options.onStatus
    this.save = options.save
    this.schedule = options.schedule
  }

  setSave(save: WorkingModelDraftControllerOptions<TDraft>['save']) {
    this.save = save
  }

  resume() {
    this.disposed = false
  }

  update(draft: TDraft) {
    if (this.disposed) return
    this.draft = draft
    this.revision += 1
    this.saveFailed = false
    this.onDraft(draft)
    this.scheduleSave()
  }

  receiveServerModel(model: TDraft) {
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
    } catch {
      this.saveFailed = true
      this.emitStatus({
        state: 'error',
        message: this.errorMessage,
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
