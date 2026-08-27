import type { JSONContent } from '@tiptap/core'
import {
  isComposerSkillCommandName,
  type ComposerExecutableCandidate,
} from '@/renderer/composer/skill-commands'
import {
  workspaceRelativePathSchema,
  type WorkspacePathSearchEntry,
} from '@/shared/workspace-content'

export const COMPOSER_MENTION_NODE_TYPE = 'composerMention' as const

export type ComposerMentionAttrs =
  | {
    kind: 'file' | 'directory'
    path: string
    label: string
  }
  | {
    kind: 'skill'
    commandName: `skill:${string}`
    label: string
  }

export interface ComposerPathMentionCandidate {
  id: string
  kind: 'file' | 'directory'
  path: string
  label: string
  searchText: string
}

export interface ComposerSkillMentionCandidate {
  id: string
  kind: 'skill'
  commandName: `skill:${string}`
  label: string
  description: string
  scope: ComposerExecutableCandidate['scope']
  origin: ComposerExecutableCandidate['origin']
  searchText: string
}

export type ComposerMentionCandidate =
  | ComposerPathMentionCandidate
  | ComposerSkillMentionCandidate

export interface ComposerMentionCandidateGroups {
  files: readonly ComposerPathMentionCandidate[]
  skills: readonly ComposerSkillMentionCandidate[]
}

export interface ComposerDocumentSnapshot {
  revision: number
  document: JSONContent
}

export interface ComposerMentionSuggestionIdentity {
  documentRevision: number
  from: number
  query: string
  to: number
}

export interface ComposerMentionRequestIdentity extends ComposerMentionSuggestionIdentity {
  scopeKey: string
}

interface ComposerDocumentAnalysis {
  body: string
  hasContent: boolean
  mentionCount: number
  skill: Extract<ComposerMentionAttrs, { kind: 'skill' }> | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(record).every((key) => allowed.includes(key))
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(record)
  return keys.length === expected.length && keys.every((key) => expected.includes(key))
}

function composerPathCandidate(
  entry: WorkspacePathSearchEntry,
): ComposerPathMentionCandidate | null {
  const parsedPath = workspaceRelativePathSchema.safeParse(entry.path)
  if (!parsedPath.success) return null

  const kind = entry.type === 'dir' ? 'directory' : 'file'
  return {
    id: `path:${parsedPath.data}`,
    kind,
    path: parsedPath.data,
    label: parsedPath.data,
    searchText: [
      parsedPath.data,
      entry.name,
      kind,
      kind === 'directory' ? 'dir folder' : '',
    ].join(' ').toLowerCase(),
  }
}

function composerSkillCandidate(
  candidate: ComposerExecutableCandidate,
): ComposerSkillMentionCandidate | null {
  if (candidate.kind !== 'skill' || !isComposerSkillCommandName(candidate.name)) {
    return null
  }

  return {
    id: candidate.id,
    kind: 'skill',
    commandName: candidate.name,
    label: candidate.name.slice('skill:'.length),
    description: candidate.description,
    scope: candidate.scope,
    origin: candidate.origin,
    searchText: candidate.searchText,
  }
}

export function projectComposerMentionCandidates(
  paths: readonly WorkspacePathSearchEntry[],
  skills: readonly ComposerExecutableCandidate[],
): ComposerMentionCandidateGroups {
  const files: ComposerPathMentionCandidate[] = []
  const projectedSkills: ComposerSkillMentionCandidate[] = []
  const seenPaths = new Set<string>()

  for (const entry of paths) {
    const candidate = composerPathCandidate(entry)
    if (!candidate || seenPaths.has(candidate.path)) continue
    seenPaths.add(candidate.path)
    files.push(candidate)
  }
  for (const skill of skills) {
    const candidate = composerSkillCandidate(skill)
    if (candidate) projectedSkills.push(candidate)
  }

  return { files, skills: projectedSkills }
}

export function filterComposerMentionCandidates(
  groups: ComposerMentionCandidateGroups,
  query: string,
): ComposerMentionCandidateGroups {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return { files: [...groups.files], skills: [...groups.skills] }
  }

  return {
    files: groups.files.filter((candidate) =>
      candidate.searchText.includes(normalizedQuery)),
    skills: groups.skills.filter((candidate) =>
      candidate.searchText.includes(normalizedQuery)),
  }
}

