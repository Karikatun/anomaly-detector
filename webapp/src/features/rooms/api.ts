import {
  createRoomRequestSchema,
  currentMatchResponseSchema,
  joinRoomByCodeRequestSchema,
  myMatchesResponseSchema,
  roomViewSchema,
  setRoomReadyRequestSchema,
  type CreateRoomRequest,
  type JoinRoomByCodeRequest,
  type RoomView,
  type SetRoomReadyRequest,
} from '@anomaly-detector/contracts'
import { z } from 'zod'

import type { AuthenticatedTransport } from '@/platform/api'

export class RoomsApi {
  private readonly transport: AuthenticatedTransport

  constructor(transport: AuthenticatedTransport) {
    this.transport = transport
  }

  create(input: CreateRoomRequest): Promise<RoomView> {
    const payload = createRoomRequestSchema.parse(input)
    return this.transport.request('/api/rooms', roomViewSchema, {
      method: 'POST',
      body: payload,
    })
  }

  async listMatches(): Promise<RoomView[]> {
    const response = await this.transport.request('/api/rooms/mine', myMatchesResponseSchema)
    return response.matches
  }

  async getCurrentMatch(): Promise<RoomView | null> {
    const response = await this.transport.request('/api/rooms/current', currentMatchResponseSchema)
    return response.match
  }

  join(roomId: string): Promise<RoomView> {
    return this.transport.request(`/api/rooms/${roomId}/join`, roomViewSchema, {
      method: 'POST',
    })
  }

  joinByCode(input: JoinRoomByCodeRequest): Promise<RoomView> {
    const payload = joinRoomByCodeRequestSchema.parse(input)
    return this.transport.request('/api/rooms/join', roomViewSchema, {
      method: 'POST',
      body: payload,
    })
  }

  get(roomId: string): Promise<RoomView> {
    return this.transport.request(`/api/rooms/${roomId}`, roomViewSchema)
  }

  leave(roomId: string): Promise<void> {
    return this.transport
      .request(`/api/rooms/${roomId}/leave`, z.undefined(), {
        method: 'POST',
      })
      .then(() => undefined)
  }

  setReady(roomId: string, input: SetRoomReadyRequest): Promise<RoomView> {
    const payload = setRoomReadyRequestSchema.parse(input)
    return this.transport.request(`/api/rooms/${roomId}/ready`, roomViewSchema, {
      method: 'POST',
      body: payload,
    })
  }

  start(roomId: string): Promise<RoomView> {
    return this.transport.request(`/api/rooms/${roomId}/start`, roomViewSchema, {
      method: 'POST',
    })
  }

  cancelStart(roomId: string): Promise<RoomView> {
    return this.transport.request(`/api/rooms/${roomId}/cancel-start`, roomViewSchema, {
      method: 'POST',
    })
  }
}
