// Accessing the property itself can throw in restricted browsers.
export function getSessionStorage(): Storage | undefined {
  try { return globalThis.sessionStorage } catch { return undefined }
}