export function composerMentionAttrs(
  candidate: ComposerMentionCandidate,
): ComposerMentionAttrs {
  if (candidate.kind === 'skill') {
    return {
      kind: 'skill',
      commandName: candidate.commandName,
      label: candidate.label,
    }
  }

  return {
    kind: candidate.kind,
    path: candidate.path,
    label: candidate.label,
  }
}

export function isComposerMentionAttrs(value: unknown): value is ComposerMentionAttrs {
  if (!isRecord(value) || typeof value.kind !== 'string') return false

  if (value.kind === 'file' || value.kind === 'directory') {
    const hasMinimalShape = hasExactKeys(value, ['kind', 'path', 'label'])
    const hasEditorShape = hasExactKeys(value, ['kind', 'path', 'label', 'commandName']) &&
      value.commandName === null
    if (!hasMinimalShape && !hasEditorShape) return false
    if (typeof value.path !== 'string' || typeof value.label !== 'string') return false
    return (
      workspaceRelativePathSchema.safeParse(value.path).success &&
      value.label === value.path
    )
  }

  if (value.kind === 'skill') {
    const hasMinimalShape = hasExactKeys(value, ['kind', 'commandName', 'label'])
    const hasEditorShape = hasExactKeys(value, ['kind', 'commandName', 'label', 'path']) &&
      value.path === null
    if (!hasMinimalShape && !hasEditorShape) return false
    if (
      typeof value.commandName !== 'string' ||
      typeof value.label !== 'string' ||
      !isComposerSkillCommandName(value.commandName)
    ) {
      return false
    }
    return value.label === value.commandName.slice('skill:'.length)
  }

  return false
}

export function shouldReplaceComposerMention(
  existing: ComposerMentionAttrs,
  incoming: ComposerMentionAttrs,
) {
  if (!isComposerMentionAttrs(existing) || !isComposerMentionAttrs(incoming)) {
    return false
  }
  if (incoming.kind === 'skill') return existing.kind === 'skill'
  if (existing.kind === 'skill') return false
  return existing.path === incoming.path
}

export function plainTextToComposerDocument(text: string): JSONContent {
  return {
    type: 'doc',
    content: text.split('\n').map((line) => ({
      type: 'paragraph',
      ...(line ? { content: [{ type: 'text', text: line }] } : {}),
    })),
  }
}

function snapshotDocument(
  snapshotOrDocument: ComposerDocumentSnapshot | JSONContent,
): unknown {
  const value: unknown = snapshotOrDocument
  if (!isRecord(value)) return null

  if ('document' in value || 'revision' in value) {
    const revision = value.revision
    if (
      !hasExactKeys(value, ['revision', 'document']) ||
      typeof revision !== 'number' ||
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      !isRecord(value.document)
    ) {
      return null
    }
    return value.document
  }

  return value
}

function escapeMarkdownLabel(value: string) {
  return value.replace(/[\\[\]]/gu, '\\$&')
}

