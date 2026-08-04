import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { sessionQueryKeys } from '@/platform/query'

import type { ProfileApi } from './api'

export const profileQueryKeys = {
  all: [...sessionQueryKeys.all, 'profile'] as const,
  statistics: () => [...profileQueryKeys.all, 'statistics'] as const,
  tutorial: () => [...profileQueryKeys.all, 'tutorial'] as const,
}

export function useTutorialProgressQuery(api: ProfileApi) {
  return useQuery({
    queryKey: profileQueryKeys.tutorial(),
    queryFn: () => api.getTutorialProgress(),
  })
}

export function useCompleteTutorialMutation(api: ProfileApi) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.completeTutorial(),
    onSuccess: (progress) => queryClient.setQueryData(profileQueryKeys.tutorial(), progress),
  })
}

export function useProfileStatisticsQuery(api: ProfileApi) {
  return useQuery({
    queryKey: profileQueryKeys.statistics(),
    queryFn: () => api.getStatistics(),
  })
}
