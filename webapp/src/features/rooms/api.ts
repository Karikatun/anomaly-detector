import {
  addRoomBotRequestSchema,
  updateRoomBotDifficultyRequestSchema,
  createRoomRequestSchema,
  currentMatchResponseSchema,
  gameContractVersionHeader,
  joinRoomByCodeRequestSchema,
  myMatchesResponseSchema,
  roomViewSchema,
  setRoomReadyRequestSchema,
  type CreateRoomRequest,
  type JoinRoomByCodeRequest,
  type RoomView,
  type SetRoomReadyRequest,
} from '@anomaly-detector/contracts'

import type { AuthenticatedTransport } from '@/platform/api'

const roomContractHeaders = { [gameContractVersionHeader]: '2' }

export class RoomsApi {
  private readonly transport: AuthenticatedTransport

  constructor(transport: AuthenticatedTransport) {
    this.transport = transport
  }

  create(input: CreateRoomRequest): Promise<RoomView> {
    const payload = createRoomRequestSchema.parse(input)
    return this.transport.request('/api/rooms', roomViewSchema, {
      headers: roomContractHeaders,
      method: 'POST',
      body: payload,
    })
  }

  async listMatches(): Promise<RoomView[]> {
    const response = await this.transport.request('/api/rooms/mine', myMatchesResponseSchema, { headers: roomContractHeaders })
    return response.matches
  }

  async getCurrentMatch(): Promise<RoomView | null> {
    const response = await this.transport.request('/api/rooms/current', currentMatchResponseSchema, { headers: roomContractHeaders })
    return response.match
  }

  joinByCode(input: JoinRoomByCodeRequest): Promise<RoomView> {
    const payload = joinRoomByCodeRequestSchema.parse(input)
    return this.transport.request('/api/rooms/join', roomViewSchema, {
      headers: roomContractHeaders,
      method: 'POST',
      body: payload,
    })
  }

  get(roomId: string): Promise<RoomView> {
    return this.transport.request(`/api/rooms/${roomId}`, roomViewSchema, { headers: roomContractHeaders })
  }

  leave(roomId: string): Promise<void> {
    return this.transport.requestNoContent(`/api/rooms/${roomId}/leave`, {
      headers: roomContractHeaders,
      method: 'POST',
    })
  }

  setReady(roomId: string, input: SetRoomReadyRequest): Promise<RoomView> {
    const payload = setRoomReadyRequestSchema.parse(input)
    return this.transport.request(`/api/rooms/${roomId}/ready`, roomViewSchema, {
      headers: roomContractHeaders,
      method: 'POST',
      body: payload,
    })
  }

  start(roomId: string): Promise<RoomView> {
    return this.transport.request(`/api/rooms/${roomId}/start`, roomViewSchema, {
      headers: roomContractHeaders,
      method: 'POST',
    })
  }

  cancelStart(roomId: string): Promise<RoomView> {
    return this.transport.request(`/api/rooms/${roomId}/cancel-start`, roomViewSchema, {
      headers: roomContractHeaders,
      method: 'POST',
    })
  }

  addBot(roomId: string, seat: number): Promise<RoomView> {
    return this.transport.request(`/api/rooms/${roomId}/bots`, roomViewSchema, {
      headers: roomContractHeaders,
      method: 'POST',
      body: addRoomBotRequestSchema.parse({ difficulty: 'easy', seat }),
    })
  }

  removeBot(roomId: string, botId: string): Promise<RoomView> {
    return this.transport.request(`/api/rooms/${roomId}/bots/${botId}`, roomViewSchema, {
      headers: roomContractHeaders,
      method: 'DELETE',
    })
  }

  updateBotDifficulty(roomId: string, botId: string, difficulty: 'easy' | 'hard'): Promise<RoomView> {
    return this.transport.request(`/api/rooms/${roomId}/bots/${botId}`, roomViewSchema, {
      headers: roomContractHeaders,
      method: 'PATCH',
      body: updateRoomBotDifficultyRequestSchema.parse({ difficulty }),
    })
  }
}
