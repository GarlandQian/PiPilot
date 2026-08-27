import { describe, expect, it } from 'vitest'
import {
  acceptPiPendingPrompt,
  capturePiPendingPromptActivity,
  clearPiPromptAcceptance,
  clearPiPendingPrompt,
  createPiPromptAcceptance,
  createPiPendingPromptProvenance,
  isRegisteredPiExtensionCommandPrompt,
  piPendingPromptSnapshotAnchor,
  projectPiPendingPromptActivities,
  reconcilePiPromptAcceptanceScope,
  reconcilePiPendingPromptScope,
  settlePiPendingPromptActivities,
  type PiResponseActivityScope,
} from '../../src/store/pi-rpc'
import { createLocalPiProjectorState } from '../../src/renderer/pi-rpc/projector'
import type {
  LocalPiAgentMessage,
  LocalPiAssistantMessage,
  LocalPiSessionEntry,
} from '../../src/shared/local-pi'

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

const scope: PiResponseActivityScope = {
  scopeKey: 'project:workspace-a',
  generation: 7,
  sessionId: 'session-a',
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

function entry(
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

function readyProjection() {
  const previousUser: LocalPiAgentMessage = {
    role: 'user',
    content: 'Previous prompt',
    timestamp: 1,
  }
  const previousResponse = assistant('Previous response.', 2)
  const user: LocalPiAgentMessage = {
    role: 'user',
    content: 'Inspect it',
    timestamp: 3,
  }
  const response = assistant('Done.', 4)
  return createLocalPiProjectorState({
    ...scope,
    messages: [previousUser, previousResponse, user, response],
    entrySnapshot: {
      ...scope,
      entries: [
        entry('entry-previous-user', null, previousUser),
        entry('entry-previous-agent', 'entry-previous-user', previousResponse),
        entry('entry-user', 'entry-previous-agent', user),
        entry('entry-agent', 'entry-user', response),
      ],
      leafId: 'entry-agent',
      cursor: 'entry-agent',
    },
  })
}

const statusActivity = (message: string, state: 'active' | 'settled' = 'active') => ({
  kind: 'status' as const,
  id: 'status:lint',
  label: 'lint',
  message,
  state,
})

describe('pending prompt response provenance', () => {
  it('recognizes only exact registered extension command prompts', () => {
    const commands = [{
      name: 'goal',
      source: 'extension' as const,
      sourceInfo: {
        path: '/fixture/goal.ts',
        source: 'npm:@narumitw/pi-goal',
        scope: 'user' as const,
        origin: 'package' as const,
      },
    }, {
      name: 'review',
      source: 'prompt' as const,
      sourceInfo: {
        path: '/fixture/review.md',
        source: 'fixture',
        scope: 'temporary' as const,
        origin: 'top-level' as const,
      },
    }]

    expect(isRegisteredPiExtensionCommandPrompt('/goal', commands)).toBe(true)
    expect(isRegisteredPiExtensionCommandPrompt('/goal resume', commands)).toBe(true)
    expect(isRegisteredPiExtensionCommandPrompt('/review', commands)).toBe(false)
    expect(isRegisteredPiExtensionCommandPrompt('/missing', commands)).toBe(false)
    expect(isRegisteredPiExtensionCommandPrompt(' /goal', commands)).toBe(false)
    expect(isRegisteredPiExtensionCommandPrompt('/goal\nresume', commands)).toBe(false)
  })

  it('releases the acceptance guard while retaining accepted response provenance', () => {
    const operationId = 1
    const acceptance = createPiPromptAcceptance({ ...scope, operationId })
    const accepted = acceptPiPendingPrompt(createPiPendingPromptProvenance({
      ...scope,
      operationId,
      initialMessageCount: 0,
    }), operationId)

    const clearedAcceptance = clearPiPromptAcceptance(acceptance, operationId)

    expect(clearedAcceptance).toBeNull()
    expect(accepted).toMatchObject({ operationId, accepted: true })
    expect(reconcilePiPromptAcceptanceScope(clearedAcceptance, scope)).toBeNull()
  })

  it('keeps only a real same-scope prompt acceptance in flight', () => {
    const first = createPiPromptAcceptance({ ...scope, operationId: 10 })
    const second = createPiPromptAcceptance({ ...scope, operationId: 11 })

    expect(reconcilePiPromptAcceptanceScope(first, scope)).toBe(first)
    expect(clearPiPromptAcceptance(second, first.operationId)).toBe(second)
    expect(clearPiPromptAcceptance(first, first.operationId)).toBeNull()
    expect(reconcilePiPromptAcceptanceScope(first, {
      ...scope,
      generation: scope.generation + 1,
    })).toBeNull()
    expect(reconcilePiPromptAcceptanceScope(first, {
      ...scope,
      sessionId: 'session-b',
    })).toBeNull()
    expect(reconcilePiPromptAcceptanceScope(first, {
      ...scope,
      scopeKey: 'project:workspace-b',
    })).toBeNull()
  })

  it('buffers pre-entry surfaces and flushes them to the exact user anchor', () => {
    let pending = createPiPendingPromptProvenance({
      ...scope,
      operationId: 1,
      initialMessageCount: 0,
    })
    pending = capturePiPendingPromptActivity(pending, scope, statusActivity('Checking'))!
    pending = capturePiPendingPromptActivity(pending, scope, statusActivity('Checked'))!
    pending = capturePiPendingPromptActivity(pending, scope, {
      kind: 'notification',
      id: 'notification:reminder',
      message: 'Review the result.',
      tone: 'info',
      state: 'settled',
    })!

    const records = projectPiPendingPromptActivities(pending, {
      ...scope,
      anchorEntryId: 'entry-user',
    }, 10)

    expect(records).toHaveLength(2)
    expect(records?.map((record) => [record.order, record.activity.id])).toEqual([
      [10, 'status:lint'],
      [11, 'notification:reminder'],
    ])
    expect(records?.every((record) =>
      record.scopeKey === scope.scopeKey &&
      record.generation === scope.generation &&
      record.sessionId === scope.sessionId &&
      record.anchorEntryId === 'entry-user')).toBe(true)
  })

  it('keeps startup/unbound activity global and rejects stale identities', () => {
    const pending = createPiPendingPromptProvenance({
      ...scope,
      operationId: 2,
      initialMessageCount: 0,
    })
    const activity = statusActivity('Checking')

    expect(capturePiPendingPromptActivity(null, scope, activity)).toBeNull()
    expect(capturePiPendingPromptActivity(pending, {
      ...scope,
      generation: 8,
    }, activity)).toBeNull()
    expect(capturePiPendingPromptActivity(pending, {
      ...scope,
      sessionId: 'session-b',
    }, activity)).toBeNull()
    expect(projectPiPendingPromptActivities(pending, {
      ...scope,
      anchorEntryId: 'entry-user',
    }, 1)).toEqual([])
  })

  it('settles buffered progress without changing its exact provenance', () => {
    let pending = createPiPendingPromptProvenance({
      ...scope,
      operationId: 3,
      initialMessageCount: 0,
    })
    pending = capturePiPendingPromptActivity(pending, scope, statusActivity('Checking'))!
    pending = settlePiPendingPromptActivities(pending, scope, 'status:lint')!
    expect(pending.activities[0]).toMatchObject({ id: 'status:lint', state: 'settled' })
    expect(pending.scopeKey).toBe(scope.scopeKey)
    expect(pending.sessionId).toBe(scope.sessionId)
  })

  it('uses an accepted snapshot only after authoritative messages advance', () => {
    const projection = readyProjection()
    let pending = createPiPendingPromptProvenance({
      ...scope,
      operationId: 4,
      initialMessageCount: 2,
    })

    expect(piPendingPromptSnapshotAnchor(pending, scope, projection)).toBeNull()
    pending = acceptPiPendingPrompt(pending, 4)!
    expect(piPendingPromptSnapshotAnchor(pending, scope, projection)).toBe('entry-user')
    const unchanged = acceptPiPendingPrompt(createPiPendingPromptProvenance({
      ...scope,
      operationId: 40,
      initialMessageCount: projection.messages.length,
    }), 40)
    expect(piPendingPromptSnapshotAnchor(unchanged, scope, projection)).toBeNull()
    expect(piPendingPromptSnapshotAnchor(pending, {
      ...scope,
      generation: 8,
    }, projection)).toBeNull()
  })

  it('prevents an old failure from clearing a newer prompt and clears on scope replacement', () => {
    let first = createPiPendingPromptProvenance({
      ...scope,
      operationId: 5,
      initialMessageCount: 0,
    })
    first = capturePiPendingPromptActivity(first, scope, statusActivity('First'))!
    let second = createPiPendingPromptProvenance({
      ...scope,
      operationId: 6,
      initialMessageCount: 0,
    })
    second = capturePiPendingPromptActivity(second, scope, statusActivity('Second'))!

    expect(clearPiPendingPrompt(second, first.operationId)).toBe(second)
    expect(clearPiPendingPrompt(second, second.operationId)).toBeNull()
    expect(reconcilePiPendingPromptScope(second, {
      ...scope,
      scopeKey: 'project:workspace-b',
    })).toBeNull()
  })

  it('keeps the pre-entry activity buffer bounded', () => {
    let pending = createPiPendingPromptProvenance({
      ...scope,
      operationId: 7,
      initialMessageCount: 0,
    })

    for (let index = 0; index < 40; index += 1) {
      pending = capturePiPendingPromptActivity(pending, scope, {
        kind: 'notification',
        id: `notification:${index}`,
        message: `Message ${index}`,
        tone: 'info',
        state: 'settled',
      })!
    }

    expect(pending.activities).toHaveLength(32)
    expect(pending.activities[0]?.id).toBe('notification:8')
    expect(pending.activities[pending.activities.length - 1]?.id).toBe('notification:39')
  })
})
