import type { LocalPiSessionEntry, LocalPiSlashCommand, LocalPiToolCall } from '@/shared/local-pi'
import { CONVERSATION_TASK_CUSTOM_TYPE, getConversationBranchEntries, getConversationTaskSnapshotFromBranch } from '@/shared/conversation-task'
import { parsePromptSkillEnvelope } from './prompt-presentation'

export interface ConversationResource {
  path: string
  entryId: string
  action: 'read' | 'write' | 'edit'
}
export interface ConversationCapability {
  name: string
  kind: 'skill' | 'mcp'
  entryId?: string
}
export interface ConversationLink { url: string; entryId: string }
const MCP_RESOURCE_TOOLS = new Set(['read_mcp_resource', 'list_mcp_resources', 'list_mcp_resource_templates'])

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Evidence comes from the active branch, never arbitrary paths printed by a tool. */
export function projectConversationContext(entries: readonly LocalPiSessionEntry[], leafId: string | null, commands: readonly LocalPiSlashCommand[]) {
  const branch = getConversationBranchEntries(entries, leafId)
  const sources = new Map<string, ConversationResource>()
  const outputs = new Map<string, ConversationResource>()
  const capabilities = new Map<string, ConversationCapability>()
  const links = new Map<string, ConversationLink>()
  const recordFile = (name: string, args: Record<string, unknown> | null, entryId: string) => {
    if (!['read', 'write', 'edit'].includes(name) || typeof args?.path !== 'string' || !args.path.trim()) return
    const resource: ConversationResource = { path: args.path, entryId, action: name as ConversationResource['action'] }
    const list = resource.action === 'read' ? sources : outputs
    list.delete(resource.path)
    list.set(resource.path, resource)
  }
  for (const command of commands) if (command.source === 'skill') {
    const name = command.name.replace(/^skill:/u, '')
    capabilities.set(`skill:${name}`, { name, kind: 'skill' })
  }
  const calls = new Map<string, { call: LocalPiToolCall; entryId: string }>()
  let userAnchor: string | null = null
  const recordMcp = (toolName: string, entryId: string, args?: Record<string, unknown> | null, details?: Record<string, unknown> | null) => {
    const match = /^mcp__([^_].*?)__(.+)$/u.exec(toolName)
    if (match) {
      const name = `${match[1]} / ${match[2]}`
      capabilities.set(`mcp:${name}`, { name, kind: 'mcp', entryId })
    }
    if (!MCP_RESOURCE_TOOLS.has(toolName)) return
    // Pi's native resource tools identify the selected server in their
    // arguments and details. Cross-server listings have an empty server; do
    // not infer one from arbitrary output text or attribute failed servers.
    if (details?.tool !== undefined && details.tool !== toolName) return
    const requestedServer = typeof args?.server === 'string' ? args.server.trim() : ''
    const returnedServer = typeof details?.server === 'string' ? details.server.trim() : ''
    if (requestedServer && returnedServer && requestedServer !== returnedServer) return
    const server = returnedServer || requestedServer
    if (!server) return
    const name = `${server} / ${toolName}`
    capabilities.set(`mcp:${name}`, { name, kind: 'mcp', entryId })
  }
  const edits = new Map<string, Extract<LocalPiSessionEntry, { type: 'context_edit' }>['replacement']>()
  let lastUserIndex = -1
  let lastTaskIndex = -1
  for (const [index, entry] of (branch ?? []).entries()) {
    if (entry.type === 'message' && entry.message.role === 'user') lastUserIndex = index
    if (entry.type === 'custom' && entry.customType === CONVERSATION_TASK_CUSTOM_TYPE) lastTaskIndex = index
  }
  for (const entry of branch ?? []) if (entry.type === 'context_edit') edits.set(entry.targetId, entry.replacement)
  for (const entry of branch ?? []) {
    if (entry.type !== 'message' || (edits.has(entry.id) && edits.get(entry.id) === null)) continue
    const message = entry.message
    if (message.role === 'user') userAnchor = entry.id
    // Transcript navigation is rooted at visible user response anchors.
    if (!userAnchor) continue
    if (message.role === 'assistant' || message.role === 'user') {
      const content = edits.get(entry.id)?.content ?? message.content
      const blocks = typeof content === 'string' ? [{ type: 'text' as const, text: content }] : content
      for (const block of blocks) {
        if (block.type === 'toolCall') calls.set(block.id, { call: block, entryId: userAnchor })
        if (block.type !== 'text') continue
        const skill = message.role === 'user' ? parsePromptSkillEnvelope(block.text) : null
        if (skill) capabilities.set(`skill:${skill.name}`, { name: skill.name, kind: 'skill', entryId: userAnchor })
        // These are mentioned links, not a claim that a web tool visited them.
        for (const match of (skill?.userMessage ?? block.text).matchAll(/https?:\/\/[^\s<>"'`\]\)]+/gu)) {
          try {
            const url = new URL(match[0].replace(/[.,;!?]+$/u, ''))
            if (url.username || url.password) continue
            links.delete(url.href)
            links.set(url.href, { url: url.href, entryId: userAnchor })
          } catch { /* An incomplete streamed URL is not a source. */ }
        }
      }
    }
    if (message.role !== 'toolResult') continue
    const invoked = calls.get(message.toolCallId)
    if (!invoked || invoked.call.name !== message.toolName) continue
    // Codemode may fail after earlier nested calls succeeded. Those calls are
    // still evidence; do not infer their success from the parent tool result.
    if (message.toolName === 'codemode') for (const call of message.nestedCalls?.calls ?? []) {
      if (call.status === 'ok') {
        recordMcp(call.name, invoked.entryId, object(call.arguments))
        recordFile(call.name, object(call.arguments), invoked.entryId)
      }
    }
    if (message.isError) continue
    const args = object(invoked.call.arguments)
    recordFile(message.toolName, args, invoked.entryId)
    const details = object(message.details)
    recordMcp(message.toolName, invoked.entryId, args, details)
    if (message.toolName === 'mcp' && typeof details?.server === 'string' && typeof details.tool === 'string') {
      const name = `${details.server} / ${details.tool}`
      capabilities.set(`mcp:${name}`, { name, kind: 'mcp', entryId: invoked.entryId })
    }
  }
  return {
    valid: branch !== null,
    suggestionsCurrent: lastTaskIndex > lastUserIndex,
    task: branch ? getConversationTaskSnapshotFromBranch(branch) : null,
    sources: [...sources.values()].reverse(),
    outputs: [...outputs.values()].reverse(),
    capabilities: [...capabilities.values()].sort((a, b) => Number(Boolean(b.entryId)) - Number(Boolean(a.entryId)) || a.name.localeCompare(b.name)),
    links: [...links.values()].reverse(),
  }
}
