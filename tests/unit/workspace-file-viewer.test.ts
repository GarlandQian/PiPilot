import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkspaceFileViewer, type WorkspaceFileViewerProps } from '../../src/components/inspector/WorkspaceFileViewer'
import { TooltipProvider } from '../../src/components/ui/tooltip'
import type { WorkspaceFilePreview } from '../../src/shared/workspace-content'

vi.mock('@/i18n', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => {
    if (!params) return key
    return Object.entries(params).reduce(
      (message, [name, value]) => `${message} ${name}=${String(value)}`,
      key,
    )
  },
}))

vi.mock('@/store/settings', () => ({
  useSettings: () => ({
    appearance: { showLineNumbers: true, wordWrap: true },
  }),
}))

const previewBase = {
  workspaceId: '00000000-0000-4000-8000-000000000000',
  fingerprint: 'a'.repeat(64),
}

const callbacks = {
  onBack: () => undefined,
  onClose: () => undefined,
}

function renderViewer(path: string, preview: WorkspaceFilePreview, loading = false, props: Partial<WorkspaceFileViewerProps> = {}) {
  return renderToStaticMarkup(createElement(
    TooltipProvider,
    null,
    createElement(WorkspaceFileViewer, {
      ...callbacks,
      path,
      preview,
      loading,
      ...props,
    }),
  ))
}

describe('WorkspaceFileViewer', () => {
  it('opens Markdown in safe Preview mode with a keyboard-accessible Source tab', () => {
    const markup = renderViewer('docs/README.md', {
      ...previewBase,
      path: 'docs/README.md',
      kind: 'text',
      size: 18,
      content: '# Heading\n\n- item',
    })

    expect(markup).toContain('data-workspace-file-viewer')
    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('inspector.preview.mode.preview')
    expect(markup).toContain('inspector.preview.mode.source')
    expect(markup).toContain('<h1>Heading</h1>')
    expect(markup).not.toContain('role="dialog"')
  })

  it('renders recognized source through the highlighted code controls', () => {
    const markup = renderViewer('src/example.ts', {
      ...previewBase,
      path: 'src/example.ts',
      kind: 'text',
      size: 24,
      content: 'const answer: number = 42\n',
    })

    expect(markup).toContain('typescript')
    expect(markup).toContain('hljs-keyword')
    expect(markup).toContain('md.toggleLineNumbers')
    expect(markup).toContain('md.toggleWrap')
    expect(markup).toContain('md.copy')
  })

  it('shows loading instead of stale content during a replacement request', () => {
    const markup = renderViewer('README.md', {
      ...previewBase,
      path: 'README.md',
      kind: 'text',
      size: 15,
      content: '# Stale heading',
    }, true)

    expect(markup).toContain('inspector.preview.loading')
    expect(markup).not.toContain('Stale heading')
  })

  it('exposes refresh on a ready preview and keeps its document visible during refresh', () => {
    const preview = {
      ...previewBase, path: 'README.md', kind: 'text' as const, size: 21, content: '# Last loaded heading',
    }
    const ready = renderViewer('README.md', preview, false, { onRefresh: () => undefined })
    expect(ready).toMatch(/<button[^>]*aria-label="common.refresh"[^>]*>/u)
    const refreshing = renderViewer('README.md', preview, false, { refreshing: true, onRefresh: () => undefined })
    expect(refreshing).toContain('<h1>Last loaded heading</h1>')
    expect(refreshing).toContain('aria-busy="true"')
    expect(refreshing).toMatch(/<button[^>]*aria-label="common.refresh"[^>]*disabled=""/u)
    expect(refreshing).toContain('inspector.preview.mode.source')
    expect(refreshing).toContain('inspector.preview.loading')
  })

  it('retains the last loaded document and shows a retryable alert when refresh fails', () => {
    const markup = renderViewer('README.md', {
      ...previewBase, path: 'README.md', kind: 'text', size: 21, content: '# Last loaded heading',
    }, false, { errorMessage: 'Cannot reload this file.', onRetry: () => undefined, onRefresh: () => undefined })
    expect(markup).toContain('<h1>Last loaded heading</h1>')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Cannot reload this file.')
    expect(markup).toContain('inspector.preview.retry')
    expect(markup).toContain('aria-busy="false"')
  })

  it.each([
    [
      'assets/archive.bin',
      { ...previewBase, path: 'assets/archive.bin', kind: 'binary', size: 1_024 } as const,
      'inspector.preview.binary',
    ],
    [
      'logs/large.txt',
      {
        ...previewBase,
        path: 'logs/large.txt',
        kind: 'too-large',
        size: 700_000,
        limit: 512 * 1_024,
      } as const,
      'inspector.preview.tooLarge',
    ],
  ])('renders an honest unavailable state for %s', (path, preview, message) => {
    expect(renderViewer(path, preview, false)).toContain(message)
  })
})
