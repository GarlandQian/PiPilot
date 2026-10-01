import { randomBytes, randomUUID } from 'node:crypto'
import { lstat, open, realpath } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import {
  CONVERSATION_IMPORT_MAX_IMAGE_BYTES, CONVERSATION_IMPORT_MAX_MARKDOWN_BYTES, CONVERSATION_IMPORT_MAX_MESSAGES, CONVERSATION_IMPORT_MAX_PREVIEW_CHARACTERS, CONVERSATION_IMPORT_MAX_TOTAL_BYTES,
  conversationImportCommitRequestSchema, conversationImportPreviewRequestSchema, importedConversationHistorySchema,
  type ConversationImportCommitRequest, type ConversationImportPreviewRequest, type ConversationImportPreviewResult, type ConversationImportWarning, type ImportedConversationHistory,
} from '../../shared/conversation-import'
import type { ConversationActivationResult, ConversationScope } from '../../shared/conversation-scope'
import { decodeConversationMarkdown } from './conversation-markdown-format'
import { inspectPiHostDto } from '../../shared/pi-host-protocol'

const PREVIEW_TTL_MS = 15 * 60 * 1000
const MAX_PREVIEWS = 4
const MIME_EXTENSIONS = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif' } as const
type ImageMime = keyof typeof MIME_EXTENSIONS
export class ConversationImportError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ConversationImportError' }
}

async function readRegularFile(file: string, maximum: number, expectedParent?: { path: string; dev: number; ino: number }) {
  const checkParent = async () => {
    if (!expectedParent) return
    const parent = await lstat(expectedParent.path)
    if (!parent.isDirectory() || parent.isSymbolicLink() || parent.dev !== expectedParent.dev || parent.ino !== expectedParent.ino || await realpath(expectedParent.path) !== expectedParent.path) throw new Error('Attachment directory changed')
  }
  await checkParent()
  const before = await lstat(file)
  if (!before.isFile() || before.isSymbolicLink()) throw new Error('Not a regular file')
  if (before.size > maximum) throw new ConversationImportError('IMPORT_TOO_LARGE', 'The selected document or its attachments are too large to import.')
  const handle = await open(file, 'r')
  try {
    const opened = await handle.stat()
    await checkParent()
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw new Error('File changed')
    // Bounded read prevents a concurrently growing file from expanding memory.
    const bytes = Buffer.alloc(opened.size + 1)
    let length = 0
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, length)
      if (!result.bytesRead) break
      length += result.bytesRead
    }
    const after = await handle.stat()
    await checkParent()
    if (expectedParent && await realpath(file) !== resolve(file)) throw new Error('File path changed')
    if (length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw new Error('File changed')
    return bytes.subarray(0, length)
  } finally { await handle.close() }
}

function imageMatchesMime(bytes: Buffer, mime: ImageMime) {
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (mime === 'image/gif') return /^GIF8[79]a$/u.test(bytes.subarray(0, 6).toString('ascii'))
  if (mime === 'image/webp') return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  return bytes.subarray(4, 8).toString('ascii') === 'ftyp' && /^(avif|avis)$/u.test(bytes.subarray(8, 12).toString('ascii'))
}

