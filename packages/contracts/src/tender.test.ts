import { describe, expect, test } from 'bun:test'

import {
  commandReceiptSchema,
  tenderCommandSchema,
  tenderViewSchema,
} from './index'

describe('Tender contracts', () => {
  test('validates the Access Slot command, receipt, and participant-scoped view', () => {
    expect(
      tenderCommandSchema.parse({
        commandId: 'command-a-1',
        tenderId: 'tender-1',
        actorId: 'player-a',
        type: 'request-access-slot',
        slot: 1,
      }),
    ).toEqual({
      commandId: 'command-a-1',
      tenderId: 'tender-1',
      actorId: 'player-a',
      type: 'request-access-slot',
      slot: 1,
    })

    expect(commandReceiptSchema.parse({ tenderId: 'tender-1', version: 1 })).toEqual({
      tenderId: 'tender-1',
      version: 1,
    })

    expect(
      tenderViewSchema.parse({
        tenderId: 'tender-1',
        version: 1,
        phase: 'access-slot-selection',
        teams: [
          { teamId: 'team-a', requestedAccessSlot: 1 },
          { teamId: 'team-b' },
        ],
      }),
    ).toEqual({
      tenderId: 'tender-1',
      version: 1,
      phase: 'access-slot-selection',
      teams: [
        { teamId: 'team-a', requestedAccessSlot: 1 },
        { teamId: 'team-b' },
      ],
    })
  })
})
