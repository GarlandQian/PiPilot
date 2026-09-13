import { describe, expect, it } from 'vitest'
import { groupConversationTurns } from '../../src/renderer/pi-rpc/presentation'
import { projectResponsePresentation } from '../../src/renderer/pi-rpc/response-presentation'
import type {
  ResponsePresentation,
  ResponsePresentationOptions,
} from '../../src/renderer/pi-rpc/response-presentation'
import type { ConversationResponseGroup, ToolCall, Turn } from '../../src/types/chat'

const settled: ResponsePresentationOptions = { active: false, status: 'completed' }
const running: ResponsePresentationOptions = { active: true, status: 'running' }

function user(id = 'user'): Extract<Turn, { kind: 'user' }> {
  return { kind: 'user', id, text: 'Inspect the project.', time: '', anchorEntryId: `entry:${id}` }
}

function agent(id: string, markdown: string, state: Extract<Turn, { kind: 'agent' }>['state'] = 'complete'): Turn {
  return { kind: 'agent', id, markdown, state }
}

function tool(id: string, status: ToolCall['status'] = 'success'): Extract<Turn, { kind: 'tool' }> {
  return {
    kind: 'tool',
    id: `turn:${id}`,
    call: { id, kind: 'shell', title: id, body: id, status },
  }
}

function group(turns: readonly Turn[]): ConversationResponseGroup {
  return { id: 'response:user', anchorEntryId: 'entry:user', turns }
}

function flattenedSourceIds(presentation: ResponsePresentation): string[] {
  return [
    ...(presentation.prompt ? [presentation.prompt.id] : []),
    ...presentation.segments.flatMap((segment) => segment.kind === 'turn'
      ? [segment.turn.id]
      : segment.run.sections.flatMap((section) => section.items.map((item) => `turn:${item.call.id}`))),
  ]
}

