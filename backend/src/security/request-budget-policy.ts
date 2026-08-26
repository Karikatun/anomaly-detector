export const REQUEST_BUDGET_SCOPES = [
  'login_failure',
  'login_ip_attempt',
  'registration_device',
  'registration_ip',
  'rec_email_account_min',
  'rec_email_account_hour',
  'rec_email_account_day',
  'rec_email_address_min',
  'rec_email_address_hour',
  'rec_email_address_day',
  'rec_email_ip_hour',
  'password_reset_login_hour',
  'password_reset_login_day',
  'password_reset_ip_hour',
  'password_reset_ip_day',
  'rec_code_login_hour',
  'rec_code_login_day',
  'rec_code_ip_hour',
  'rec_code_ip_day',
  'authenticated_mutation',
  'room_join',
  'tender_command',
  'realtime_ticket_issue',
] as const

export type RequestBudgetScope = typeof REQUEST_BUDGET_SCOPES[number]

export type RequestBudgetSurface =
  | 'authentication'
  | 'transactional_mail'
  | 'room_join'
  | 'tender_command'
  | 'realtime'

export type RequestBudgetAdminAggregation = 'authenticated_only' | 'excluded'

export type RequestBudgetPolicy<Scope extends RequestBudgetScope = RequestBudgetScope> = Readonly<{
  adminAggregation: RequestBudgetAdminAggregation
  limit: number
  scope: Scope
  surface: RequestBudgetSurface
  windowMs: number
}>

export type RequestBudgetPolicyCatalog = Readonly<{
  [Scope in RequestBudgetScope]: RequestBudgetPolicy<Scope>
}>

export type RequestBudgetPolicyConfig = Readonly<{
  ANTI_ABUSE_AUTHENTICATED_MUTATION_LIMIT?: number
  ANTI_ABUSE_LOGIN_FAILURE_LIMIT?: number
  ANTI_ABUSE_LOGIN_IP_LIMIT?: number
  ANTI_ABUSE_REALTIME_TICKET_LIMIT?: number
  ANTI_ABUSE_RECOVERY_EMAIL_DAY_LIMIT?: number
  ANTI_ABUSE_RECOVERY_EMAIL_HOUR_LIMIT?: number
  ANTI_ABUSE_RECOVERY_EMAIL_IP_HOUR_LIMIT?: number
  ANTI_ABUSE_RECOVERY_EMAIL_MINUTE_LIMIT?: number
  ANTI_ABUSE_RECOVERY_LOGIN_DAY_LIMIT?: number
  ANTI_ABUSE_RECOVERY_LOGIN_HOUR_LIMIT?: number
  ANTI_ABUSE_RECOVERY_LOGIN_IP_DAY_LIMIT?: number
  ANTI_ABUSE_RECOVERY_LOGIN_IP_HOUR_LIMIT?: number
  ANTI_ABUSE_REGISTRATION_DEVICE_LIMIT?: number
  ANTI_ABUSE_REGISTRATION_IP_LIMIT?: number
  ANTI_ABUSE_ROOM_JOIN_LIMIT?: number
  ANTI_ABUSE_TENDER_COMMAND_LIMIT?: number
}>

const minuteMs = 60_000
const hourMs = 60 * minuteMs
const dayMs = 24 * hourMs
const maximumLimit = 1_000_000
const requestBudgetScopeSet = new Set<string>(REQUEST_BUDGET_SCOPES)

