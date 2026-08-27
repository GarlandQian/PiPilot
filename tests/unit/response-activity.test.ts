import { describe, expect, it } from 'vitest'
import {
  groupConversationTurns,
  projectLocalPiTurns,
  settleLocalPiResponseActivities,
  upsertLocalPiResponseActivity,
  type LocalPiResponseActivityRecord,
} from '../../src/renderer/pi-rpc/presentation'
import { createLocalPiProjectorState } from '../../src/renderer/pi-rpc/projector'
import type {
  LocalPiAgentMessage,
  LocalPiAssistantMessage,
  LocalPiSessionEntry,
} from '../../src/shared/local-pi'
import type { Turn } from '../../src/types/chat'

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
}

function assistant(text: string, timestamp: number): LocalPiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'anthropic-messages',
    provider: 'fixture',
    model: 'fixture-model',
    usage,
    stopReason: 'stop',
    timestamp,
  }
}

function messageEntry(
  id: string,
  parentId: string | null,
  message: LocalPiAgentMessage,
): LocalPiSessionEntry {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: `2026-08-18T00:00:0${message.timestamp}.000Z`,
    message,
  }
}

function fixtureState() {
  const user: LocalPiAgentMessage = { role: 'user', content: 'Inspect it', timestamp: 1 }
  const response = assistant('Done.', 2)
  return createLocalPiProjectorState({
    generation: 7,
    sessionId: 'session-a',
    messages: [user, response],
    entrySnapshot: {
      generation: 7,
      sessionId: 'session-a',
      entries: [
        messageEntry('entry-user', null, user),
        messageEntry('entry-agent', 'entry-user', response),
      ],
      leafId: 'entry-agent',
      cursor: 'entry-agent',
    },
  })
}

function activity(
  overrides: Partial<LocalPiResponseActivityRecord> = {},
): LocalPiResponseActivityRecord {
  return {
    scopeKey: 'project:workspace-a',
    generation: 7,
    sessionId: 'session-a',
    anchorEntryId: 'entry-user',
    order: 1,
    activity: {
      kind: 'status',
      id: 'status:lint',
      label: 'lint',
      message: 'Checking files',
      state: 'active',
    },
    ...overrides,
  }
}

describe('response activity provenance', () => {
  it('inserts exact activity before response actions in its authoritative response', () => {
    const turns = projectLocalPiTurns(fixtureState(), {
      scopeKey: 'project:workspace-a',
      responseActivities: [activity()],
    })

    expect(turns.map((turn) => turn.kind)).toEqual([
      'user',
      'agent',
      'activity',
      'response-actions',
    ])
    expect(turns[2]).toMatchObject({
      kind: 'activity',
      anchorEntryId: 'entry-user',
      activity: { id: 'status:lint', message: 'Checking files' },
    })
  })

  it('does not guess across scope, generation, session, or unknown anchors', () => {
    const candidates = [
      activity({ scopeKey: 'project:workspace-b' }),
      activity({ generation: 8 }),
      activity({ sessionId: 'session-b' }),
      activity({ anchorEntryId: 'entry-missing' }),
    ]
    const turns = projectLocalPiTurns(fixtureState(), {
      scopeKey: 'project:workspace-a',
      responseActivities: candidates,
    })

    expect(turns.some((turn) => turn.kind === 'activity')).toBe(false)
  })

  it('compresses settled progress while retaining reminders and errors', () => {
    const records: LocalPiResponseActivityRecord[] = [
      activity({
        order: 1,
        activity: {
          kind: 'working',
          id: 'working',
          message: 'Inspecting',
          state: 'settled',
        },
      }),
      activity({
        order: 2,
        activity: {
          kind: 'status',
          id: 'status:lint',
          label: 'lint',
          message: 'Checks complete',
          state: 'settled',
        },
      }),
      activity({
        order: 3,
        activity: {
          kind: 'notification',
          id: 'notification:reminder',
          message: 'Review the generated migration.',
          tone: 'info',
          state: 'settled',
        },
      }),
      activity({
        order: 4,
        activity: {
          kind: 'extension-error',
          id: 'extension-error:1',
          message: 'Extension failed',
          state: 'settled',
        },
      }),
    ]
    const turns = projectLocalPiTurns(fixtureState(), {
      scopeKey: 'project:workspace-a',
      responseActivities: records,
    })
    const projected = turns.filter((turn) => turn.kind === 'activity')

    expect(projected).toHaveLength(3)
    expect(projected.map((turn) => turn.activity.id)).toEqual([
      'status:lint',
      'notification:reminder',
      'extension-error:1',
    ])
  })

  it('updates an activity in place and settles only the exact response scope', () => {
    const first = activity()
    const updated = activity({
      order: 99,
      activity: {
        kind: 'status',
        id: 'status:lint',
        label: 'lint',
        message: 'Formatting files',
        state: 'active',
      },
    })
    const other = activity({
      anchorEntryId: 'entry-other',
      order: 2,
      activity: {
        kind: 'working',
        id: 'working',
        message: 'Still active',
        state: 'active',
      },
    })
    const upserted = upsertLocalPiResponseActivity([first, other], updated)
    const settled = settleLocalPiResponseActivities(upserted, {
      scopeKey: first.scopeKey,
      generation: first.generation,
      sessionId: first.sessionId,
      anchorEntryId: first.anchorEntryId,
    })

    expect(upserted).toHaveLength(2)
    expect(upserted[0]).toMatchObject({
      order: 1,
      activity: { message: 'Formatting files' },
    })
    expect(settled[0]?.activity.state).toBe('settled')
    expect(settled[1]?.activity.state).toBe('active')
  })
})

