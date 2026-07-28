import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'

import type {
  CreateRoomRequest,
  JoinRoomByCodeRequest,
  RoomView,
  SetRoomReadyRequest,
} from '@anomaly-detector/contracts'

import { sessionQueryKeys } from '@/platform/query'

import type { RoomsApi } from './api'
import { getRoomPollingIntervalMs } from './countdown'

export const roomQueryKeys = {
  all: [...sessionQueryKeys.all, 'rooms'] as const,
  byId: (roomId: string) => [...roomQueryKeys.all, roomId] as const,
  current: () => [...roomQueryKeys.all, 'current'] as const,
  mine: () => [...roomQueryKeys.all, 'mine'] as const,
}

type RoomMutationsOptions = {
  api: RoomsApi
  onRoomStarted?: (room: RoomView) => void
}

export function useCurrentMatchQuery(api: RoomsApi) {
  return useQuery({
    queryKey: roomQueryKeys.current(),
    queryFn: () => api.getCurrentMatch(),
    refetchInterval: (query) => query.state.data ? 2_000 : false,
  })
}

export function useRoomQuery({
  api,
  roomId,
}: {
  api: RoomsApi
  roomId: string
}) {
  const queryKey = roomQueryKeys.byId(roomId)

  return useQuery({
    queryKey,
    queryFn: () => api.get(roomId),
    refetchInterval: (query) => getRoomPollingIntervalMs(query.state.data?.status),
    retry: 1,
  })
}

export function useCreateRoomMutation({ api }: RoomMutationsOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateRoomRequest) => api.create(input),
    onSuccess: (room) => {
      queryClient.setQueryData(roomQueryKeys.byId(room.roomId), room)
      queryClient.setQueryData(roomQueryKeys.current(), room)
    },
  })
}

export function useJoinRoomByCodeMutation({ api }: RoomMutationsOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: JoinRoomByCodeRequest) => api.joinByCode(input),
    onSuccess: (room) => {
      queryClient.setQueryData(roomQueryKeys.byId(room.roomId), room)
      queryClient.setQueryData(roomQueryKeys.current(), room)
    },
  })
}

export function useLeaveRoomMutation({ api }: RoomMutationsOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (roomId: string) => api.leave(roomId),
    onSuccess: (_data, roomId) => {
      queryClient.removeQueries({ queryKey: roomQueryKeys.byId(roomId) })
      queryClient.setQueryData(roomQueryKeys.current(), null)
    },
  })
}

export function useStartRoomMutation({ api, onRoomStarted }: RoomMutationsOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (roomId: string) => api.start(roomId),
    onSuccess: (room) => {
      queryClient.setQueryData(roomQueryKeys.byId(room.roomId), room)
      onRoomStarted?.(room)
    },
  })
}

export function useSetRoomReadyMutation({ api }: RoomMutationsOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ roomId, ...input }: SetRoomReadyRequest & { roomId: string }) => api.setReady(roomId, input),
    onSuccess: (room) => {
      queryClient.setQueryData(roomQueryKeys.byId(room.roomId), room)
    },
  })
}

export function useCancelRoomStartMutation({ api }: RoomMutationsOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (roomId: string) => api.cancelStart(roomId),
    onSuccess: (room) => {
      queryClient.setQueryData(roomQueryKeys.byId(room.roomId), room)
    },
  })
}
