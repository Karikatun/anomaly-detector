export type TenderFailureKind = 'tender_not_found'

export class TenderFailure extends Error {
  constructor(
    public readonly kind: TenderFailureKind,
    message: string,
  ) {
    super(message)
  }
}
