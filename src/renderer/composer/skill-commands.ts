import type { LocalPiSlashCommand } from '@/shared/local-pi'

const SKILL_COMMAND_PATTERN = /^skill:[^\s:]+$/u

export function isComposerSkillCommandName(
  name: string,
): name is `skill:${string}` {
  return SKILL_COMMAND_PATTERN.test(name)
}

export interface ComposerExecutableCandidate {
  id: string
  kind: 'command' | 'skill'
  name: string
  displayName: string
  description: string
  hasArgumentCompletions: boolean
  scope: LocalPiSlashCommand['sourceInfo']['scope']
  origin: LocalPiSlashCommand['sourceInfo']['origin']
  searchText: string
}

export type ComposerSlashCandidate = ComposerExecutableCandidate

export interface ComposerCommandProjection {
  topLevel: readonly ComposerSlashCandidate[]
  skills: readonly ComposerExecutableCandidate[]
}

function searchableScope(scope: ComposerExecutableCandidate['scope']) {
  return scope === 'user' ? 'user global' : scope
}

function searchableOrigin(origin: ComposerExecutableCandidate['origin']) {
  return origin === 'top-level' ? 'top-level top level' : origin
}

function executableCandidate(
  command: LocalPiSlashCommand,
  kind: ComposerExecutableCandidate['kind'],
): ComposerExecutableCandidate {
  const displayName = kind === 'skill'
    ? command.name.slice('skill:'.length)
    : command.name
  const description = command.description ?? ''
  return {
    // Exact command names are first-wins, so the encoded name is the stable
    // identity. Encoding keeps ':' and other source-defined characters from
    // producing ambiguous DOM/listbox IDs.
    id: `${kind}:${encodeURIComponent(command.name)}`,
    kind,
    name: command.name,
    displayName,
    description,
    hasArgumentCompletions: command.hasArgumentCompletions === true,
    scope: command.sourceInfo.scope,
    origin: command.sourceInfo.origin,
    searchText: [
      command.name,
      displayName,
      description,
      searchableScope(command.sourceInfo.scope),
      searchableOrigin(command.sourceInfo.origin),
    ].join(' ').toLowerCase(),
  }
}

export function projectComposerCommands(
  commands: readonly LocalPiSlashCommand[],
): ComposerCommandProjection {
  const topLevel: ComposerSlashCandidate[] = []
  const skills: ComposerExecutableCandidate[] = []
  const seenNames = new Set<string>()

  for (const command of commands) {
    if (seenNames.has(command.name)) continue
    seenNames.add(command.name)

    if (command.source === 'skill') {
      if (isComposerSkillCommandName(command.name)) {
        skills.push(executableCandidate(command, 'skill'))
      }
      continue
    }

    topLevel.push(executableCandidate(command, 'command'))
  }

  return { topLevel, skills }
}

export function filterComposerCandidates<T extends ComposerSlashCandidate>(
  candidates: readonly T[],
  query: string,
): T[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return [...candidates]
  return candidates.filter((candidate) => candidate.searchText.includes(normalizedQuery))
}

export function composerCandidateValue(candidate: ComposerSlashCandidate): string {
  return `${candidate.kind}:${candidate.name}`
}

export function composerSlashQuery(text: string): string | null {
  if (!text.startsWith('/') || /\s/u.test(text)) return null
  return text.slice(1)
}
