export function runZapCleanupSteps(steps) {
  const errors = []

  for (const [label, cleanup] of steps) {
    try {
      const result = cleanup()
      if (result && result.status !== 0) {
        errors.push(new Error(`${label} failed with exit code ${result.status ?? 1}`))
      }
    } catch (error) {
      errors.push(new Error(`${label} failed`, { cause: error }))
    }
  }

  return errors
}