describe('response presentation', () => {
  it('separates the prompt, ordered work, and final answer while retaining copy and fork provenance', () => {
    const prompt = user()
    const actions: Turn = {
      kind: 'response-actions',
      id: 'actions',
      copyMarkdown: 'I will inspect it.\n\nAll checks passed.',
      anchorEntryId: 'entry:user',
      forkEntryId: 'entry:answer',
    }
    const turns: Turn[] = [
      prompt,
      { kind: 'thinking', id: 'thinking', text: 'Observed reasoning.', state: 'complete' },
      agent('commentary', 'I will inspect it.'),
      tool('read'),
      tool('check'),
      agent('answer', 'All checks passed.'),
      actions,
    ]
    const result = projectResponsePresentation(group(turns), settled)

    expect(result.prompt).toBe(prompt)
    expect(result.answerId).toBe('answer')
    expect(result.status).toBe('completed')
    expect(result.isActive).toBe(false)
    expect(result.segments.map((segment) => [segment.id, segment.region])).toEqual([
      ['thinking', 'persistent'],
      ['commentary', 'work'],
      ['tool-activity-run:read', 'work'],
      ['answer', 'answer'],
      ['actions', 'persistent'],
    ])
    expect(result.work).toEqual({
      count: 3,
      toolCount: 2,
      thinkingCount: 1,
      activeToolCount: 0,
      failedToolCount: 0,
      cancelledToolCount: 0,
      hasActiveWork: false,
    })
    const actionSegment = result.segments[result.segments.length - 1]
    expect(actionSegment).toMatchObject({ kind: 'turn', turn: actions })
    expect(actionSegment?.kind === 'turn' && actionSegment.turn).toBe(actions)
    expect(flattenedSourceIds(result)).toEqual(turns.map((turn) => turn.id))
  })

  it('keeps a streaming text segment identity stable when a later tool makes it commentary', () => {
    const text = agent('stream:text:0', 'Looking at the files.', 'streaming')
    const before = projectResponsePresentation(group([user(), text]), running)
    const during = projectResponsePresentation(group([user(), text, tool('inspect', 'running')]), running)
    const after = projectResponsePresentation(group([
      user(),
      text,
      tool('inspect'),
      agent('stream:text:1', 'The result is', 'streaming'),
    ]), running)

    expect(before.answerId).toBe(text.id)
    expect(during.answerId).toBeNull()
    expect(after.answerId).toBe('stream:text:1')
    expect(before.segments[0]).toMatchObject({ id: text.id, kind: 'turn', region: 'answer', turn: text })
    expect(during.segments[0]).toMatchObject({ id: text.id, kind: 'turn', region: 'work', turn: text })
    expect(after.segments[0]).toMatchObject({ id: text.id, kind: 'turn', region: 'work', turn: text })
    expect(during.work).toMatchObject({ activeToolCount: 1, hasActiveWork: true })
    expect(during.status).toBe('running')
    expect(after.isActive).toBe(true)
  })

  it('never promotes text from before the final tool, including after failure', () => {
    const turns: Turn[] = [
      user(),
      agent('commentary', 'I will check.'),
      tool('failed', 'failed'),
      { kind: 'notice', id: 'error', notice: 'response-error' },
    ]
    const result = projectResponsePresentation(group(turns), settled)

    expect(result.answerId).toBeNull()
    expect(result.status).toBe('failed')
    expect(result.work.failedToolCount).toBe(1)
    expect(result.segments[result.segments.length - 1]).toMatchObject({ id: 'error', region: 'persistent', turn: turns[3] })
    expect(flattenedSourceIds(result)).toEqual(turns.map((turn) => turn.id))
  })

  it.each([
    ['response-error', 'failed'],
    ['response-aborted', 'cancelled'],
  ] as const)('keeps a trailing %s visible without demoting the answer or rewriting its state', (notice, status) => {
    const partial = agent('partial', 'Here is the partial result.', 'aborted')
    const terminal: Turn = { kind: 'notice', id: 'terminal', notice }
    const result = projectResponsePresentation(group([user(), tool('inspect'), partial, terminal]), settled)

    expect(result.answerId).toBe('partial')
    expect(result.status).toBe(status)
    expect(result.segments[result.segments.length - 2]).toMatchObject({ region: 'answer', turn: partial })
    expect(result.segments[result.segments.length - 1]).toMatchObject({ region: 'persistent', turn: terminal })
  })

  it('keeps plans and notifications in place between work and after the answer', () => {
    const turns: Turn[] = [
      user(),
      tool('first'),
      { kind: 'plan', id: 'plan', markdown: 'Review this plan.', lifecycle: 'ready', actions: ['implement', 'revise'] },
      { kind: 'activity', id: 'notification', activity: { kind: 'notification', id: 'n', message: 'Review required.', tone: 'warning', state: 'settled' } },
      tool('second'),
      { kind: 'activity', id: 'working', activity: { kind: 'working', id: 'w', message: 'Checking output.', state: 'settled' } },
      agent('answer', 'Done.'),
      { kind: 'activity', id: 'error', activity: { kind: 'extension-error', id: 'e', message: 'Extension reported this exact error.', state: 'settled' } },
      { kind: 'notice', id: 'compacted', notice: 'compacted' },
    ]
    const result = projectResponsePresentation(group(turns), settled)

    expect(result.segments.map((segment) => [segment.id, segment.region])).toEqual([
      ['tool-activity-run:first', 'work'],
      ['plan', 'persistent'],
      ['notification', 'persistent'],
      ['tool-activity-run:second', 'work'],
      ['working', 'work'],
      ['answer', 'answer'],
      ['error', 'persistent'],
      ['compacted', 'persistent'],
    ])
    expect(flattenedSourceIds(result)).toEqual(turns.map((turn) => turn.id))
  })

  it('preserves failed intermediate text and retry errors as visible records', () => {
    const turns: Turn[] = [
      user(),
      agent('failed-text', 'Provider stopped here.', 'error'),
      { kind: 'thinking', id: 'failed-thinking', text: 'Only emitted reasoning.', state: 'aborted' },
      { kind: 'activity', id: 'retry-error', activity: { kind: 'retry', id: 'retry', retryKind: 'provider', phase: 'error', message: 'Exact provider error.', state: 'settled' } },
      tool('recover'),
      agent('answer', 'Recovered.'),
    ]
    const result = projectResponsePresentation(group(turns), settled)

    expect(result.status).toBe('completed')
    expect(result.segments.slice(0, 3).every((segment) => segment.region === 'persistent')).toBe(true)
    expect(flattenedSourceIds(result)).toEqual(turns.map((turn) => turn.id))
  })

  it('does not invent thinking or an answer for tool-only and empty responses', () => {
    const toolOnly = projectResponsePresentation(group([user(), tool('check')]), settled)
    const empty = projectResponsePresentation(group([user()]), running)

    expect(toolOnly.answerId).toBeNull()
    expect(toolOnly.work.thinkingCount).toBe(0)
    expect(toolOnly.segments).toHaveLength(1)
    expect(empty.answerId).toBeNull()
    expect(empty.isActive).toBe(true)
    expect(empty.segments).toEqual([])
    expect(empty.work.count).toBe(0)
  })

  it.each(['streaming', 'complete', 'error', 'aborted'] as const)(
    'keeps %s thinking independently visible in source order without counting it as tool work',
    (state) => {
      const thinking: Turn = { kind: 'thinking', id: 'thinking', text: '## Observed reasoning\n\n**Inspect** the result.', state }
      const turns: Turn[] = [user(), tool('before'), thinking, tool('after'), agent('answer', 'Done.')]
      const result = projectResponsePresentation(group(turns), state === 'streaming' ? running : settled)
      const segment = result.segments[1]

      expect(segment).toMatchObject({ id: 'thinking', kind: 'turn', region: 'persistent', turn: thinking })
      expect(segment?.kind === 'turn' && segment.turn).toBe(thinking)
      expect(result.work).toMatchObject({ count: 2, toolCount: 2, thinkingCount: 1 })
      expect(flattenedSourceIds(result)).toEqual(turns.map((turn) => turn.id))
    },
  )

  it('keeps a thinking-only response visible without a work-log toggle or a false waiting state', () => {
    const thinking: Turn = { kind: 'thinking', id: 'thinking', text: 'Observed live reasoning.', state: 'streaming' }
    const result = projectResponsePresentation(group([user(), thinking]), running)

    expect(result.segments).toEqual([{ kind: 'turn', id: thinking.id, turn: thinking, region: 'persistent' }])
    expect(result.work).toMatchObject({ count: 0, toolCount: 0, thinkingCount: 1, hasActiveWork: true })
    expect(result.answerId).toBeNull()
    expect(result.isActive).toBe(true)
  })

  it('uses only substantive text as the answer candidate and retains empty source turns', () => {
    const turns: Turn[] = [user(), agent('answer', 'Done.'), agent('empty', ' \n ')]
    const result = projectResponsePresentation(group(turns), settled)

    expect(result.answerId).toBe('answer')
    expect(result.segments[result.segments.length - 1]).toMatchObject({ id: 'empty', region: 'work' })
    expect(flattenedSourceIds(result)).toEqual(turns.map((turn) => turn.id))
  })

  it('preserves repeated prompts as separate user-led groups and never deduplicates equal text', () => {
    const turns: Turn[] = [user('first'), agent('first-answer', 'First.'), user('second'), agent('second-answer', 'Second.')]
    const results = groupConversationTurns(turns).map((response) => projectResponsePresentation(response, settled))

    expect(results.map((result) => result.prompt?.id)).toEqual(['first', 'second'])
    expect(results.map((result) => result.answerId)).toEqual(['first-answer', 'second-answer'])
    expect(results.flatMap(flattenedSourceIds)).toEqual(turns.map((turn) => turn.id))
  })

  it('extracts only a leading prompt and preserves unexpected extra users in source order', () => {
    const turns: Turn[] = [user(), agent('commentary', 'First.'), user('additional')]
    const result = projectResponsePresentation(group(turns), settled)
    const unanchored = projectResponsePresentation(group([tool('before'), user('later'), agent('answer', 'After.')]), settled)

    expect(result.prompt?.id).toBe('user')
    expect(result.answerId).toBeNull()
    expect(result.segments[result.segments.length - 1]).toMatchObject({ id: 'additional', region: 'persistent' })
    expect(flattenedSourceIds(result)).toEqual(turns.map((turn) => turn.id))
    expect(unanchored.prompt).toBeNull()
    expect(unanchored.segments.map((segment) => segment.id)).toEqual(['tool-activity-run:before', 'later', 'answer'])
  })

  it('does not apply the live session status to a historical group', () => {
    const result = projectResponsePresentation(group([user(), tool('failed', 'failed'), agent('answer', 'Recovered.')]), {
      active: false,
      status: 'running',
    })

    expect(result.status).toBe('completed')
    expect(result.isActive).toBe(false)
    expect(result.work.failedToolCount).toBe(1)
    expect(result.work.hasActiveWork).toBe(false)
  })

  it('retains response action payloads without treating controls alone as proof of completion', () => {
    const actions: Turn = {
      kind: 'response-actions',
      id: 'actions',
      copyMarkdown: 'Completed response from retained history.',
      forkEntryId: 'entry:completed',
    }
    const result = projectResponsePresentation(group([user(), actions]), { active: false, status: 'running' })

    expect(result.status).toBe('idle')
    expect(result.answerId).toBeNull()
    expect(result.segments[0]).toMatchObject({ region: 'persistent', turn: actions })
  })

  it.each([
    ['response-error', 'failed'],
    ['response-aborted', 'cancelled'],
  ] as const)('does not let response actions override an earlier %s notice', (notice, expectedStatus) => {
    const turns: Turn[] = [
      user(),
      agent('partial', 'A partial response.'),
      { kind: 'notice', id: 'terminal', notice },
      { kind: 'response-actions', id: 'actions', copyMarkdown: 'A partial response.', forkEntryId: 'entry:partial' },
    ]
    const result = projectResponsePresentation(group(turns), settled)

    expect(result.status).toBe(expectedStatus)
    expect(result.answerId).toBe('partial')
    expect(flattenedSourceIds(result)).toEqual(turns.map((turn) => turn.id))
    expect(result.segments[2]).toMatchObject({ region: 'persistent', turn: turns[3] })
  })

  it.each([
    ['error', 'failed'],
    ['aborted', 'cancelled'],
  ] as const)('does not let response actions override partial text in the %s state', (state, expectedStatus) => {
    const result = projectResponsePresentation(group([
      user(),
      agent('partial', 'The provider stopped here.', state),
      { kind: 'response-actions', id: 'actions', copyMarkdown: 'The provider stopped here.' },
    ]), settled)

    expect(result.status).toBe(expectedStatus)
  })

  it('reports recovery from an earlier failed tool when completed answer text precedes controls', () => {
    const result = projectResponsePresentation(group([
      user(),
      tool('first-attempt', 'failed'),
      tool('retry'),
      agent('answer', 'The retry succeeded.'),
      { kind: 'response-actions', id: 'actions', copyMarkdown: 'The retry succeeded.', forkEntryId: 'entry:answer' },
    ]), { active: false, status: 'running' })

    expect(result.status).toBe('completed')
    expect(result.isActive).toBe(false)
    expect(result.work.failedToolCount).toBe(1)
  })

  it.each([
    ['assistant', agent('unfinished', 'The response was', 'streaming')],
    ['thinking', { kind: 'thinking', id: 'unfinished', text: 'Observed partial reasoning.', state: 'streaming' } satisfies Turn],
    ['running tool', tool('unfinished', 'running')],
    ['queued tool', tool('unfinished', 'queued')],
  ] as const)('treats an inactive %s snapshot as an unknown outcome while preserving source evidence', (_label, unfinished) => {
    const result = projectResponsePresentation(group([user(), unfinished]), { active: false, status: 'running' })

    expect(result.status).toBe('idle')
    expect(result.isActive).toBe(false)
    expect(result.work.hasActiveWork).toBe(false)
    const segment = result.segments[0]
    expect(segment?.kind === 'turn' ? segment.turn : segment?.run.sections[0]?.items[0]?.call).toBe(
      unfinished.kind === 'tool' ? unfinished.call : unfinished,
    )
  })

  it('counts queued, failed, and cancelled tools without claiming detached work is running', () => {
    const result = projectResponsePresentation(group([
      user(),
      tool('queued', 'queued'),
      tool('running', 'running'),
      tool('failed', 'failed'),
      tool('cancelled', 'cancelled'),
      tool('detached', 'detached'),
    ]), running)

    expect(result.work).toMatchObject({
      count: 5,
      toolCount: 5,
      activeToolCount: 2,
      failedToolCount: 1,
      cancelledToolCount: 1,
      hasActiveWork: true,
    })
  })

  it('keeps earlier projections and source subagent timelines immutable as new evidence arrives', () => {
    const firstTool = tool('subagent', 'running')
    firstTool.call.subagent = {
      mode: 'single',
      tasks: [],
      malformed: false,
      omittedTaskCount: 0,
      timeline: [{ id: 'event:1', sequence: 1, kind: 'progress', state: 'active', markdown: 'Inspecting.', truncated: false }],
    }
    const input = group([user(), firstTool])
    const before = projectResponsePresentation(input, running)
    const snapshot = JSON.stringify({ input, before })
    const nextTool: Extract<Turn, { kind: 'tool' }> = {
      ...firstTool,
      call: {
        ...firstTool.call,
        status: 'success',
        subagent: {
          ...firstTool.call.subagent,
          timeline: [
            ...firstTool.call.subagent.timeline!,
            { id: 'event:2', sequence: 2, kind: 'result', state: 'complete', markdown: 'Finished.', truncated: false },
          ],
        },
      },
    }
    const after = projectResponsePresentation(group([input.turns[0]!, nextTool, agent('answer', 'Done.')]), settled)
    const beforeRun = before.segments[0]
    const afterRun = after.segments[0]

    expect(JSON.stringify({ input, before })).toBe(snapshot)
    expect(beforeRun?.id).toBe(afterRun?.id)
    expect(beforeRun?.kind === 'activity-run' && beforeRun.run.sections[0]?.items[0]?.call).toBe(firstTool.call)
    expect(afterRun?.kind === 'activity-run' && afterRun.run.sections[0]?.items[0]?.call).toBe(nextTool.call)
    expect(firstTool.call.subagent.timeline).toHaveLength(1)
    expect(nextTool.call.subagent?.timeline).toHaveLength(2)
  })
})
