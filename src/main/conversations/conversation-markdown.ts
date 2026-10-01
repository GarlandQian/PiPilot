import type { LocalPiAgentMessage, LocalPiImageContent, LocalPiSessionEntry } from '../../shared/local-pi'
import { z } from 'zod'
import type { ConversationExportRequest } from '../../shared/conversation-export'
import { getConversationTaskSnapshotFromBranch, parseConversationPlanKickoff } from '../../shared/conversation-task'
import { encodeConversationMarkdown, markdownDigest, type ConversationMarkdownManifest } from './conversation-markdown-format'

export class ConversationExportError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ConversationExportError' }
}

export interface MarkdownImage { name: string; bytes: Buffer }
export interface ConversationMarkdown { markdown: string; images: MarkdownImage[] }
const MAX_EXPORT_BYTES = 128 * 1024 * 1024
const MAX_IMAGE_BYTES = 32 * 1024 * 1024
const IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif',
}

// Archive-only reader: preserve authored plan/evidence in old exports without
// reviving its retired approvals, controls or continuation engine.
const archivedPlanSchema = z.object({
  version: z.literal(1),
  plan: z.object({
    title: z.string().max(500),
    steps: z.array(z.object({
      title: z.string().max(1_000),
      status: z.enum(['pending', 'in_progress', 'completed', 'blocked', 'skipped']),
      evidence: z.string().max(4_000).optional(),
    })).max(100),
  }),
})

function archivedPlan(entries: readonly LocalPiSessionEntry[]) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!
    if (entry.type !== 'custom' || entry.customType !== 'pipilot.task-state') continue
    const parsed = archivedPlanSchema.safeParse(entry.data)
    return parsed.success ? parsed.data.plan : null
  }
  return null
}

/** get_entries contains other forks too; only leaf ancestors belong to this export. */
export function conversationExportBranch(entries: readonly LocalPiSessionEntry[], leafId: string | null) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  if (byId.size !== entries.length) throw new ConversationExportError('EXPORT_INVALID_BRANCH', 'The conversation history is inconsistent.')
  const branch: LocalPiSessionEntry[] = []
  const visited = new Set<string>()
  let cursor = leafId
  while (cursor !== null) {
    const entry = byId.get(cursor)
    if (!entry || visited.has(cursor)) throw new ConversationExportError('EXPORT_INVALID_BRANCH', 'The complete conversation branch is unavailable.')
    visited.add(cursor)
    branch.push(entry)
    cursor = entry.parentId
  }
  return branch.reverse()
}

export function selectExportEntries(branch: readonly LocalPiSessionEntry[], selection: ConversationExportRequest['selection']) {
  if (selection.kind === 'conversation') return branch
  if (selection.kind === 'message') {
    const entry = branch.find((candidate) => candidate.id === selection.entryId && candidate.type === 'message' &&
      (candidate.message.role === 'user' || candidate.message.role === 'assistant'))
    if (!entry) throw new ConversationExportError('EXPORT_RESPONSE_UNAVAILABLE', 'This message is no longer in the active conversation branch.')
    return [entry]
  }
  const start = branch.findIndex((entry) => entry.id === selection.anchorEntryId && entry.type === 'message' && entry.message.role === 'user')
  if (start < 0) throw new ConversationExportError('EXPORT_RESPONSE_UNAVAILABLE', 'This response is no longer in the active conversation branch.')
  const end = branch.findIndex((entry, index) => index > start && entry.type === 'message' && entry.message.role === 'user')
  return branch.slice(start, end === -1 ? undefined : end)
}

