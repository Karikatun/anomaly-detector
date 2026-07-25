import { useQuery } from '@tanstack/react-query'

import { sessionQueryKeys } from '@/platform/query'

import type { ProfileApi } from './api'

export const profileQueryKeys = {
  all: [...sessionQueryKeys.all, 'profile'] as const,
  statistics: () => [...profileQueryKeys.all, 'statistics'] as const,
}

export function useProfileStatisticsQuery(api: ProfileApi) {
  return useQuery({
    queryKey: profileQueryKeys.statistics(),
    queryFn: () => api.getStatistics(),
  })
}
