export const LOCAL_ABUSE_PERFORMANCE_SCENARIOS: readonly string[]

export function assertLocalTestDatabaseUrl(databaseUrl: string): void

export function localBenchmarkProcessEnvironment(
  baseEnvironment: Record<string, string | undefined>,
  overrides?: Record<string, string>,
): Record<string, string | undefined>

export function localDockerEndpointFromContextInspect(output: string): string

export function assertSafeLocalBenchmarkEvidence<T>(evidence: T): T