/** A shareable export does not expose an account name through absolute home paths. */
export function redactExportHomePaths(text: string, homeDirectory: string) {
  let result = text
  const homes = new Set([homeDirectory, homeDirectory.split('\\').join('/'), encodeURI(homeDirectory), encodeURIComponent(homeDirectory)])
  for (const home of homes) if (home && home.length > 1) result = result.split(home).join('~')
  return result
    .replace(/(?:\/Users|\/home)\/[^\s/<>"'`()[\]]+/gu, '~')
    .replace(/[A-Za-z]:[\\/]Users[\\/][^\s\\/<>"'`()[\]]+/gu, '~')
}

function fenced(text: string, language = 'text') {
  let length = 3
  for (const match of text.matchAll(/`+/gu)) length = Math.max(length, match[0].length + 1)
  const fence = '`'.repeat(length)
  return `${fence}${language}\n${text}\n${fence}`
}

function textContent(content: string | readonly { type: string; text?: string }[]) {
  return typeof content === 'string' ? content : content.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n\n')
}

/** Expanded skill instructions are runtime context, not the user's own question. */
function userText(text: string, zh: boolean) {
  const kickoff = parseConversationPlanKickoff(text)
  if (kickoff) return zh ? `继续已批准的计划：${kickoff.title}` : `Continue approved plan: ${kickoff.title}`
  if (!/^<skill name="[^"\r\n]+" location="[^"\r\n]+">\n/u.test(text)) return text
  const lines = text.split('\n')
  let fence: { marker: string; count: number } | null = null
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (!fence && line === '</skill>') return lines.slice(index + 1).join('\n').trimStart()
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line)
    if (!delimiter) continue
    if (fence) {
      if (delimiter[1][0] === fence.marker && delimiter[1].length >= fence.count && !delimiter[2].trim()) fence = null
    } else if (delimiter[1][0] !== '`' || !delimiter[2].includes('`')) fence = { marker: delimiter[1][0], count: delimiter[1].length }
  }
  return text
}

function officialPlan(message: LocalPiAgentMessage): string | null {
  if (message.role === 'toolResult' && message.toolName === 'plan_mode_complete' && !message.isError) {
    const details = message.details
    if (details && typeof details === 'object' && !Array.isArray(details)) {
      const plan = details as Record<string, unknown>
      if (plan.version === 1 && plan.source === 'plan_mode_complete' && typeof plan.plan === 'string' && plan.plan.trim()) return plan.plan
    }
  }
  if (message.role === 'custom' && message.display && message.customType === 'proposed-plan') {
    const text = textContent(message.content)
    if (/^\*\*(?:Proposed Plan|Saved Plan|Active Implementation Plan)\*\*\r?\n/u.test(text)) return text.replace(/^[^\n]*\n/u, '').trim()
  }
  return null
}

export function buildConversationMarkdown(options: {
  entries: readonly LocalPiSessionEntry[]
  leafId: string | null
  input: ConversationExportRequest
  title: string
  homeDirectory: string
  assetDirectoryName: string
}): ConversationMarkdown {
  const branch = conversationExportBranch(options.entries, options.leafId)
  const selected = selectExportEntries(branch, options.input.selection)
  const zh = options.input.locale === 'zh-CN'
  const labels = zh
    ? { user: '用户', assistant: '助手', note: '提示', plan: '计划', tools: '工具输出', failed: '失败', image: '图片', omitted: '图片未导出：不支持的格式或无效图片数据。', task: '任务状态', blockers: '阻塞事项', next: '下一步' }
    : { user: 'User', assistant: 'Assistant', note: 'Notice', plan: 'Plan', tools: 'Tool output', failed: 'Failed', image: 'Image', omitted: 'Image omitted: unsupported format or invalid image data.', task: 'Task status', blockers: 'Blockers', next: 'Next actions' }
  const images: MarkdownImage[] = []
  const imageMarkers = new Map<string, ConversationMarkdownManifest['records'][number]['images'][number]>()
  let imageBytes = 0
  const image = (part: LocalPiImageContent) => {
    const extension = IMAGE_EXTENSIONS[part.mimeType.toLowerCase()]
    const data = part.data.replace(/\s/gu, '')
    if (!extension || !data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(data)) return `> ${labels.omitted}`
    if (data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new ConversationExportError('EXPORT_TOO_LARGE', 'An image is too large to export.')
    const bytes = Buffer.from(data, 'base64')
    imageBytes += bytes.length
    if (imageBytes > MAX_EXPORT_BYTES) throw new ConversationExportError('EXPORT_TOO_LARGE', 'The conversation export is too large.')
    const name = `image-${images.length + 1}.${extension}`
    images.push({ name, bytes })
    const marker = `![${labels.image} ${images.length}](${encodeURIComponent(options.assetDirectoryName)}/${name})`
    imageMarkers.set(marker, { name, mimeType: part.mimeType.toLowerCase() as ConversationMarkdownManifest['records'][number]['images'][number]['mimeType'], marker })
    return marker
  }
  const contentWithImages = (content: string | readonly ({ type: string; text?: string } | LocalPiImageContent)[]) =>
    typeof content === 'string' ? content : content.flatMap((part) => part.type === 'text' ? [part.text ?? ''] : part.type === 'image' ? [image(part as LocalPiImageContent)] : []).join('\n\n')
  const title = options.title.replace(/[\r\n]/gu, ' ').trim() || (zh ? '会话' : 'Conversation')
  const sections = [`# ${title}`]
  const sectionRoles: Array<'user' | 'assistant' | 'context' | null> = [null]
  const pushSection = (section: string, role: 'user' | 'assistant' | 'context' = 'context') => {
    sections.push(section)
    sectionRoles.push(role)
  }
  const seenPlans = new Set<string>()
  // Context edits carry explicit removals/replacements and must not resurrect removed text.
  const replacements = new Map(branch.filter((entry) => entry.type === 'context_edit').map((entry) => [entry.targetId, entry.replacement]))
  for (const entry of selected) {
    let message: LocalPiAgentMessage | undefined
    if (entry.type === 'message') message = entry.message
    else if (entry.type === 'custom_message') message = { role: 'custom', customType: entry.customType, content: entry.content, display: entry.display, details: entry.details, timestamp: Date.parse(entry.timestamp) }
    if (!message) continue
    const replacement = replacements.get(entry.id)
    if (replacements.has(entry.id) && replacement === null) continue
    const content = replacement?.content ?? ('content' in message ? message.content : '')
    // A context edit supersedes the original content, including plan metadata.
    const plan = replacements.has(entry.id) ? null : officialPlan(message)
    if (plan) {
      if (!seenPlans.has(plan)) { pushSection(`## ${labels.plan}\n\n${plan}`); seenPlans.add(plan) }
      continue
    }
    if (message.role === 'user') {
      const body = typeof content === 'string' ? userText(content, zh) : contentWithImages(content.map((part) => part.type === 'text' ? { ...part, text: userText(part.text, zh) } : part))
      pushSection(`## ${labels.user}\n\n${body}`, 'user')
    } else if (message.role === 'assistant') {
      const body = textContent(content)
      if (body.trim()) pushSection(`## ${labels.assistant}\n\n${body}`, 'assistant')
    } else if (message.role === 'custom' && message.display) {
      const body = contentWithImages(content)
      if (body.trim()) pushSection(`## ${labels.note}\n\n${body}`)
    } else if (options.input.includeTools && message.role === 'toolResult') {
      const body = contentWithImages(content)
      pushSection(`## ${labels.tools}: ${message.toolName.replace(/[\r\n]/gu, ' ')}${message.isError ? ` (${labels.failed})` : ''}\n\n${fenced(textContent(content))}${body.includes('![') ? `\n\n${body.split('\n\n').filter((line) => line.startsWith('![')).join('\n\n')}` : ''}`)
    } else if (options.input.includeTools && message.role === 'bashExecution') {
      pushSection(`## ${labels.tools}: bash\n\n${fenced(message.command, 'sh')}\n\n${fenced(message.output)}`)
    }
  }
  const task = getConversationTaskSnapshotFromBranch(selected)
  if (task) {
    const body = [task.summary]
    const historical = archivedPlan(selected)
    if (historical) {
      body.push(`### ${historical.title}`)
      body.push(...historical.steps.map((step) => `- [${step.status === 'completed' ? 'x' : ' '}] ${step.title} (${step.status})${step.evidence ? ` — ${step.evidence}` : ''}`))
    }
    if (task.blockers.length) body.push(`### ${labels.blockers}\n\n${task.blockers.map((item) => `- ${item}`).join('\n')}`)
    if (task.nextActions.length) body.push(`### ${labels.next}\n\n${task.nextActions.map((item) => `- ${item.label}`).join('\n')}`)
    pushSection(`## ${labels.task}\n\n${body.filter(Boolean).join('\n\n')}`)
  }
  const records: ConversationMarkdownManifest['records'] = []
  const separator = '\n\n---\n\n'
  let offset = 0
  const body = sections.map((raw, index) => {
    const section = redactExportHomePaths(raw, options.homeDirectory)
    const role = sectionRoles[index]
    if (role) {
      // Context retains its section heading. User/assistant content excludes
      // our presentation label while preserving any headings authored in it.
      const prefix = role === 'context' ? 0 : section.indexOf('\n\n') + 2
      const content = section.slice(prefix)
      records.push({ role, start: offset + Buffer.byteLength(section.slice(0, prefix)), end: offset + Buffer.byteLength(section), sha256: markdownDigest(content),
        images: [...imageMarkers.values()].filter((image) => content.includes(image.marker)) })
    }
    offset += Buffer.byteLength(section) + Buffer.byteLength(separator)
    return section
  }).join(separator) + '\n'
  const markdown = encodeConversationMarkdown(body, { title: redactExportHomePaths(title, options.homeDirectory).slice(0, 256), assetDirectory: options.assetDirectoryName, records })
  if (Buffer.byteLength(markdown) + imageBytes > MAX_EXPORT_BYTES) throw new ConversationExportError('EXPORT_TOO_LARGE', 'The conversation export is too large.')
  return { markdown, images }
}
