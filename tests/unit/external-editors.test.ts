import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ExternalEditors, externalEditorInternals } from '../../src/main/editors/external-editors'
import { cleanCommitMessage } from '../../src/main/ipc/register-workspace-ipc'
import { suggestedBranchName } from '../../src/components/inspector/CommitControls'
import { preferredEditor } from '../../src/renderer/external-editors'

async function waitFor(path: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { return await readFile(path, 'utf8') } catch { await new Promise((resolve) => setTimeout(resolve, 50)) }
  }
  throw new Error(`${path} never appeared`)
}

describe('external editors', () => {
  it('finds editors on PATH without a shell, and always offers the default app and file manager', async () => {
    const bin = await mkdtemp(join(tmpdir(), 'pipilot-editors-'))
    try {
      await writeFile(join(bin, 'code'), '#!/bin/sh\necho "$@" > "$(dirname "$0")/opened"\n', 'utf8')
      await chmod(join(bin, 'code'), 0o755)
      const openPath = vi.fn(async () => '')
      const showItemInFolder = vi.fn()
      const editors = new ExternalEditors({ platform: 'linux', env: { PATH: bin }, openPath, showItemInFolder })
      expect((await editors.list()).map((editor) => `${editor.kind}:${editor.id}`)).toEqual(['editor:vscode', 'system:system', 'file-manager:file-manager'])
      await editors.open('vscode', '/project/src/app.ts', 12)
      expect((await waitFor(join(bin, 'opened'))).trim()).toBe('-g /project/src/app.ts:12')
      await editors.open('file-manager', '/project/src/app.ts')
      expect(showItemInFolder).toHaveBeenCalledWith('/project/src/app.ts')
      await editors.open('system', '/project')
      expect(openPath).toHaveBeenCalledWith('/project')
      await expect(editors.open('zed', '/project')).rejects.toThrow()
    } finally {
      await rm(bin, { recursive: true, force: true })
    }
  })

  it('finds macOS app bundles in either Applications folder', async () => {
    const home = await mkdtemp(join(tmpdir(), 'pipilot-home-'))
    try {
      await mkdir(join(home, 'Applications', 'Zed.app'), { recursive: true })
      const editors = new ExternalEditors({ platform: 'darwin', env: {}, home, openPath: async () => '', showItemInFolder: () => undefined })
      expect((await editors.list()).some((editor) => editor.id === 'zed')).toBe(true)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('expands Windows environment variables in install paths', () => {
    expect(externalEditorInternals.expandWindows('%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe', { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }))
      .toBe('C:\\Users\\me\\AppData\\Local\\Programs\\cursor\\Cursor.exe')
    expect(externalEditorInternals.expandWindows('%MISSING%\\x.exe', {})).toBe('%MISSING%\\x.exe')
  })

  it('defaults to the remembered editor, else the first one found, else the default app', () => {
    const list = [
      { id: 'cursor', name: 'Cursor', kind: 'editor' as const },
      { id: 'zed', name: 'Zed', kind: 'editor' as const },
      { id: 'system', name: '', kind: 'system' as const },
    ]
    expect(preferredEditor(list, 'zed')?.id).toBe('zed')
    expect(preferredEditor(list, 'gone')?.id).toBe('cursor')
    expect(preferredEditor(list.slice(2), null)?.id).toBe('system')
  })
})

describe('commit helpers', () => {
  it('keeps only the message a model wrote', () => {
    expect(cleanCommitMessage('```\nFix the parser\n```')).toBe('Fix the parser')
    expect(cleanCommitMessage('"Fix the parser"')).toBe('Fix the parser')
    expect(cleanCommitMessage('  Fix the parser\n\nBody.  ')).toBe('Fix the parser\n\nBody.')
  })

  it('names a pull request branch after the message, or after the time', () => {
    const now = new Date(2026, 9, 8, 9, 5)
    expect(suggestedBranchName('Fix the review header\n\nMore.', now)).toBe('pipilot/fix-the-review-header')
    expect(suggestedBranchName('修复审阅标题', now)).toBe('pipilot/changes-20261008-0905')
  })
})
