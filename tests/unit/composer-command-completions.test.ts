import { describe, expect, it } from 'vitest'
import {
  applyComposerSlashArgumentCompletion,
  composerCommandArgumentRequestMatches,
  composerSlashArgumentQuery,
  createComposerCommandArgumentRequest,
  projectComposerCommandArgumentCandidates,
} from '../../src/renderer/composer/extension-command-completions'

describe('composer extension command argument completions', () => {
  it('parses the complete current argument prefix after a leading command', () => {
    expect(composerSlashArgumentQuery('/goal r', 4)).toEqual({
      argumentPrefix: 'r',
      argumentStart: 6,
      commandName: 'goal',
      documentRevision: 4,
      textBeforeCursor: '/goal r',
    })
    expect(composerSlashArgumentQuery('/goal resume now', 5)?.argumentPrefix)
      .toBe('resume now')
    expect(composerSlashArgumentQuery('/goal ', 1)?.argumentPrefix).toBe('')
    expect(composerSlashArgumentQuery('/goal  r', 1)?.argumentPrefix).toBe(' r')
  })

  it('rejects non-leading, command-only, slash-containing, and multiline forms', () => {
    expect(composerSlashArgumentQuery(' /goal r', 1)).toBeNull()
    expect(composerSlashArgumentQuery('/goal', 1)).toBeNull()
    expect(composerSlashArgumentQuery('/goal\tr', 1)).toBeNull()
    expect(composerSlashArgumentQuery('/group/goal r', 1)).toBeNull()
    expect(composerSlashArgumentQuery('/goal r\nnext', 1)).toBeNull()
    expect(composerSlashArgumentQuery(null, 1)).toBeNull()
  })

  it('replaces only the argument prefix and preserves the command and cursor suffix', () => {
    const atEnd = composerSlashArgumentQuery('/goal r', 2)
    expect(atEnd && applyComposerSlashArgumentCompletion('/goal r', atEnd, 'resume'))
      .toBe('/goal resume')

    const beforeCursor = composerSlashArgumentQuery('/goal re', 3)
    expect(beforeCursor && applyComposerSlashArgumentCompletion(
      '/goal resume --verbose',
      beforeCursor,
      'restart',
    )).toBe('/goal restartsume --verbose')
    expect(beforeCursor && applyComposerSlashArgumentCompletion(
      '/goal changed',
      beforeCursor,
      'restart',
    )).toBeNull()
  })

  it('drops an async result after text, scope, revision, or command identity changes', async () => {
    const originalQuery = composerSlashArgumentQuery('/goal r', 7)
    if (!originalQuery) throw new Error('Expected a query fixture.')
    const request = createComposerCommandArgumentRequest(
      'project:one:session-a:3',
      originalQuery,
    )
    const lateResult = Promise.resolve([{ value: 'resume', label: 'Resume' }])

    await lateResult
    expect(composerCommandArgumentRequestMatches(
      'project:one:session-a:3',
      originalQuery,
      request,
    )).toBe(true)
    expect(composerCommandArgumentRequestMatches(
      'project:one:session-a:3',
      composerSlashArgumentQuery('/goal re', 8),
      request,
    )).toBe(false)
    expect(composerCommandArgumentRequestMatches(
      'project:two:session-a:3',
      originalQuery,
      request,
    )).toBe(false)
    expect(composerCommandArgumentRequestMatches(
      'project:one:session-b:4',
      originalQuery,
      request,
    )).toBe(false)
    expect(composerCommandArgumentRequestMatches(
      'project:one:session-a:3',
      composerSlashArgumentQuery('/plan r', 7),
      request,
    )).toBe(false)
  })

  it('keeps provider labels and descriptions while deduplicating by value', () => {
    const candidates = projectComposerCommandArgumentCandidates([
      { value: 'resume', label: 'Resume', description: 'Continue the goal' },
      { value: 'resume', label: 'Duplicate' },
      { value: 'restart', label: 'Restart' },
    ])

    expect(candidates.map(({ value, label, description }) => ({
      value,
      label,
      description,
    }))).toEqual([
      { value: 'resume', label: 'Resume', description: 'Continue the goal' },
      { value: 'restart', label: 'Restart', description: undefined },
    ])
    expect(new Set(candidates.map(({ id }) => id)).size).toBe(2)
  })
})
