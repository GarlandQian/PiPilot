import { describe, expect, it, vi } from 'vitest'
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { CONVERSATION_TASK_CUSTOM_TYPE, getConversationTaskSnapshotFromBranch, type ConversationTaskEntry } from '../../src/shared/conversation-task'
import { PIPILOT_CONVERSATION_TASK_EXTENSION } from '../../src/main/pi-host/runtime-conversation-task'

async function harness(entries: ConversationTaskEntry[] = []) {
  const handlers = new Map<string, (event: any, context: ExtensionContext) => any>()
  let tool!: ToolDefinition
  let sessionId = 'session-1'
  const sendUserMessage = vi.fn()
  const registerCommand = vi.fn()
  const ctx = { sessionManager: { getBranch: () => entries, getSessionId: () => sessionId } } as unknown as ExtensionContext
  await PIPILOT_CONVERSATION_TASK_EXTENSION.factory({
    on: (name: string, handler: (event: any, ctx: ExtensionContext) => any) => handlers.set(name, handler),
    appendEntry: (customType: string, data: unknown) => entries.push({ id: `entry-${entries.length}`, parentId: entries[entries.length - 1]?.id ?? null, type: 'custom', customType, data }),
    sendUserMessage, registerCommand,
    registerTool: (definition: ToolDefinition) => { tool = definition },
  } as unknown as ExtensionAPI)
  const emit = (name: string, event = {}) => handlers.get(name)?.(event, ctx)
  await emit('session_start')
  return {
    entries, handlers, sendUserMessage, registerCommand, emit,
    read: () => getConversationTaskSnapshotFromBranch(entries),
    update: (input: unknown, signal?: AbortSignal) => tool.execute('call', input, signal, undefined, ctx as never),
    changeSession: () => { sessionId = 'session-2' },
  }
}

const metadata = { summary: 'Feature implemented and verified', blockers: [], nextActions: [{ id: 'review', label: 'Review', prompt: 'Review the completed change' }] }

describe('Runtime conversation overview metadata', () => {
  it('registers metadata without a second plan command, approval, or continuation engine', async () => {
    const h = await harness()
    await h.update(metadata)
    expect(h.read()).toMatchObject({ version: 2, ...metadata })
    expect(h.registerCommand).not.toHaveBeenCalled()
    expect(h.handlers.has('agent_before_settle')).toBe(false)
    expect(h.handlers.has('agent_end')).toBe(false)
    expect(h.sendUserMessage).not.toHaveBeenCalled()
    await expect(h.update({ ...metadata, plan: { approvedAt: 123 } })).rejects.toThrow()
  })

  it('restores historical summaries without writes, execution, or approval instructions', async () => {
    const entries = [{ id: 'old', parentId: null, type: 'custom', customType: CONVERSATION_TASK_CUSTOM_TYPE, data: {
      version: 1, updatedAt: 1, ...metadata, plan: { status: 'running', approvedAt: 1 },
    } }]
    const h = await harness(entries)
    const event = { systemPromptOptions: { sections: {} as Record<string, string> } }
    await h.emit('before_agent_start', event)
    expect(event.systemPromptOptions.sections.pipilot_task).toContain('Plan mode owns planning')
    expect(event.systemPromptOptions.sections.pipilot_task).not.toContain('approvedAt')
    expect(h.entries).toHaveLength(1)
    expect(h.sendUserMessage).not.toHaveBeenCalled()
  })

  it('rejects aborted and stale-session metadata writes', async () => {
    const h = await harness()
    await expect(h.update(metadata, AbortSignal.abort())).rejects.toThrow('stopped')
    h.changeSession()
    await expect(h.update(metadata)).rejects.toThrow('session changed')
    await h.emit('session_start')
    await h.update(metadata)
    await h.emit('session_shutdown')
    await expect(h.update(metadata)).rejects.toThrow('session changed')
    expect(h.entries).toHaveLength(1)
  })
})