function titleFor(markdown: string, fileName: string) {
  return (/^#\s+([^\r\n]+)$/mu.exec(markdown)?.[1] ?? basename(fileName, extname(fileName))).replace(/[\r\n]+/gu, ' ').trim().slice(0, 256) || 'Imported conversation'
}

export async function parseConversationImport(file: string, locale: ConversationImportPreviewRequest['locale']) {
  if (!['.md', '.markdown'].includes(extname(file).toLowerCase())) throw new ConversationImportError('IMPORT_INVALID_FILE', 'Select a Markdown document.')
  let bytes: Buffer
  try { bytes = await readRegularFile(file, CONVERSATION_IMPORT_MAX_MARKDOWN_BYTES) } catch (error) {
    if (error instanceof ConversationImportError) throw error
    throw new ConversationImportError('IMPORT_READ_FAILED', 'The selected Markdown document could not be read safely.')
  }
  let markdown: string
  try { markdown = new TextDecoder('utf8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, '') } catch {
    throw new ConversationImportError('IMPORT_INVALID_FILE', 'The selected document must contain UTF-8 Markdown.')
  }
  if (!markdown.trim() || markdown.includes('\0')) throw new ConversationImportError('IMPORT_INVALID_FILE', 'The selected Markdown document is empty or invalid.')
  const decodedCandidate = decodeConversationMarkdown(markdown)
  const decoded = decodedCandidate?.records.some((record) => record.role === 'user' || (record.role === 'assistant' && record.images.reduce((text, image) => text.replace(image.marker, ''), record.text).trim())) ? decodedCandidate : null
  const warnings = new Set<ConversationImportWarning>()
  const documentMarkdown = markdown.replace(/^<!-- pipilot-conversation:v\d+ [^\r\n]* -->\r?(?:\n|$)/u, '')
  if (!decoded && !documentMarkdown.trim()) throw new ConversationImportError('IMPORT_INVALID_FILE', 'This Markdown document has no importable content.')
  let imageCount = 0
  let totalBytes = bytes.length
  const messages: ImportedConversationHistory['messages'] = []
  if (decoded) {
    if (decoded.records.length > CONVERSATION_IMPORT_MAX_MESSAGES) throw new ConversationImportError('IMPORT_TOO_LARGE', 'The document contains too many messages.')
    const parent = await realpath(dirname(file))
    const assetDirectory = decoded.manifest.assetDirectory
    const assets = join(parent, assetDirectory)
    // Only our explicit adjacent assets directory is accepted, never paths in
    // arbitrary Markdown, remote URLs, absolute paths, or symlink escapes.
    let safeAssets: { path: string; dev: number; ino: number } | null = null
    if (/^pipilot-assets-[a-zA-Z0-9_-]+$/u.test(assetDirectory)) {
      try {
        const details = await lstat(assets)
        if (details.isDirectory() && !details.isSymbolicLink() && await realpath(assets) === resolve(assets)) safeAssets = { path: resolve(assets), dev: details.dev, ino: details.ino }
      } catch { /* Missing assets are visible warnings, not silent data loss. */ }
    }
    const loadedImages = new Map<string, { type: 'image'; mimeType: ImageMime; data: string } | null>()
    for (const record of decoded.records) {
      const content: ImportedConversationHistory['messages'][number]['content'] = []
      let text = record.text
      const attachments: typeof content = []
      for (const attachment of record.images) {
        const markerIndex = text.indexOf(attachment.marker)
        if (markerIndex >= 0) {
          const before = text.slice(0, markerIndex)
          const after = text.slice(markerIndex + attachment.marker.length)
          // Remove only the exporter-added block separator, not authored
          // Markdown indentation or meaningful leading/trailing whitespace.
          text = before.endsWith('\n\n') ? before.slice(0, -2) + after : before + (after.startsWith('\n\n') ? after.slice(2) : after)
        }
        const key = `${attachment.name}:${attachment.mimeType}`
        let image = loadedImages.get(key)
        if (image === undefined) {
          image = null
          if (safeAssets && extname(attachment.name) === MIME_EXTENSIONS[attachment.mimeType]) {
            const path = join(assets, attachment.name)
            try {
              if (await realpath(path) !== resolve(path)) throw new Error('Symlink image')
              const imageBytes = await readRegularFile(path, CONVERSATION_IMPORT_MAX_IMAGE_BYTES, safeAssets)
              if (!imageMatchesMime(imageBytes, attachment.mimeType)) warnings.add('unsupportedImages')
              else {
                image = { type: 'image', mimeType: attachment.mimeType, data: imageBytes.toString('base64') }
              }
            } catch (error) {
              if (error instanceof ConversationImportError) throw error
              warnings.add('missingImages')
            }
          } else warnings.add('missingImages')
          loadedImages.set(key, image)
        }
        if (image) {
          totalBytes += Buffer.byteLength(image.data, 'base64')
          if (totalBytes > CONVERSATION_IMPORT_MAX_TOTAL_BYTES) throw new ConversationImportError('IMPORT_TOO_LARGE', 'The document and its attachments are too large to import.')
          imageCount += 1
          if (imageCount > 100) throw new ConversationImportError('IMPORT_TOO_LARGE', 'The document contains too many images.')
          attachments.push(image)
        } else {
          text += `\n\n${locale === 'zh-CN' ? '[未导入图片：' : '[Image not imported: '}${attachment.name}]`
        }
      }
      if (text.trim()) content.push({ type: 'text', text })
      content.push(...attachments)
      if (content.length) messages.push({ role: record.role, content })
    }
  } else {
    if (markdown.startsWith('<!-- pipilot-conversation:') || /^##\s+(?:User|Assistant|用户|助手)\s*$/mu.test(markdown)) warnings.add('unrecognizedFormat')
    if (/!\[[^\]]*\]\([^)]*\)/u.test(documentMarkdown)) warnings.add('unsupportedImages')
    // An ordinary document is context for the *next* user instruction. This
    // creates only a stored message; it is never submitted to an agent.
    messages.push({ role: 'user', content: [{ type: 'text', text: documentMarkdown }] })
  }
  if (!messages.length) throw new ConversationImportError('IMPORT_INVALID_FILE', 'This Markdown document has no importable content.')
  const title = decoded?.manifest.title ?? titleFor(documentMarkdown, file)
  const fullPreview = decoded?.body ?? documentMarkdown
  if (fullPreview.length > CONVERSATION_IMPORT_MAX_PREVIEW_CHARACTERS) warnings.add('previewTruncated')
  const history = importedConversationHistorySchema.parse({ title, messages })
  // The Host's queue defaults to 8 MiB. Validate the actual JSON/UTF-8 DTO
  // estimate now, with framing/headroom, before creating any session file.
  if (!inspectPiHostDto(history, { maxBytes: 6 * 1024 * 1024 }).ok) throw new ConversationImportError('IMPORT_TOO_LARGE', 'The conversation content is too large to transfer to Pi in one import.')
  return {
    history,
    title, fileName: basename(file), format: decoded ? 'pipilot' as const : 'document' as const,
    messageCount: messages.length, imageCount, warnings: [...warnings], previewMarkdown: fullPreview.slice(0, CONVERSATION_IMPORT_MAX_PREVIEW_CHARACTERS),
  }
}

interface ConversationImportServiceOptions {
  chooseDocument(locale: ConversationImportPreviewRequest['locale']): Promise<string | null>
  activate(scope: ConversationScope, history: ImportedConversationHistory): Promise<ConversationActivationResult>
  now?(): number
}

export class ConversationImportService {
  private previews = new Map<string, { history: ImportedConversationHistory; expiresAt: number; committing: boolean }>()
  private now: () => number
  constructor(private readonly options: ConversationImportServiceOptions) { this.now = options.now ?? Date.now }
  async preview(raw: ConversationImportPreviewRequest): Promise<ConversationImportPreviewResult> {
    const input = conversationImportPreviewRequestSchema.parse(raw)
    const path = await this.options.chooseDocument(input.locale)
    if (path === null) return { status: 'cancelled' }
    const parsed = await parseConversationImport(path, input.locale)
    this.prune()
    while (this.previews.size >= MAX_PREVIEWS) {
      const oldest = [...this.previews].find(([, value]) => !value.committing)
      if (!oldest) throw new ConversationImportError('IMPORT_BUSY', 'Other documents are currently being imported.')
      this.previews.delete(oldest[0])
    }
    const token = `imp_${randomBytes(24).toString('base64url')}`
    this.previews.set(token, { history: { ...parsed.history, importId: randomUUID() }, expiresAt: this.now() + PREVIEW_TTL_MS, committing: false })
    const { history: _history, ...preview } = parsed
    return { status: 'ready', token, ...preview }
  }
  async commit(raw: ConversationImportCommitRequest) {
    const input = conversationImportCommitRequestSchema.parse(raw)
    this.prune()
    const preview = this.previews.get(input.token)
    if (!preview) throw new ConversationImportError('IMPORT_EXPIRED', 'This import preview has expired. Select the document again.')
    if (preview.committing) throw new ConversationImportError('IMPORT_BUSY', 'This document is already being imported.')
    preview.committing = true
    try {
      const result = await this.options.activate(input.scope, { ...preview.history, title: input.title.replace(/[\r\n]+/gu, ' ') })
      this.previews.delete(input.token)
      return result
    } finally { preview.committing = false }
  }
  discard(token: string) {
    if (!this.previews.get(token)?.committing) this.previews.delete(token)
    return { discarded: true as const }
  }
  private prune() {
    for (const [key, value] of this.previews) if (!value.committing && value.expiresAt <= this.now()) this.previews.delete(key)
  }
}