export function createRequestBudgetPolicyCatalog(
  config: RequestBudgetPolicyConfig = {},
): RequestBudgetPolicyCatalog {
  const loginFailureLimit = configuredLimit(config, 'ANTI_ABUSE_LOGIN_FAILURE_LIMIT', 5)
  const loginIpLimit = configuredLimit(config, 'ANTI_ABUSE_LOGIN_IP_LIMIT', 30)
  const registrationDeviceLimit = configuredLimit(config, 'ANTI_ABUSE_REGISTRATION_DEVICE_LIMIT', 3)
  const registrationIpLimit = configuredLimit(config, 'ANTI_ABUSE_REGISTRATION_IP_LIMIT', 20)
  const recoveryEmailMinuteLimit = configuredLimit(config, 'ANTI_ABUSE_RECOVERY_EMAIL_MINUTE_LIMIT', 1)
  const recoveryEmailHourLimit = configuredLimit(config, 'ANTI_ABUSE_RECOVERY_EMAIL_HOUR_LIMIT', 3, 2)
  const recoveryEmailDayLimit = configuredLimit(config, 'ANTI_ABUSE_RECOVERY_EMAIL_DAY_LIMIT', 5, 2)
  const recoveryEmailIpHourLimit = configuredLimit(config, 'ANTI_ABUSE_RECOVERY_EMAIL_IP_HOUR_LIMIT', 20, 2)
  const recoveryLoginHourLimit = configuredLimit(config, 'ANTI_ABUSE_RECOVERY_LOGIN_HOUR_LIMIT', 3)
  const recoveryLoginDayLimit = configuredLimit(config, 'ANTI_ABUSE_RECOVERY_LOGIN_DAY_LIMIT', 5)
  const recoveryLoginIpHourLimit = configuredLimit(config, 'ANTI_ABUSE_RECOVERY_LOGIN_IP_HOUR_LIMIT', 10)
  const recoveryLoginIpDayLimit = configuredLimit(config, 'ANTI_ABUSE_RECOVERY_LOGIN_IP_DAY_LIMIT', 30)

  return Object.freeze({
    authenticated_mutation: policy(
      'authenticated_mutation',
      'authentication',
      configuredLimit(config, 'ANTI_ABUSE_AUTHENTICATED_MUTATION_LIMIT', 120),
      minuteMs,
      'authenticated_only',
    ),
    login_failure: policy('login_failure', 'authentication', loginFailureLimit, 15 * minuteMs, 'excluded'),
    login_ip_attempt: policy('login_ip_attempt', 'authentication', loginIpLimit, 15 * minuteMs, 'excluded'),
    password_reset_ip_day: policy('password_reset_ip_day', 'transactional_mail', recoveryLoginIpDayLimit, dayMs, 'excluded'),
    password_reset_ip_hour: policy('password_reset_ip_hour', 'transactional_mail', recoveryLoginIpHourLimit, hourMs, 'excluded'),
    password_reset_login_day: policy('password_reset_login_day', 'transactional_mail', recoveryLoginDayLimit, dayMs, 'excluded'),
    password_reset_login_hour: policy('password_reset_login_hour', 'transactional_mail', recoveryLoginHourLimit, hourMs, 'excluded'),
    realtime_ticket_issue: policy(
      'realtime_ticket_issue',
      'realtime',
      configuredLimit(config, 'ANTI_ABUSE_REALTIME_TICKET_LIMIT', 10),
      minuteMs,
      'authenticated_only',
    ),
    rec_code_ip_day: policy('rec_code_ip_day', 'authentication', recoveryLoginIpDayLimit, dayMs, 'excluded'),
    rec_code_ip_hour: policy('rec_code_ip_hour', 'authentication', recoveryLoginIpHourLimit, hourMs, 'excluded'),
    rec_code_login_day: policy('rec_code_login_day', 'authentication', recoveryLoginDayLimit, dayMs, 'excluded'),
    rec_code_login_hour: policy('rec_code_login_hour', 'authentication', recoveryLoginHourLimit, hourMs, 'excluded'),
    rec_email_account_day: policy('rec_email_account_day', 'transactional_mail', recoveryEmailDayLimit, dayMs, 'authenticated_only'),
    rec_email_account_hour: policy('rec_email_account_hour', 'transactional_mail', recoveryEmailHourLimit, hourMs, 'authenticated_only'),
    rec_email_account_min: policy('rec_email_account_min', 'transactional_mail', recoveryEmailMinuteLimit, minuteMs, 'authenticated_only'),
    rec_email_address_day: policy('rec_email_address_day', 'transactional_mail', recoveryEmailDayLimit, dayMs, 'authenticated_only'),
    rec_email_address_hour: policy('rec_email_address_hour', 'transactional_mail', recoveryEmailHourLimit, hourMs, 'authenticated_only'),
    rec_email_address_min: policy('rec_email_address_min', 'transactional_mail', recoveryEmailMinuteLimit, minuteMs, 'authenticated_only'),
    rec_email_ip_hour: policy('rec_email_ip_hour', 'transactional_mail', recoveryEmailIpHourLimit, hourMs, 'authenticated_only'),
    registration_device: policy('registration_device', 'authentication', registrationDeviceLimit, 180 * dayMs, 'excluded'),
    registration_ip: policy('registration_ip', 'authentication', registrationIpLimit, dayMs, 'excluded'),
    room_join: policy(
      'room_join',
      'room_join',
      configuredLimit(config, 'ANTI_ABUSE_ROOM_JOIN_LIMIT', 20),
      minuteMs,
      'authenticated_only',
    ),
    tender_command: policy(
      'tender_command',
      'tender_command',
      configuredLimit(config, 'ANTI_ABUSE_TENDER_COMMAND_LIMIT', 60),
      minuteMs,
      'authenticated_only',
    ),
  })
}

export function requestBudgetPolicyEntries(
  catalog: RequestBudgetPolicyCatalog,
): readonly RequestBudgetPolicy[] {
  return REQUEST_BUDGET_SCOPES.map((scope) => catalog[scope])
}

export function isRequestBudgetScope(value: string): value is RequestBudgetScope {
  return requestBudgetScopeSet.has(value)
}

function configuredLimit(
  config: RequestBudgetPolicyConfig,
  key: keyof RequestBudgetPolicyConfig,
  fallback: number,
  minimum = 1,
) {
  const value = config[key] ?? fallback
  if (!Number.isSafeInteger(value) || value < minimum || value > maximumLimit) {
    throw new RangeError(
      `${key} must be a safe integer from ${minimum} through ${maximumLimit}`,
    )
  }
  return value
}

function policy<Scope extends RequestBudgetScope>(
  scope: Scope,
  surface: RequestBudgetSurface,
  limit: number,
  windowMs: number,
  adminAggregation: RequestBudgetAdminAggregation,
): RequestBudgetPolicy<Scope> {
  return Object.freeze({ adminAggregation, limit, scope, surface, windowMs })
}
