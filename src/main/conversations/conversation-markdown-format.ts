import { createHash } from 'node:crypto'
import { z } from 'zod'

const offset = z.number().int().min(0).max(128 * 1024 * 1024)
const digest = z.string().regex(/^[a-f0-9]{64}$/u)
export const conversationMarkdownManifestSchema = z.object({
  version: z.literal(1), title: z.string().min(1).max(256), sha256: digest,
  assetDirectory: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  records: z.array(z.object({
    role: z.enum(['user', 'assistant', 'context']), start: offset, end: offset, sha256: digest,
    images: z.array(z.object({
      name: z.string().regex(/^image-[1-9][0-9]*\.(?:png|jpg|gif|webp|avif)$/u),
      mimeType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']), marker: z.string().max(512),
    }).strict()).max(100),
  }).strict()).max(100_000),
}).strict()
export type ConversationMarkdownManifest = z.infer<typeof conversationMarkdownManifestSchema>
export const CONVERSATION_MARKDOWN_PREFIX = '<!-- pipilot-conversation:v1 '
export function markdownDigest(content: string | Buffer) { return createHash('sha256').update(content).digest('hex') }

/** Byte ranges, not role-heading scans, define history. Content cannot inject a
 * new role by containing a heading or a nested marker. Edits invalidate the
 * manifest and are imported as an ordinary document instead. */
export function encodeConversationMarkdown(body: string, manifest: Omit<ConversationMarkdownManifest, 'version' | 'sha256'>) {
  const header = conversationMarkdownManifestSchema.parse({ ...manifest, version: 1, sha256: markdownDigest(body) })
  return `${CONVERSATION_MARKDOWN_PREFIX}${Buffer.from(JSON.stringify(header)).toString('base64url')} -->\n${body}`
}

export function decodeConversationMarkdown(markdown: string) {
  if (!markdown.startsWith(CONVERSATION_MARKDOWN_PREFIX)) return null
  const end = markdown.indexOf(' -->\n', CONVERSATION_MARKDOWN_PREFIX.length)
  if (end < 0 || end > 4 * 1024 * 1024) return null
  const encoded = markdown.slice(CONVERSATION_MARKDOWN_PREFIX.length, end)
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded)) return null
  try {
    const manifest = conversationMarkdownManifestSchema.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown)
    const body = markdown.slice(end + ' -->\n'.length)
    if (markdownDigest(body) !== manifest.sha256 || !manifest.records.length) return null
    const bytes = Buffer.from(body)
    let previousEnd = 0
    const decoder = new TextDecoder('utf8', { fatal: true })
    const records = manifest.records.map((record) => {
      if (record.start < previousEnd || record.start > record.end || record.end > bytes.length) throw new Error('Invalid record range')
      previousEnd = record.end
      const content = bytes.subarray(record.start, record.end)
      if (markdownDigest(content) !== record.sha256) throw new Error('Invalid record digest')
      const text = decoder.decode(content)
      for (const image of record.images) {
        if (!image.marker || !text.includes(image.marker) || image.marker !== `![${/!\[([^\]]*)\]/u.exec(image.marker)?.[1] ?? ''}](${encodeURIComponent(manifest.assetDirectory)}/${image.name})`) throw new Error('Invalid image marker')
      }
      return { ...record, text }
    })
    return { manifest, body, records }
  } catch { return null }
}
