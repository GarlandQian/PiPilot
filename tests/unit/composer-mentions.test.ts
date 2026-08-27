import type { JSONContent } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import {
  COMPOSER_MENTION_NODE_TYPE,
  composerDocumentHasContent,
  composerDocumentHasMention,
  composerDocumentHasSkill,
  composerLeadingSlashConflict,
  composerMentionAttrs,
  composerMentionRequestMatches,
  composerMentionSuggestionMatches,
  filterComposerMentionCandidates,
  isComposerMentionAttrs,
  plainTextToComposerDocument,
  projectComposerMentionCandidates,
  serializeComposerDocument,
  shouldClearCapturedComposer,
  shouldReplaceComposerMention,
  type ComposerMentionAttrs,
} from '../../src/renderer/composer/composer-mentions'
import { projectComposerCommands } from '../../src/renderer/composer/skill-commands'
import type { LocalPiSlashCommand } from '../../src/shared/local-pi'

function text(value: string): JSONContent {
  return { type: 'text', text: value }
}

function hardBreak(): JSONContent {
  return { type: 'hardBreak' }
}

function mention(attrs: ComposerMentionAttrs): JSONContent {
  return { type: COMPOSER_MENTION_NODE_TYPE, attrs }
}

function paragraph(...content: JSONContent[]): JSONContent {
  return {
    type: 'paragraph',
    ...(content.length > 0 ? { content } : {}),
  }
}

function document(...content: JSONContent[]): JSONContent {
  return { type: 'doc', content }
}

const fileAttrs = (path: string): ComposerMentionAttrs => ({
  kind: 'file',
  path,
  label: path,
})

const directoryAttrs = (path: string): ComposerMentionAttrs => ({
  kind: 'directory',
  path,
  label: path,
})

const skillAttrs = (name = 'audit'): ComposerMentionAttrs => ({
  kind: 'skill',
  commandName: `skill:${name}`,
  label: name,
})

function command(
  name: string,
  source: LocalPiSlashCommand['source'],
  options: {
    description?: string
    scope?: LocalPiSlashCommand['sourceInfo']['scope']
    origin?: LocalPiSlashCommand['sourceInfo']['origin']
    path?: string
  } = {},
): LocalPiSlashCommand {
  return {
    name,
    source,
    description: options.description,
    sourceInfo: {
      path: options.path ?? `/private/${name}`,
      source: 'catalog',
      scope: options.scope ?? 'project',
      origin: options.origin ?? 'top-level',
    },
  }
}

