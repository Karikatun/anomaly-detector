import { createInMemoryRoomRepository, roomRepositoryContract } from './room-repository.contract-helper.test'

roomRepositoryContract('in-memory adapter', async () => ({
  cleanup: async () => {},
  guestId: 'guest',
  hostId: 'host',
  repository: createInMemoryRoomRepository(),
}))