describe('conversation response grouping', () => {
  it('keeps a user-led group identity stable when its entry anchor hydrates', () => {
    const user: Turn = {
      kind: 'user',
      id: 'session:message:8:1000',
      text: 'Prompt',
      time: '',
    }
    const beforeHydration = groupConversationTurns([
      user,
      {
        kind: 'thinking',
        id: 'session:stream:9:1001:thinking:0',
        text: 'Working',
        state: 'streaming',
      },
    ])
    const afterHydration = groupConversationTurns([
      { ...user, anchorEntryId: 'entry-8' },
      {
        kind: 'thinking',
        id: 'session:message:9:1002:thinking:0',
        text: 'Working',
        state: 'complete',
        anchorEntryId: 'entry-8',
      },
    ])

    expect(beforeHydration[0]?.id).toBe('response:session:message:8:1000')
    expect(afterHydration[0]?.id).toBe(beforeHydration[0]?.id)
    expect(afterHydration[0]?.anchorEntryId).toBe('entry-8')
  })

  it('attaches a late projected activity to its matching earlier user-led group', () => {
    const turns: Turn[] = [
      { kind: 'user', id: 'user-a', text: 'A', time: '', anchorEntryId: 'entry-a' },
      { kind: 'agent', id: 'agent-a', markdown: 'Answer A', anchorEntryId: 'entry-a' },
      { kind: 'user', id: 'user-b', text: 'B', time: '', anchorEntryId: 'entry-b' },
      { kind: 'agent', id: 'agent-b', markdown: 'Answer B', anchorEntryId: 'entry-b' },
      {
        kind: 'activity',
        id: 'activity-a',
        anchorEntryId: 'entry-a',
        activity: {
          kind: 'notification',
          id: 'notification:a',
          message: 'Reminder A',
          tone: 'info',
          state: 'settled',
        },
      },
    ]

    const groups = groupConversationTurns(turns)
    expect(groups).toHaveLength(2)
    expect(groups[0]?.turns.map((turn) => turn.id)).toEqual([
      'user-a',
      'agent-a',
      'activity-a',
    ])
    expect(groups[1]?.turns.map((turn) => turn.id)).toEqual(['user-b', 'agent-b'])
  })
})
