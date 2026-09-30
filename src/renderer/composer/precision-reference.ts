export const PRECISION_REFERENCE_NODE = 'precisionReference'
export const MAX_REFERENCE_TEXT = 20_000
export const MAX_REVIEW_COMMENT = 4_000

/** Captured content is immutable; a file path alone is not the quoted evidence. */
export interface PrecisionReference {
  id: string
  ownerKey: string
  kind: 'message' | 'file' | 'command' | 'diff'
  sourceId: string
  label: string
  text: string
  path?: string
  startLine?: number
  endLine?: number
  side?: 'additions' | 'deletions'
  stage?: 'staged' | 'unstaged'
  revision?: string
  comment?: string
  stale?: boolean
}

export function isPrecisionReference(value: unknown): value is PrecisionReference {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  const allowed = ['id', 'ownerKey', 'kind', 'sourceId', 'label', 'text', 'path', 'startLine', 'endLine', 'side', 'stage', 'revision', 'comment', 'stale']
  if (Object.keys(item).some((key) => !allowed.includes(key))) return false
  for (const key of ['id', 'ownerKey', 'sourceId', 'label']) {
    if (typeof item[key] !== 'string' || !item[key] || (item[key] as string).length > 2_048) return false
  }
  if (!['message', 'file', 'command', 'diff'].includes(String(item.kind)) ||
    typeof item.text !== 'string' || !item.text.trim() || item.text.length > MAX_REFERENCE_TEXT) return false
  if (item.path !== undefined && (typeof item.path !== 'string' || item.path.length > 2_048)) return false
  if (item.revision !== undefined && (typeof item.revision !== 'string' || item.revision.length > 256)) return false
  if (item.comment !== undefined && (typeof item.comment !== 'string' || item.comment.length > MAX_REVIEW_COMMENT)) return false
  if (item.stale !== undefined && typeof item.stale !== 'boolean') return false
  if (item.side !== undefined && item.side !== 'additions' && item.side !== 'deletions') return false
  if (item.stage !== undefined && item.stage !== 'staged' && item.stage !== 'unstaged') return false
  if (item.startLine !== undefined || item.endLine !== undefined) {
    if (!Number.isSafeInteger(item.startLine) || !Number.isSafeInteger(item.endLine) ||
      (item.startLine as number) < 1 || (item.endLine as number) < (item.startLine as number)) return false
  }
  if (item.kind === 'diff' && (!item.path || !item.revision || !item.side || !item.stage || item.startLine === undefined || item.endLine === undefined)) return false
  return true
}

export function precisionReferenceLabel(reference: PrecisionReference) {
  const lines = reference.startLine === undefined ? '' : `:${reference.startLine}${reference.endLine === reference.startLine ? '' : `–${reference.endLine}`}`
  return `${reference.label}${lines}`
}

export function serializePrecisionReference(reference: PrecisionReference) {
  const clean = (value: string) => value.replace(/[\r\n]/gu, ' ')
  const location = [reference.path ?? reference.sourceId,
    reference.startLine === undefined ? '' : `lines ${reference.startLine}-${reference.endLine}`,
    reference.side === 'deletions' ? 'old side' : reference.side === 'additions' ? 'new side' : '',
    reference.stage ?? '', reference.revision ? `snapshot ${reference.revision}` : ''].filter(Boolean).join(' · ')
  const fence = '`'.repeat(Math.max(3, ...[...reference.text.matchAll(/`+/gu)].map((match) => match[0].length + 1)))
  return `\n\n${reference.kind === 'diff' ? 'Review of project changes' : 'Quoted reference'}: ${clean(reference.label)}\nSource: ${clean(location)}\n${reference.stale ? 'Warning: this snapshot is outdated; re-check the current file before applying the comment.\n' : ''}${fence}text\n${reference.text}\n${fence}${reference.comment ? `\nComment: ${reference.comment}` : ''}\n\n`
}

/** Exact source offsets, only for a literal source view. Rendered Markdown has no line claim. */
export function referenceLineRange(source: string, start: number, end: number) {
  if (start < 0 || end <= start || end > source.length) return undefined
  return { startLine: source.slice(0, start).split('\n').length,
    endLine: source.slice(0, end - (source[end - 1] === '\n' ? 1 : 0)).split('\n').length }
}