describe('composer mention candidate projection', () => {
  it('projects grouped Files then Skills with stable source order and no Skill paths', () => {
    const official = projectComposerCommands([
      command('skill:audit', 'skill', {
        description: 'Inspect dependencies',
        scope: 'user',
        origin: 'package',
        path: '/private/skills/audit/SKILL.md',
      }),
      command('skill:release', 'skill', { description: 'Publish a release' }),
    ])
    const groups = projectComposerMentionCandidates([
      { name: 'main.ts', path: 'src/main.ts', type: 'file' },
      { name: 'release notes', path: 'docs/release notes', type: 'dir' },
    ], official.skills)

    expect(groups.files.map(({ id, kind, path, label }) => ({ id, kind, path, label })))
      .toEqual([
        {
          id: 'path:src/main.ts',
          kind: 'file',
          path: 'src/main.ts',
          label: 'src/main.ts',
        },
        {
          id: 'path:docs/release notes',
          kind: 'directory',
          path: 'docs/release notes',
          label: 'docs/release notes',
        },
      ])
    expect(groups.skills.map(({ commandName, label, description, scope, origin }) => ({
      commandName,
      label,
      description,
      scope,
      origin,
    }))).toEqual([
      {
        commandName: 'skill:audit',
        label: 'audit',
        description: 'Inspect dependencies',
        scope: 'user',
        origin: 'package',
      },
      {
        commandName: 'skill:release',
        label: 'release',
        description: 'Publish a release',
        scope: 'project',
        origin: 'top-level',
      },
    ])
    expect(JSON.stringify(groups.skills)).not.toContain('/private/skills')
    expect(groups.skills[0]).not.toHaveProperty('path')
  })

  it('filters each group without merging or reordering identities', () => {
    const official = projectComposerCommands([
      command('skill:audit', 'skill', {
        description: 'Inspect dependencies',
        scope: 'user',
      }),
    ])
    const groups = projectComposerMentionCandidates([
      { name: 'main.ts', path: 'src/main.ts', type: 'file' },
      { name: 'release notes', path: 'docs/release notes', type: 'dir' },
    ], official.skills)

    expect(filterComposerMentionCandidates(groups, ' release notes ').files
      .map((candidate) => candidate.path)).toEqual(['docs/release notes'])
    expect(filterComposerMentionCandidates(groups, 'GLOBAL').skills
      .map((candidate) => candidate.commandName)).toEqual(['skill:audit'])
    expect(filterComposerMentionCandidates(groups, '').files).toEqual(groups.files)
  })

  it('projects candidates to the strict trusted atom attrs only', () => {
    const groups = projectComposerMentionCandidates(
      [{ name: 'main.ts', path: 'src/main.ts', type: 'file' }],
      projectComposerCommands([command('skill:audit', 'skill')]).skills,
    )

    expect(composerMentionAttrs(groups.files[0]!)).toEqual(fileAttrs('src/main.ts'))
    expect(composerMentionAttrs(groups.skills[0]!)).toEqual(skillAttrs())
  })

  it('uses the canonical relative path as identity regardless of path metadata', () => {
    const projected = projectComposerMentionCandidates([
      { name: 'main.ts', path: 'src/main.ts', type: 'file' },
      { name: 'main.ts', path: 'src/main.ts', type: 'dir' },
    ], [])

    expect(projected.files).toHaveLength(1)
    expect(projected.files[0]).toMatchObject({
      id: 'path:src/main.ts',
      kind: 'file',
      path: 'src/main.ts',
    })
    expect(shouldReplaceComposerMention(
      fileAttrs('src/main.ts'),
      directoryAttrs('src/main.ts'),
    )).toBe(true)
    expect(shouldReplaceComposerMention(
      directoryAttrs('src/main.ts'),
      fileAttrs('src/main.ts'),
    )).toBe(true)
  })
})

describe('composer mention attrs', () => {
  it('accepts canonical path and official Skill identities', () => {
    expect(isComposerMentionAttrs(fileAttrs('src/main.ts'))).toBe(true)
    expect(isComposerMentionAttrs(directoryAttrs('.'))).toBe(true)
    expect(isComposerMentionAttrs(skillAttrs('release'))).toBe(true)
    expect(isComposerMentionAttrs({
      ...fileAttrs('src/main.ts'),
      commandName: null,
    })).toBe(true)
    expect(isComposerMentionAttrs({
      ...skillAttrs('release'),
      path: null,
    })).toBe(true)
  })

  it('rejects forged paths, labels, Skill names, and private Skill fields', () => {
    for (const path of [
      '/private/main.ts',
      'C:/private/main.ts',
      'src\\main.ts',
      'src/../main.ts',
      'src/./main.ts',
      'src/main.ts/',
      'src/\0main.ts',
    ]) {
      expect(isComposerMentionAttrs({ kind: 'file', path, label: path })).toBe(false)
    }
    expect(isComposerMentionAttrs({
      kind: 'file',
      path: 'src/main.ts',
      label: 'forged.ts',
    })).toBe(false)
    expect(isComposerMentionAttrs({
      kind: 'skill',
      commandName: 'skill:bad name',
      label: 'bad name',
    })).toBe(false)
    expect(isComposerMentionAttrs({
      kind: 'skill',
      commandName: 'skill:audit',
      label: 'audit',
      path: '/private/skills/audit/SKILL.md',
    })).toBe(false)
    expect(isComposerMentionAttrs({
      ...fileAttrs('src/main.ts'),
      commandName: 'skill:forged',
    })).toBe(false)
    expect(isComposerMentionAttrs({
      kind: 'skill',
      commandName: 'skill:audit',
      label: 'forged',
    })).toBe(false)
  })
})

