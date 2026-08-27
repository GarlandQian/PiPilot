import type { LocalPiCommandArgumentCompletion } from '@/shared/local-pi'

const SLASH_ARGUMENT_QUERY_PATTERN = /^\/([^\s/]+) ([^\r\n]*)$/u

export interface ComposerSlashArgumentQuery {
  argumentPrefix: string
  argumentStart: number
  commandName: string
  documentRevision: number
  textBeforeCursor: string
}

export interface ComposerCommandArgumentRequestIdentity
  extends ComposerSlashArgumentQuery {
  scopeKey: string
}

export interface ComposerCommandArgumentCandidate
  extends LocalPiCommandArgumentCompletion {
  id: string
}

function commandArgumentCandidateId(value: string, index: number) {
  let hash = 2_166_136_261
  for (let offset = 0; offset < value.length; offset += 1) {
    hash ^= value.charCodeAt(offset)
    hash = Math.imul(hash, 16_777_619)
  }
  return `argument:${(hash >>> 0).toString(36)}:${index}`
}

export function composerSlashArgumentQuery(
  textBeforeCursor: string | null,
  documentRevision: number,
): ComposerSlashArgumentQuery | null {
  if (textBeforeCursor === null) return null
  const match = SLASH_ARGUMENT_QUERY_PATTERN.exec(textBeforeCursor)
  if (!match) return null
  const commandName = match[1]
  const argumentPrefix = match[2]
  if (commandName === undefined || argumentPrefix === undefined) return null
  return {
    argumentPrefix,
    argumentStart: textBeforeCursor.length - argumentPrefix.length,
    commandName,
    documentRevision,
    textBeforeCursor,
  }
}

export function createComposerCommandArgumentRequest(
  scopeKey: string,
  query: ComposerSlashArgumentQuery,
): ComposerCommandArgumentRequestIdentity {
  return { ...query, scopeKey }
}

export function composerCommandArgumentRequestMatches(
  scopeKey: string,
  query: ComposerSlashArgumentQuery | null,
  request: ComposerCommandArgumentRequestIdentity,
): boolean {
  return query !== null &&
    scopeKey === request.scopeKey &&
    query.argumentPrefix === request.argumentPrefix &&
    query.argumentStart === request.argumentStart &&
    query.commandName === request.commandName &&
    query.documentRevision === request.documentRevision &&
    query.textBeforeCursor === request.textBeforeCursor
}

export function projectComposerCommandArgumentCandidates(
  items: readonly LocalPiCommandArgumentCompletion[],
): ComposerCommandArgumentCandidate[] {
  const candidates: ComposerCommandArgumentCandidate[] = []
  const seenValues = new Set<string>()
  for (const item of items) {
    if (seenValues.has(item.value)) continue
    seenValues.add(item.value)
    candidates.push({
      ...item,
      id: commandArgumentCandidateId(item.value, candidates.length),
    })
  }
  return candidates
}

export function applyComposerSlashArgumentCompletion(
  text: string,
  query: ComposerSlashArgumentQuery,
  value: string,
): string | null {
  if (text.slice(0, query.textBeforeCursor.length) !== query.textBeforeCursor) {
    return null
  }
  return `${text.slice(0, query.argumentStart)}${value}${text.slice(query.textBeforeCursor.length)}`
}
