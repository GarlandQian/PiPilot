import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ShellLogViewer } from '../../src/components/chat/ShellLogViewer'
import { ShellEvidence } from '../../src/components/chat/ShellEvidence'
import { ShellToolDetails } from '../../src/components/chat/ShellToolDetails'
import { ToolCallCard } from '../../src/components/chat/ToolCallCard'
import { ToolActivityRegion } from '../../src/components/chat/ToolActivityRegion'
import { TooltipProvider } from '../../src/components/ui/tooltip'
import { FollowingViewportIntent } from '../../src/components/chat/useFollowingViewport'
import { findShellLogMatches, MAX_LOG_MATCHES, projectShellLog } from '../../src/renderer/pi-rpc/shell-log'
import { projectStructuredValue } from '../../src/renderer/pi-rpc/structured-value'
import { projectToolActivitySequence } from '../../src/renderer/pi-rpc/tool-activity'
import type { ToolCall } from '../../src/types/chat'

vi.mock('@/i18n', () => ({ useT: () => (key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${Object.values(params).join(',')}` : key }))
vi.mock('@/store/settings', () => ({ useSettings: () => ({ appearance: {
  compactToolCards: false, reducedMotion: true, showLineNumbers: true, wordWrap: true,
} }) }))

describe('Bash output viewer', () => {
  it('strips terminal controls while retaining literal output and line boundaries', () => {
    expect(projectShellLog('\u001b]0;private terminal title\u0007\u001b[32mOK\u001b[0m\rnext\r\n<script>literal</script>\u0000').text)
      .toBe('OK\nnext\n<script>literal</script>')
  })

  it('keeps the latest bounded UTF-8 output without splitting a character', () => {
    const result = projectShellLog(`${'界😀'.repeat(30_000)}\nLATEST`)
    expect(result.truncated).toBe(true)
    expect(new TextEncoder().encode(result.text).length).toBeLessThanOrEqual(96 * 1_024)
    expect(result.text).not.toContain('\uFFFD')
    expect(result.text.endsWith('LATEST')).toBe(true)
  })

  it('retains a bounded safe ANSI palette and removes cursor and hyperlink controls', () => {
    const output = projectShellLog('\u001b[2J\u001b]8;;https://example.test\u0007\u001b[1;31mFAIL\u001b[0m plain\u001b]8;;\u0007')
    expect(output.text).toBe('FAIL plain')
    expect(output.styles).toEqual([{ start: 0, end: 4, style: { bold: true, color: 'red' } }])
    expect(projectShellLog('\u001b[38;2;31;1;4mRGB\u001b[0m').styles).toEqual([])
    expect(projectShellLog('\u001b[31mx\u001b[0my'.repeat(2_000)).styles).toEqual([])
    const markup = renderToStaticMarkup(createElement(ShellLogViewer, { label: 'Output', source: '\u001b[31mFAIL\u001b[0m' }))
    expect(markup).toContain('class="text-destructive">FAIL</span>')
    expect(markup).not.toContain('\u001b')
  })

  it('searches literal patterns case-insensitively using original text offsets', () => {
    const text = 'İ [A.*] and [a.*] 😀'
    const matches = findShellLogMatches(text, '[a.*]')
    expect(matches.map(({ start, end }) => text.slice(start, end))).toEqual(['[A.*]', '[a.*]'])
    expect(findShellLogMatches(text, '')).toEqual([])
    expect(findShellLogMatches('a'.repeat(20_000), 'a')).toHaveLength(MAX_LOG_MATCHES)
  })

  it('does not resume streaming when new output or layout reaches the bottom', () => {
    const intent = new FollowingViewportIntent()
    intent.interact(100, true)
    expect(intent.scroll({ scrollTop: 20, scrollHeight: 500, clientHeight: 100 }, 110)).toBe(false)
    expect(intent.scroll({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 }, 1000)).toBe(false)
    intent.pause()
    expect(intent.scroll({ scrollTop: 1000, scrollHeight: 1100, clientHeight: 100 }, 1200)).toBe(false)
    intent.follow()
    expect(intent.following).toBe(true)
  })

  it('renders search, wrap, copy and a bounded literal viewport without interpreting HTML', () => {
    const markup = renderToStaticMarkup(createElement(ShellLogViewer, {
      label: 'Output', source: '<script>alert(1)</script>', live: true,
    }))
    expect(markup).toContain('data-shell-log-output')
    expect(markup).toContain('tool.redesign.search')
    expect(markup).toContain('tool.redesign.wrap')
    expect(markup).toContain('tool.copy')
    expect(markup).toContain('tool.redesign.live')
    expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(markup).not.toContain('<script>')
  })

  it('keeps ordinary command logs literal while rendering clear Markdown summaries', () => {
    const logs = renderToStaticMarkup(createElement(ShellEvidence, {
      label: 'Output', source: ' Test Files  3 passed\n      Tests  21 passed', followOutput: true,
    }))
    expect(logs).toContain('<code> Test Files  3 passed\n      Tests  21 passed</code>')
    const summary = renderToStaticMarkup(createElement(ShellEvidence, {
      label: 'Output', source: 'The checks **passed**.', followOutput: true,
    }))
    expect(summary).toContain('<strong>passed</strong>')
  })

  it('shows the settled output once with actual invocation data behind a secondary disclosure', () => {
    const call: ToolCall = { id: 'bash', kind: 'shell', title: 'Bash', body: 'pnpm test', status: 'success',
      progress: 'Old progress', output: 'Final output', details: {
        arguments: projectStructuredValue({ command: 'pnpm test', timeout: 30_000 }),
      },
    }
    const markup = renderToStaticMarkup(createElement(ShellToolDetails, { call }))
    expect(markup).toContain('Final output')
    expect(markup).not.toContain('Old progress')
    expect(markup).toContain('tool.redesign.rawArguments')
    expect(markup).not.toContain('30000')
  })

  it('never invents exit codes for a successful tool', () => {
    const call: ToolCall = { id: 'bash', kind: 'shell', title: 'Bash', body: 'pnpm test', status: 'success' }
    const render = (value: ToolCall) => renderToStaticMarkup(createElement(TooltipProvider, null,
      createElement(ToolCallCard, { call: value })))
    expect(render(call)).not.toContain('tool.redesign.exitCode')
    expect(render({ ...call, exitCode: 7 })).toContain('tool.redesign.exitCode:7')
    expect(render({ ...call, exitCode: Number.NaN })).not.toContain('tool.redesign.exitCode')
  })

  it('offers opening command output from the transcript without a recursive action in resource details', () => {
    const call: ToolCall = { id: 'bash-resource', kind: 'shell', title: 'Bash', body: 'pnpm test', status: 'success', output: 'Done' }
    const item = projectToolActivitySequence([{ kind: 'tool', id: call.id, call }])[0]
    if (item?.kind !== 'activity-run') throw new Error('Expected tool activity')
    const transcript = renderToStaticMarkup(createElement(TooltipProvider, null,
      createElement(ToolActivityRegion, { run: item.run, sessionKey: 'session', onOpenCommand: () => undefined })))
    expect(transcript).toContain('aria-label="tool.redesign.openOutput"')
    const resource = renderToStaticMarkup(createElement(ShellToolDetails, { call }))
    expect(resource).not.toContain('tool.redesign.openOutput')
    expect(resource).toContain('Done')
  })
})