describe('composer document serialization', () => {
  it('serializes simple file and directory mentions in place', () => {
    const value = document(paragraph(
      text('Review '),
      mention(fileAttrs('src/app.ts')),
      text(' and '),
      mention(directoryAttrs('docs')),
    ))

    expect(serializeComposerDocument(value))
      .toBe('Review [@src/app.ts](src/app.ts) and [@docs/](docs/)')
  })

  it('escapes Markdown labels and percent-encodes unsafe destinations', () => {
    const value = document(paragraph(
      mention(fileAttrs('docs/[draft] (v1)#%.md')),
      text(' '),
      mention(directoryAttrs('specs/(old) [copy]')),
    ))

    expect(serializeComposerDocument(value)).toBe(
      '[@docs/\\[draft\\] (v1)#%.md](docs/%5Bdraft%5D%20%28v1%29%23%25.md) ' +
      '[@specs/(old) \\[copy\\]/](specs/%28old%29%20%5Bcopy%5D/)',
    )
  })

  it('preserves paragraph boundaries, empty paragraphs, and hard breaks', () => {
    const value = document(
      paragraph(text('one'), hardBreak(), text('two')),
      paragraph(),
      paragraph(text('three')),
    )

    expect(serializeComposerDocument(value)).toBe('one\ntwo\n\nthree')
  })

  it('extracts one Skill from the start, middle, or end', () => {
    expect(serializeComposerDocument(document(paragraph(
      mention(skillAttrs()),
      text(' explain'),
    )))).toBe('/skill:audit explain')
    expect(serializeComposerDocument(document(paragraph(
      text('Please '),
      mention(skillAttrs()),
      text(' review'),
    )))).toBe('/skill:audit Please review')
    expect(serializeComposerDocument(document(paragraph(
      text('Explain '),
      mention(skillAttrs()),
    )))).toBe('/skill:audit Explain ')
    expect(serializeComposerDocument(document(paragraph(
      mention(skillAttrs()),
    )))).toBe('/skill:audit')
  })

  it('removes at most one immediate ASCII space after a Skill', () => {
    expect(serializeComposerDocument(document(paragraph(
      mention(skillAttrs()),
      text('  keep'),
    )))).toBe('/skill:audit  keep')
    expect(serializeComposerDocument(document(paragraph(
      mention(skillAttrs()),
      text('\u00A0keep'),
    )))).toBe('/skill:audit \u00A0keep')
    expect(serializeComposerDocument(document(paragraph(
      mention(skillAttrs()),
      hardBreak(),
      text('keep'),
    )))).toBe('/skill:audit \nkeep')
    expect(serializeComposerDocument(document(
      paragraph(mention(skillAttrs())),
      paragraph(text(' keep')),
    ))).toBe('/skill:audit \n keep')
  })

  it('accepts a revisioned snapshot and distinguishes a valid empty document', () => {
    const empty = document(paragraph())
    expect(serializeComposerDocument(empty)).toBe('')
    expect(serializeComposerDocument({ revision: 4, document: empty })).toBe('')
    expect(serializeComposerDocument({ revision: -1, document: empty })).toBeNull()
  })

  it('rejects unknown, rich, malformed, and duplicate mention structures', () => {
    expect(serializeComposerDocument(document({ type: 'heading' }))).toBeNull()
    expect(serializeComposerDocument(document(paragraph({
      type: 'text',
      text: 'bold',
      marks: [{ type: 'bold' }],
    })))).toBeNull()
    expect(serializeComposerDocument(document(paragraph({
      type: COMPOSER_MENTION_NODE_TYPE,
      attrs: { kind: 'file', path: '/private/main.ts', label: '/private/main.ts' },
    })))).toBeNull()
    expect(serializeComposerDocument(document(paragraph(
      mention(fileAttrs('src/main.ts')),
      mention(fileAttrs('src/main.ts')),
    )))).toBeNull()
    expect(serializeComposerDocument(document(paragraph(
      mention(fileAttrs('src/main.ts')),
      mention(directoryAttrs('src/main.ts')),
    )))).toBeNull()
    expect(serializeComposerDocument(document(paragraph(
      mention(skillAttrs('audit')),
      mention(skillAttrs('release')),
    )))).toBeNull()
  })
})

