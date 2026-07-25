export async function runTenderAction(action: () => Promise<void>) {
  try {
    await action()
    return true
  } catch {
    return false
  }
}
