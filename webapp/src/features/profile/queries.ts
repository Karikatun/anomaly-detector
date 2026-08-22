import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ConfirmRecoveryEmailReplacementRequest,
  ConfirmRecoveryEmailRequest,
  ResendRecoveryEmailReplacementRequest,
  StartRecoveryEmailReplacementRequest,
  StartRecoveryEmailRequest,
} from '@anomaly-detector/contracts'

import { sessionQueryKeys } from '@/platform/query'

import type { ProfileApi } from './api'

export const profileQueryKeys = {
  all: [...sessionQueryKeys.all, 'profile'] as const,
  accountProtection: () => [...profileQueryKeys.all, 'account-protection'] as const,
  statistics: () => [...profileQueryKeys.all, 'statistics'] as const,
  tutorial: () => [...profileQueryKeys.all, 'tutorial'] as const,
}

export function useAccountProtectionQuery(api: ProfileApi) {
  return useQuery({
    queryKey: profileQueryKeys.accountProtection(),
    queryFn: () => api.getAccountProtection(),
  })
}

export function useStartRecoveryEmailMutation(api: ProfileApi) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: StartRecoveryEmailRequest) => api.startRecoveryEmail(input),
    onError: () => queryClient.invalidateQueries({
      queryKey: profileQueryKeys.accountProtection(),
    }),
    onSuccess: (result) => queryClient.setQueryData(profileQueryKeys.accountProtection(), result),
  })
}

export function useResendRecoveryEmailMutation(api: ProfileApi) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.resendRecoveryEmail(),
    onError: () => queryClient.invalidateQueries({
      queryKey: profileQueryKeys.accountProtection(),
    }),
    onSuccess: (result) => queryClient.setQueryData(profileQueryKeys.accountProtection(), result),
  })
}

export function useConfirmRecoveryEmailMutation(api: ProfileApi) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ConfirmRecoveryEmailRequest) => api.confirmRecoveryEmail(input),
    onError: () => queryClient.invalidateQueries({
      queryKey: profileQueryKeys.accountProtection(),
    }),
    onSuccess: (result) => queryClient.setQueryData(profileQueryKeys.accountProtection(), result),
  })
}

export function useCancelRecoveryEmailMutation(api: ProfileApi) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.cancelRecoveryEmail(),
    onError: () => queryClient.invalidateQueries({
      queryKey: profileQueryKeys.accountProtection(),
    }),
    onSuccess: (result) => queryClient.setQueryData(profileQueryKeys.accountProtection(), result),
  })
}

export function useStartRecoveryEmailReplacementMutation(api: ProfileApi) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: StartRecoveryEmailReplacementRequest) =>
      api.startRecoveryEmailReplacement(input),
    onError: () => queryClient.invalidateQueries({
      queryKey: profileQueryKeys.accountProtection(),
    }),
    onSuccess: (result) => queryClient.setQueryData(
      profileQueryKeys.accountProtection(),
      { accountProtection: result.accountProtection },
    ),
  })
}

export function useResendRecoveryEmailReplacementMutation(api: ProfileApi) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ResendRecoveryEmailReplacementRequest) =>
      api.resendRecoveryEmailReplacement(input),
    onError: () => queryClient.invalidateQueries({
      queryKey: profileQueryKeys.accountProtection(),
    }),
    onSuccess: (result) => queryClient.setQueryData(
      profileQueryKeys.accountProtection(),
      { accountProtection: result.accountProtection },
    ),
  })
}

export function useConfirmRecoveryEmailReplacementMutation(api: ProfileApi) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ConfirmRecoveryEmailReplacementRequest) =>
      api.confirmRecoveryEmailReplacement(input),
    onError: () => queryClient.invalidateQueries({
      queryKey: profileQueryKeys.accountProtection(),
    }),
    onSuccess: (result) => queryClient.setQueryData(
      profileQueryKeys.accountProtection(),
      { accountProtection: result.accountProtection },
    ),
  })
}

export function useCancelRecoveryEmailReplacementMutation(api: ProfileApi) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.cancelRecoveryEmailReplacement(),
    onError: () => queryClient.invalidateQueries({
      queryKey: profileQueryKeys.accountProtection(),
    }),
    onSuccess: (result) => queryClient.setQueryData(profileQueryKeys.accountProtection(), result),
  })
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
