import { expect, test } from 'bun:test'

import { createTenderModule } from './index'

test('a direct Access Slot request keeps its slot when another team is displaced into it', () => {
  const tender = createTenderModule()
  const { tenderId } = tender.createTender({
    teams: [
      { id: 'A', tiePriority: 1 },
      { id: 'B', tiePriority: 2 },
      { id: 'C', tiePriority: 3 },
      { id: 'D', tiePriority: 4 },
    ],
  })

  tender.execute({ tenderId, type: 'request-access-slot', teamId: 'A', slot: 1 })
  tender.execute({ tenderId, type: 'request-access-slot', teamId: 'B', slot: 1 })
  tender.execute({ tenderId, type: 'request-access-slot', teamId: 'C', slot: 2 })
  tender.execute({ tenderId, type: 'request-access-slot', teamId: 'D', slot: 6 })
  tender.execute({ tenderId, type: 'resolve-access-slots' })

  expect(tender.readTenderView({ tenderId, teamId: 'A' }).accessSlots).toEqual([
    { teamId: 'A', slot: 1 },
    { teamId: 'B', slot: 3 },
    { teamId: 'C', slot: 2 },
    { teamId: 'D', slot: 6 },
  ])
})
