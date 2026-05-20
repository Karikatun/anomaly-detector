export type IapDiagnosticPayload = {
  code: string | null;
  message?: string;
  retryable: boolean;
};

export function trackIapDiagnostic(event: string, payload: IapDiagnosticPayload) {
  console.warn('[iap]', event, payload);
}
