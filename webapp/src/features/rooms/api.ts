import {
  createRoomRequestSchema,
  myMatchesResponseSchema,
  roomViewSchema,
  type CreateRoomRequest,
  type RoomView,
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

  join(roomId: string): Promise<RoomView> {
    return this.transport.request(`/api/rooms/${roomId}/join`, roomViewSchema, {
      method: 'POST',
    })
  }

  leave(roomId: string): Promise<void> {
    return this.transport
      .request(`/api/rooms/${roomId}/leave`, z.undefined(), {
        method: 'POST',
      })
      .then(() => undefined)
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
