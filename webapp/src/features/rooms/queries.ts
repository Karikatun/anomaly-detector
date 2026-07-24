import {
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'

import type { CreateRoomRequest, RoomView, SetRoomReadyRequest } from '@anomaly-detector/contracts'

import { sessionQueryKeys } from '@/platform/query'

import type { RoomsApi } from './api'

export const roomQueryKeys = {
  all: [...sessionQueryKeys.all, 'rooms'] as const,
  byId: (roomId: string) => [...roomQueryKeys.all, roomId] as const,
  mine: () => [...roomQueryKeys.all, 'mine'] as const,
}

type RoomMutationsOptions = {
  api: RoomsApi
  onRoomStarted?: (room: RoomView) => void
}

export function useCreateRoomMutation({ api }: RoomMutationsOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateRoomRequest) => api.create(input),
    onSuccess: (room) => {
      queryClient.setQueryData(roomQueryKeys.byId(room.roomId), room)
    },
  })
}

export function useJoinRoomMutation({ api }: RoomMutationsOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (roomId: string) => api.join(roomId),
    onSuccess: (room) => {
      queryClient.setQueryData(roomQueryKeys.byId(room.roomId), room)
    },
  })
}

export function useLeaveRoomMutation({ api }: RoomMutationsOptions) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (roomId: string) => api.leave(roomId),
    onSuccess: (_data, roomId) => {
      queryClient.removeQueries({ queryKey: roomQueryKeys.byId(roomId) })
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