function percentEncodeMarkdownDestination(value: string): string | null {
  try {
    return value
      .split('/')
      .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/gu, (character) =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`))
      .join('/')
  } catch {
    return null
  }
}

function serializePathMention(
  attrs: Extract<ComposerMentionAttrs, { kind: 'file' | 'directory' }>,
): string | null {
  const suffix = attrs.kind === 'directory' ? '/' : ''
  const label = escapeMarkdownLabel(`${attrs.path}${suffix}`)
  const destination = percentEncodeMarkdownDestination(`${attrs.path}${suffix}`)
  return destination === null ? null : `[@${label}](${destination})`
}

function analyzeComposerDocument(document: unknown): ComposerDocumentAnalysis | null {
  if (
    !isRecord(document) ||
    document.type !== 'doc' ||
    !hasOnlyKeys(document, ['type', 'content']) ||
    (document.content !== undefined && !Array.isArray(document.content))
  ) {
    return null
  }

  const bodyParts: string[] = []
  const seenPathMentions = new Set<string>()
  let skill: ComposerDocumentAnalysis['skill'] = null
  let mentionCount = 0
  let hasContent = false
  let removeFollowingSkillSeparator = false
  const paragraphs = document.content ?? []

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraph = paragraphs[paragraphIndex]
    if (
      !isRecord(paragraph) ||
      paragraph.type !== 'paragraph' ||
      !hasOnlyKeys(paragraph, ['type', 'content']) ||
      (paragraph.content !== undefined && !Array.isArray(paragraph.content))
    ) {
      return null
    }

    if (paragraphIndex > 0) {
      removeFollowingSkillSeparator = false
      bodyParts.push('\n')
    }

    const inlineNodes = paragraph.content ?? []
    for (const inlineNode of inlineNodes) {
      if (!isRecord(inlineNode) || typeof inlineNode.type !== 'string') return null

      if (inlineNode.type === 'text') {
        if (
          !hasOnlyKeys(inlineNode, ['type', 'text']) ||
          typeof inlineNode.text !== 'string' ||
          inlineNode.text.length === 0
        ) {
          return null
        }
        const text = removeFollowingSkillSeparator && inlineNode.text.startsWith(' ')
          ? inlineNode.text.slice(1)
          : inlineNode.text
        removeFollowingSkillSeparator = false
        if (text) bodyParts.push(text)
        if (text.trim()) hasContent = true
        continue
      }

      if (inlineNode.type === 'hardBreak') {
        if (!hasExactKeys(inlineNode, ['type'])) return null
        removeFollowingSkillSeparator = false
        bodyParts.push('\n')
        continue
      }

      if (inlineNode.type !== COMPOSER_MENTION_NODE_TYPE) return null
      if (
        !hasExactKeys(inlineNode, ['type', 'attrs']) ||
        !isComposerMentionAttrs(inlineNode.attrs)
      ) {
        return null
      }

      const attrs = inlineNode.attrs
      mentionCount += 1
      hasContent = true
      if (attrs.kind === 'skill') {
        if (skill) return null
        skill = attrs
        removeFollowingSkillSeparator = true
        continue
      }

      removeFollowingSkillSeparator = false
      const identity = attrs.path
      if (seenPathMentions.has(identity)) return null
      seenPathMentions.add(identity)
      const serialized = serializePathMention(attrs)
      if (serialized === null) return null
      bodyParts.push(serialized)
    }
  }

  return {
    body: bodyParts.join(''),
    hasContent,
    mentionCount,
    skill,
  }
}

export function serializeComposerDocument(
  snapshotOrDocument: ComposerDocumentSnapshot | JSONContent,
): string | null {
  const analysis = analyzeComposerDocument(snapshotDocument(snapshotOrDocument))
  if (!analysis) return null
  if (!analysis.skill) return analysis.body
  const prefix = `/${analysis.skill.commandName}`
  return analysis.body ? `${prefix} ${analysis.body}` : prefix
}

export function composerDocumentHasContent(document: JSONContent) {
  return analyzeComposerDocument(document)?.hasContent ?? false
}

export function composerDocumentHasMention(document: JSONContent) {
  const analysis = analyzeComposerDocument(document)
  return analysis !== null && analysis.mentionCount > 0
}

export function composerDocumentHasSkill(document: JSONContent) {
  const analysis = analyzeComposerDocument(document)
  return analysis !== null && analysis.skill !== null
}

export function composerLeadingSlashConflict(
  document: JSONContent,
  executableNames: readonly string[],
) {
  const analysis = analyzeComposerDocument(document)
  if (!analysis || !analysis.body.startsWith('/')) return false
  if (analysis.body.startsWith('/skill:')) return true

  const token = analysis.body.slice(1).split(/\s/u, 1)[0] ?? ''
  return executableNames.some((name) =>
    !name.startsWith('skill:') && name === token)
}

export function shouldClearCapturedComposer(
  capturedScope: string,
  currentScope: string,
  capturedRevision: number,
  currentRevision: number,
) {
  return capturedScope === currentScope && capturedRevision === currentRevision
}

export function composerMentionSuggestionMatches(
  current: ComposerMentionSuggestionIdentity | null,
  expected: ComposerMentionSuggestionIdentity,
) {
  return current?.documentRevision === expected.documentRevision &&
    current.from === expected.from &&
    current.query === expected.query &&
    current.to === expected.to
}

export function composerMentionRequestMatches(
  currentScopeKey: string,
  currentSuggestion: ComposerMentionSuggestionIdentity | null,
  expected: ComposerMentionRequestIdentity,
) {
  return currentScopeKey === expected.scopeKey &&
    composerMentionSuggestionMatches(currentSuggestion, expected)
}
