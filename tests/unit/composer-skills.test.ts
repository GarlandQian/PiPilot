import { describe, expect, it } from 'vitest'
import {
  composerSlashQuery,
  filterComposerCandidates,
  projectComposerCommands,
} from '../../src/renderer/composer/skill-commands'
import type { LocalPiSlashCommand } from '../../src/shared/local-pi'

function command(
  name: string,
  source: LocalPiSlashCommand['source'],
  options: {
    description?: string
    hasArgumentCompletions?: boolean
    scope?: LocalPiSlashCommand['sourceInfo']['scope']
    origin?: LocalPiSlashCommand['sourceInfo']['origin']
    path?: string
  } = {},
): LocalPiSlashCommand {
  return {
    name,
    source,
    description: options.description,
    hasArgumentCompletions: options.hasArgumentCompletions,
    sourceInfo: {
      path: options.path ?? `/private/${name}`,
      source: name,
      scope: options.scope ?? 'project',
      origin: options.origin ?? 'top-level',
    },
  }
}

describe('composer command projection', () => {
  it('keeps Pi order, filters invalid skills, and deduplicates exact names first-wins', () => {
    const projection = projectComposerCommands([
      command('skills', 'prompt', { description: 'Official skills command' }),
      command('review', 'prompt', { description: 'First review command' }),
      command('skill:release', 'skill', { description: 'First release skill' }),
      command('review', 'extension', { description: 'Duplicate review command' }),
      command('skill:release', 'skill', { description: 'Duplicate release skill' }),
      command('skill:', 'skill'),
      command('skill:bad name', 'skill'),
      command('skill:bad:name', 'skill'),
      command('extension-tool', 'extension'),
    ])

    expect(projection.topLevel.map((candidate) => candidate.name)).toEqual([
      'skills',
      'review',
      'extension-tool',
    ])
    expect(projection.skills.map((candidate) => candidate.name)).toEqual(['skill:release'])
    expect(projection.skills[0]?.description).toBe('First release skill')
  })

  it('searches official presentation metadata without exposing source paths', () => {
    const projection = projectComposerCommands([
      command('deploy', 'prompt', { description: 'Publish a release' }),
      command('skill:audit', 'skill', {
        description: 'Inspect dependencies',
        scope: 'user',
        origin: 'package',
        path: '/secret/skill-location/SKILL.md',
      }),
    ])

    expect(filterComposerCandidates(projection.topLevel, 'publish').map((item) => item.name))
      .toEqual(['deploy'])
    expect(filterComposerCandidates(projection.skills, 'GLOBAL').map((item) => item.name))
      .toEqual(['skill:audit'])
    expect(filterComposerCandidates(projection.skills, 'package').map((item) => item.name))
      .toEqual(['skill:audit'])
    expect(filterComposerCandidates(projection.skills, 'secret/skill-location')).toEqual([])
  })

  it('filters Commands and Skills directly with the same slash query', () => {
    const { topLevel, skills } = projectComposerCommands([
      command('review', 'prompt'),
      command('skill:security', 'skill'),
    ])

    expect(filterComposerCandidates(topLevel, 'rev').map((candidate) => candidate.name))
      .toEqual(['review'])
    expect(filterComposerCandidates(skills, 'sec').map((candidate) => candidate.name))
      .toEqual(['skill:security'])
    expect(filterComposerCandidates(topLevel, 'sec')).toEqual([])
    expect(filterComposerCandidates(topLevel, 'missing')).toEqual([])
    expect(filterComposerCandidates(skills, 'missing')).toEqual([])
  })

  it('preserves the official argument completion capability on command candidates', () => {
    const projection = projectComposerCommands([
      command('goal', 'extension', { hasArgumentCompletions: true }),
      command('plain', 'extension'),
    ])

    expect(projection.topLevel.map(({ name, hasArgumentCompletions }) => ({
      name,
      hasArgumentCompletions,
    }))).toEqual([
      { name: 'goal', hasArgumentCompletions: true },
      { name: 'plain', hasArgumentCompletions: false },
    ])
  })

  it('uses unambiguous candidate IDs for source-defined command names', () => {
    const projection = projectComposerCommands([
      command('review:deep', 'extension'),
      command('review', 'extension'),
      command('skill:release/notes', 'skill'),
    ])

    const ids = [...projection.topLevel, ...projection.skills].map(({ id }) => id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('command:review%3Adeep')
    expect(ids).toContain('skill:skill%3Arelease%2Fnotes')
  })
})

describe('composer slash query', () => {
  it('only recognizes a leading slash token without whitespace', () => {
    expect(composerSlashQuery('/')).toBe('')
    expect(composerSlashQuery('/skills')).toBe('skills')
    expect(composerSlashQuery(' /skills')).toBeNull()
    expect(composerSlashQuery('/skill:audit arguments')).toBeNull()
    expect(composerSlashQuery('/skill:audit\narguments')).toBeNull()
  })
})