describe('composer mention document helpers', () => {
  it('round-trips plain text including empty and trailing lines', () => {
    const value = plainTextToComposerDocument('first\n\nlast\n')
    expect(value).toEqual(document(
      paragraph(text('first')),
      paragraph(),
      paragraph(text('last')),
      paragraph(),
    ))
    expect(serializeComposerDocument(value)).toBe('first\n\nlast\n')
    expect(serializeComposerDocument(plainTextToComposerDocument(''))).toBe('')
  })

  it('detects meaningful text and valid atomic mentions', () => {
    expect(composerDocumentHasContent(document(paragraph()))).toBe(false)
    expect(composerDocumentHasContent(document(paragraph(text('  '))))).toBe(false)
    expect(composerDocumentHasContent(document(paragraph(hardBreak())))).toBe(false)
    expect(composerDocumentHasContent(document(paragraph(text('hello'))))).toBe(true)
    expect(composerDocumentHasContent(document(paragraph(mention(fileAttrs('README.md'))))))
      .toBe(true)
    expect(composerDocumentHasMention(document(paragraph(mention(skillAttrs()))))).toBe(true)
    expect(composerDocumentHasSkill(document(paragraph(mention(skillAttrs()))))).toBe(true)
    expect(composerDocumentHasSkill(document({ type: 'heading' }))).toBe(false)
  })

  it('detects official commands and manual raw Skills before or after Skill insertion', () => {
    const withBody = (body: string) => document(paragraph(
      mention(skillAttrs()),
      text(` ${body}`),
    ))

    expect(composerLeadingSlashConflict(withBody('/review now'), ['review', 'deploy']))
      .toBe(true)
    expect(composerLeadingSlashConflict(withBody('/skill:not-catalogued args'), []))
      .toBe(true)
    expect(composerLeadingSlashConflict(withBody('/reviewing now'), ['review']))
      .toBe(false)
    expect(composerLeadingSlashConflict(withBody(' /review now'), ['review']))
      .toBe(false)
    expect(composerLeadingSlashConflict(
      document(paragraph(text('/review now'))),
      ['review'],
    )).toBe(true)
    expect(composerLeadingSlashConflict(
      document(paragraph(text('/skill:not-catalogued args'))),
      [],
    )).toBe(true)
    expect(composerLeadingSlashConflict(
      document(paragraph(text(' /review now'))),
      ['review'],
    )).toBe(false)
  })

  it('deduplicates exact paths and replaces the singular Skill identity', () => {
    expect(shouldReplaceComposerMention(
      fileAttrs('src/main.ts'),
      fileAttrs('src/main.ts'),
    )).toBe(true)
    expect(shouldReplaceComposerMention(
      fileAttrs('src/main.ts'),
      directoryAttrs('src/main.ts'),
    )).toBe(true)
    expect(shouldReplaceComposerMention(
      fileAttrs('src/main.ts'),
      fileAttrs('src/other.ts'),
    )).toBe(false)
    expect(shouldReplaceComposerMention(
      skillAttrs('audit'),
      skillAttrs('release'),
    )).toBe(true)
    expect(shouldReplaceComposerMention(
      fileAttrs('src/main.ts'),
      skillAttrs(),
    )).toBe(false)
  })

  it('clears only an unchanged captured revision in the same scope', () => {
    expect(shouldClearCapturedComposer('scope:a', 'scope:a', 7, 7)).toBe(true)
    expect(shouldClearCapturedComposer('scope:a', 'scope:b', 7, 7)).toBe(false)
    expect(shouldClearCapturedComposer('scope:a', 'scope:a', 7, 8)).toBe(false)
  })

  it('rejects a stale same-length mention query at the same range', () => {
    const current = {
      documentRevision: 7,
      from: 3,
      query: 'bb',
      to: 6,
    }

    expect(composerMentionSuggestionMatches(current, current)).toBe(true)
    expect(composerMentionSuggestionMatches(current, {
      ...current,
      query: 'aa',
    })).toBe(false)
    expect(composerMentionSuggestionMatches(current, {
      ...current,
      documentRevision: 6,
    })).toBe(false)
    expect(composerMentionRequestMatches('scope:a', current, {
      ...current,
      scopeKey: 'scope:a',
    })).toBe(true)
    expect(composerMentionRequestMatches('scope:b', current, {
      ...current,
      scopeKey: 'scope:a',
    })).toBe(false)
    expect(composerMentionRequestMatches('scope:a', current, {
      ...current,
      query: 'aa',
      scopeKey: 'scope:a',
    })).toBe(false)
  })
})
