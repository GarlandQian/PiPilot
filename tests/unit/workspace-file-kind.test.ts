import { describe, expect, it } from 'vitest'
import {
  classifyWorkspaceFile,
  displayWorkspacePath,
  formatWorkspaceFileSize,
} from '../../src/components/inspector/workspace-file-kind'

describe('workspace file viewer classification', () => {
  it.each([
    ['README.md', { kind: 'markdown', language: 'markdown' }],
    ['docs/guide.markdown', { kind: 'markdown', language: 'markdown' }],
    ['src/App.tsx', { kind: 'source', language: 'typescript' }],
    ['settings.jsonc', { kind: 'source', language: 'json' }],
    ['styles/app.css', { kind: 'source', language: 'css' }],
    ['scripts/release.sh', { kind: 'source', language: 'shell' }],
    ['config/app.yaml', { kind: 'source', language: 'yaml' }],
    ['Cargo.toml', { kind: 'source', language: 'ini' }],
    ['Sources/App.swift', { kind: 'source', language: 'swift' }],
    ['tools/check.py', { kind: 'source', language: 'python' }],
    ['src/lib.rs', { kind: 'source', language: 'rust' }],
    ['Dockerfile', { kind: 'source', language: 'bash' }],
  ] as const)('classifies %s for the shared Markdown/code pipeline', (path, expected) => {
    expect(classifyWorkspaceFile(path)).toEqual(expected)
  })

  it('keeps unknown extensions as truthful unhighlighted plain text', () => {
    expect(classifyWorkspaceFile('fixtures/data.pipilot-fixture')).toEqual({ kind: 'plain' })
    expect(classifyWorkspaceFile('LICENSE')).toEqual({ kind: 'plain' })
    expect(classifyWorkspaceFile('constructor')).toEqual({ kind: 'plain' })
  })

  it('bounds long relative paths while retaining both ends', () => {
    const path = `packages/${'nested/'.repeat(30)}WorkspaceFileViewer.tsx`
    const display = displayWorkspacePath(path, 80)
    expect(display.length).toBe(80)
    expect(display).toMatch(/^packages\//)
    expect(display).toMatch(/WorkspaceFileViewer\.tsx$/)
    expect(display).toContain('…')
    expect(displayWorkspacePath(path, 1)).toBe('…')
  })

  it.each([
    [0, '0 B'],
    [1_023, '1023 B'],
    [1_024, '1.0 KiB'],
    [512 * 1_024, '512.0 KiB'],
    [2 * 1_024 * 1_024, '2.0 MiB'],
  ] as const)('formats %d bytes as compact binary units', (bytes, expected) => {
    expect(formatWorkspaceFileSize(bytes)).toBe(expected)
  })
})
