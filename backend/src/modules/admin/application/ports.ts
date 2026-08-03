import type { AdminOverview, AdminOverviewQuery } from '@anomaly-detector/contracts'

export type AdminOverviewReader = {
  read(query: AdminOverviewQuery): Promise<AdminOverview>
}
