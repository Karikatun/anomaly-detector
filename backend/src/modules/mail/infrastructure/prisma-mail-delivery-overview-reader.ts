import {
  mailDeliveryOverviewSchema,
  type MailDeliveryOverview,
} from '@anomaly-detector/contracts'

import type { DbClient } from '../../../db'

type RawDeliveryGroup = {
  provider_id: string
  requested: number
  smtp_accepted: number
  template_kind: string
  temporary_failures: number
  terminal_failures: number
}

type SafeDeliveryGroup = {
  providerId: string
  requested: number
  smtpAccepted: number
  templateKind: RawDeliveryGroup['template_kind']
  temporaryFailures: number
  terminalFailures: number
}

export function createPrismaMailDeliveryOverviewReader(
  db: DbClient,
  options: {
    configured: boolean
    deliveryBudgetPerMinute: number
  },
) {
  return {
    async read(now: Date): Promise<MailDeliveryOverview> {
      const [
        control,
        stateGroups,
        attemptGroups,
        oldestQueued,
        requested,
        catalogSync,
        rawGroups,
      ] = await Promise.all([
        db.mailDeliveryControl.findUnique({ where: { id: 'reg_ru' } }),
        db.mailOutboxMessage.groupBy({ by: ['state'], _count: { _all: true } }),
        db.mailDeliveryAttempt.groupBy({ by: ['outcome'], _count: { _all: true } }),
        db.mailOutboxMessage.findFirst({
          where: { state: { in: ['queued', 'leased'] } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { createdAt: true },
        }),
        db.mailOutboxMessage.count(),
        db.mailPolicyAuditEvent.findFirst({
          where: { kind: { in: ['mail_provider_catalog_synced', 'mail_provider_catalog_sync_unchanged'] } },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          select: { occurredAt: true },
        }),
        db.$queryRaw<RawDeliveryGroup[]>`
          SELECT
            COALESCE(m.policy_provider_id, 'other') AS provider_id,
            m.template_kind,
            COUNT(DISTINCT m.id)::int AS requested,
            COUNT(a.id) FILTER (WHERE a.outcome = 'smtp_accepted')::int AS smtp_accepted,
            COUNT(a.id) FILTER (WHERE a.outcome = 'temporary_failure')::int AS temporary_failures,
            COUNT(a.id) FILTER (WHERE a.outcome = 'terminal_failure')::int AS terminal_failures
          FROM mail_outbox_messages m
          LEFT JOIN mail_delivery_attempts a ON a.outbox_id = m.id
          GROUP BY COALESCE(m.policy_provider_id, 'other'), m.template_kind
          ORDER BY m.template_kind, provider_id
        `,
      ])

      const stateCounts = new Map(stateGroups.map((group) => [group.state, group._count._all]))
      const attemptCounts = new Map(attemptGroups.map((group) => [group.outcome, group._count._all]))
      const grouped = combineSafeGroups(rawGroups)
      const circuitOpen = Boolean(
        options.configured
        && control?.circuitOpenUntil
        && control.circuitOpenUntil > now,
      )
      const budgetWindowActive = Boolean(
        control
        && now.getTime() - control.windowStartedAt.getTime() < 60_000,
      )

      return mailDeliveryOverviewSchema.parse({
        budget: {
          limitPerMinute: options.deliveryBudgetPerMinute,
          usedInWindow: budgetWindowActive ? control!.deliveriesInWindow : 0,
          windowStartedAt: budgetWindowActive ? control!.windowStartedAt.toISOString() : null,
        },
        circuit: {
          consecutiveFailures: control?.consecutiveFailures ?? 0,
          openUntil: circuitOpen ? control!.circuitOpenUntil!.toISOString() : null,
          state: !options.configured ? 'disabled' : circuitOpen ? 'open' : 'closed',
        },
        configured: options.configured,
        groups: grouped,
        lastSmtpSuccessAt: control?.lastSuccessAt?.toISOString() ?? null,
        outbox: {
          leased: stateCounts.get('leased') ?? 0,
          oldestQueuedAt: oldestQueued?.createdAt.toISOString() ?? null,
          queued: stateCounts.get('queued') ?? 0,
        },
        provider: 'reg_ru',
        catalogLastSyncedAt: catalogSync?.occurredAt.toISOString() ?? null,
        totals: {
          requested,
          smtpAccepted: attemptCounts.get('smtp_accepted') ?? 0,
          temporaryFailures: attemptCounts.get('temporary_failure') ?? 0,
          terminalFailures: attemptCounts.get('terminal_failure') ?? 0,
        },
      })
    },
  }
}

function combineSafeGroups(
  rawGroups: RawDeliveryGroup[],
) {
  const exact = new Map<string, SafeDeliveryGroup>()
  for (const group of rawGroups) {
    const providerId = group.provider_id
    const key = `${group.template_kind}\u0000${providerId}`
    const current = exact.get(key) ?? {
      providerId,
      requested: 0,
      smtpAccepted: 0,
      templateKind: group.template_kind,
      temporaryFailures: 0,
      terminalFailures: 0,
    }
    current.requested += group.requested
    current.smtpAccepted += group.smtp_accepted
    current.temporaryFailures += group.temporary_failures
    current.terminalFailures += group.terminal_failures
    exact.set(key, current)
  }

  const visible: SafeDeliveryGroup[] = []
  const suppressed = new Map<string, SafeDeliveryGroup>()
  for (const group of exact.values()) {
    if (group.requested >= 5) {
      visible.push(group)
      continue
    }
    const current = suppressed.get(group.templateKind) ?? {
      providerId: 'other',
      requested: 0,
      smtpAccepted: 0,
      templateKind: group.templateKind,
      temporaryFailures: 0,
      terminalFailures: 0,
    }
    current.requested += group.requested
    current.smtpAccepted += group.smtpAccepted
    current.temporaryFailures += group.temporaryFailures
    current.terminalFailures += group.terminalFailures
    suppressed.set(group.templateKind, current)
  }
  for (const group of suppressed.values()) {
    if (group.requested >= 5) visible.push(group)
  }
  return visible
    .sort((left, right) => left.templateKind.localeCompare(right.templateKind)
      || left.providerId.localeCompare(right.providerId))
    .slice(0, 50)
}
