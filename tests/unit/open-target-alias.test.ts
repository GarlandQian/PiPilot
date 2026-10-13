import { describe, expect, it } from 'vitest'
import { openTargetsOf, preferredTarget } from '../../src/renderer/open-targets'
import type { ExternalEditor } from '../../src/shared/external-editors'
import type { TerminalExternalApp } from '../../src/shared/terminal-profiles'

const editors: ExternalEditor[] = [
  { id: 'cursor', name: 'Cursor', kind: 'editor', available: true },
  { id: 'vscode', aliases: ['external:custom:code'], name: 'Visual Studio Code', kind: 'editor', available: true },
  { id: 'vscode-insiders', name: 'Visual Studio Code Insiders', kind: 'editor', available: true },
  { id: 'system', name: '', kind: 'system' },
]

const terminal: TerminalExternalApp = {
  id: 'external:detected:windows-terminal',
  aliases: ['external:detected:wt-path', 'external:custom:terminal'],
  label: 'Windows Terminal',
  source: 'detected',
  adapter: 'windows-terminal',
  executable: 'C:\\Program Files\\WindowsApps\\Terminal\\WindowsTerminal.exe',
  available: true,
}

describe('remembered open targets after application identity deduplication', () => {
  it('retains a saved custom editor selection when its physical installation represents the group', () => {
    const targets = openTargetsOf({ editors, terminals: [terminal] })
    expect(preferredTarget(targets, 'external:custom:code')?.id).toBe('vscode')
    expect(targets.filter((target) => target.id === 'external:custom:code')).toEqual([])
  })

  it('retains either a launch alias or custom terminal selection without adding duplicate choices', () => {
    const targets = openTargetsOf({ editors, terminals: [terminal] })
    expect(preferredTarget(targets, 'external:detected:wt-path')?.id).toBe(terminal.id)
    expect(preferredTarget(targets, 'external:custom:terminal')?.id).toBe(terminal.id)
    expect(targets.filter((target) => target.group === 'terminal')).toHaveLength(1)
  })

  it('keeps a distinct Preview installation selectable by its own identity', () => {
    const targets = openTargetsOf({ editors, terminals: [terminal] })
    expect(preferredTarget(targets, 'vscode-insiders')?.id).toBe('vscode-insiders')
  })

  it('does not select an unavailable application through a remembered alias', () => {
    const targets = openTargetsOf({
      editors: editors.map((editor) => editor.id === 'vscode' ? { ...editor, available: false } : editor),
      terminals: [{ ...terminal, available: false }],
    })
    expect(preferredTarget(targets, 'external:custom:code')?.id).toBe('cursor')
    expect(preferredTarget(targets, 'external:detected:wt-path')?.id).toBe('cursor')
  })
})
