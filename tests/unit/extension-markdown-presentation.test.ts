import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ResponseActivityRow } from '../../src/components/chat/ExtensionSurfaces'
import { ExtensionUiDialog } from '../../src/components/chat/ExtensionUiDialog'
import { PendingItemContent, PendingMessageRail } from '../../src/components/chat/PendingMessageRail'
import { InlineMarkdown } from '../../src/components/chat/markdown/InlineMarkdown'
import { TooltipProvider } from '../../src/components/ui/tooltip'
import type { PendingRailItem } from '../../src/renderer/composer/composer-controls'
import type { ResponseActivity } from '../../src/types/chat'

vi.mock('@/i18n', () => ({ useT: () => (key: string) => key }))
vi.mock('@/store/settings', () => ({
  useSettings: () => ({
    appearance: { reducedMotion: true, showLineNumbers: true, wordWrap: true },
  }),
}))

// Reveal portaled dialog content for SSR without replacing Markdown or state.
// Preserve asChild so block content cannot silently pass inside a default <p>.
vi.mock('@/components/ui/dialog', async () => {
  const React = await import('react')
  type PrimitiveProps = { children?: React.ReactNode; asChild?: boolean; className?: string }
  const primitive = (tag: 'div' | 'h2' | 'p', slot: string) => (
    { children, asChild, className }: PrimitiveProps,
  ) => {
    const props = { 'data-slot': slot, ...(className ? { className } : {}) }
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children as React.ReactElement<typeof props>, props)
    }
    return React.createElement(tag, props, children)
  }
  return {
    Dialog: ({ open, children }: { open?: boolean; children?: React.ReactNode }) => (
      open ? React.createElement(React.Fragment, null, children) : null
    ),
    DialogContent: primitive('div', 'dialog-content'),
    DialogHeader: primitive('div', 'dialog-header'),
    DialogFooter: primitive('div', 'dialog-footer'),
    DialogTitle: primitive('h2', 'dialog-title'),
    DialogDescription: primitive('p', 'dialog-description'),
  }
})

function render(content: ReactNode) {
  return renderToStaticMarkup(createElement(TooltipProvider, null, content))
}

const summary = '[Documentation](https://example.test/docs) is **ready**.'
const summaryActivities: ResponseActivity[] = [
  { kind: 'working', id: 'working', state: 'active', message: summary },
  { kind: 'status', id: 'status', state: 'active', label: 'Status', message: summary },
  { kind: 'widget', id: 'widget', state: 'settled', label: 'Widget', summary },
  { kind: 'notification', id: 'notification', state: 'settled', tone: 'info', message: summary },
  { kind: 'extension-error', id: 'error', state: 'settled', message: summary },
]

function pendingItem(overrides: Partial<PendingRailItem> = {}): PendingRailItem {
  return {
    id: 'pending-message',
    kind: 'followUp',
    text: '**Continue** with [the guide](https://example.test/guide).',
    images: [],
    locallyOwned: true,
    canPromote: true,
    canRemove: true,
    ...overrides,
  }
}

function renderPendingRail(item: PendingRailItem) {
  return render(createElement(PendingMessageRail, {
    operationOwnerKey: 'pending-preview',
    queue: {
      pendingCount: 1, detailsKnown: true,
      steering: [], steeringItems: [],
      followUp: [item.text], followUpItems: [item],
      steeringMode: 'one-at-a-time', followUpMode: 'one-at-a-time',
    },
    runningSubmitPreference: 'queue',
    onRunningSubmitPreferenceChange: () => undefined,
    onSetQueueMode: async () => undefined,
    onPromoteFollowUp: async () => undefined,
    onRemoveQueuedMessage: async () => undefined,
  }))
}

describe('extension activity Markdown', () => {
  it.each(summaryActivities)('renders a leading Markdown link in a $kind summary', (activity) => {
    const markup = render(createElement(ResponseActivityRow, { activity }))

    expect(markup).toContain('href="https://example.test/docs"')
    expect(markup).toContain('>Documentation</a>')
    expect(markup).toContain('<strong>ready</strong>')
    expect(markup).not.toContain('tool.valueMalformed')
    expect(markup).not.toContain('extension.activity.details')
    for (const button of markup.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gu)) {
      expect(button[1]).not.toContain('<a ')
      expect(button[1]).not.toContain('md-body')
    }
  })

  it('renders initially expanded retry details as Markdown outside the disclosure button', () => {
    const markup = render(createElement(ResponseActivityRow, {
      activity: {
        kind: 'retry', id: 'retry-error', state: 'settled',
        retryKind: 'provider', phase: 'error',
        message: '## Recovery\n\n- **Retry** with [the guide](https://example.test/recovery).',
      },
    }))

    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('<h2>Recovery</h2>')
    expect(markup).toContain('<li><strong>Retry</strong>')
    expect(markup).toContain('href="https://example.test/recovery"')
    const disclosure = markup.match(/<button\b[^>]*>([\s\S]*?)<\/button>/u)?.[1]
    expect(disclosure).toBeDefined()
    expect(disclosure).not.toContain('<h2>')
    expect(disclosure).not.toContain('<a ')
  })

  it.each([
    ['quoted Markdown', '"**A quoted notice**"', '<strong>A quoted notice</strong>'],
    ['boolean', 'true', '<p>true</p>'],
    ['number', '42', '<p>42</p>'],
  ])('keeps a %s summary in the reader without adding a disclosure', (_name, message, expected) => {
    const markup = render(createElement(ResponseActivityRow, {
      activity: { kind: 'working', id: 'scalar-summary', state: 'settled', message },
    }))

    expect(markup).toContain(expected)
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('extension.activity.details')
  })

  it('renders quoted Markdown inside expanded retry details', () => {
    const markup = render(createElement(ResponseActivityRow, {
      activity: {
        kind: 'retry', id: 'quoted-retry', state: 'settled',
        retryKind: 'provider', phase: 'error', message: '"**quoted recovery**"',
      },
    }))

    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('<strong>quoted recovery</strong>')
    expect(markup).not.toContain('extension.activity.details')
  })

  it.each([
    '{"reason":"unavailable","retryable":true}',
    '[{"reason":"unavailable","retryable":true}]',
  ])('preserves parsed JSON objects and arrays as structured evidence: %s', (message) => {
    const markup = render(createElement(ResponseActivityRow, {
      activity: {
        kind: 'extension-error', id: 'structured-error', state: 'settled',
        message,
      },
    }))

    expect(markup).toContain('extension.activity.details')
    expect(markup).toContain('title="reason"')
    expect(markup).toContain('title="retryable"')
    expect(markup).not.toContain('md-body')
  })

  it('keeps unsafe links, raw HTML and remote images out of activity markup', () => {
    const markup = render(createElement(ResponseActivityRow, {
      activity: {
        kind: 'notification', id: 'untrusted-notification', state: 'settled', tone: 'warning',
        message: '[unsafe](javascript:alert%281%29) <script>alert(1)</script> ![remote](https://example.test/image.png)',
      },
    }))

    expect(markup).toContain('unsafe</span>')
    expect(markup).toContain('[remote]')
    expect(markup).not.toContain('href="javascript:')
    expect(markup).not.toContain('<script')
    expect(markup).not.toContain('<img')
  })
})

describe('inline Markdown', () => {
  it('retains readable formatted content without block or interactive elements', () => {
    const markdown = [
      '# **Heading**',
      'Paragraph with *emphasis*, ~~removed~~, `inline()`, and [label](https://example.test/link).',
      '- List item\n- [x] Completed item',
      '| Name | State |\n| --- | --- |\n| Table cell | Active |',
      '```ts\nconst safe = true\n```',
      '![Diagram](https://example.test/image.png)',
      '<div onclick="alert(1)">Raw HTML</div>',
    ].join('\n\n')
    const markup = renderToStaticMarkup(createElement(InlineMarkdown, { markdown }))

    expect(markup).toContain('<strong>Heading</strong>')
    expect(markup).toContain('<em>emphasis</em>')
    expect(markup).toContain('<del>removed</del>')
    expect(markup).toMatch(/<code\b[^>]*>inline\(\)<\/code>/u)
    for (const text of ['Paragraph with', 'label', 'List item', 'Completed item', 'Name', 'State', 'Table cell', 'Active', 'const safe = true', 'Diagram']) {
      expect(markup).toContain(text)
    }
    for (const tag of markup.matchAll(/<\/?([a-z][a-z0-9]*)\b/gu)) {
      expect(['span', 'strong', 'em', 'del', 'code']).toContain(tag[1])
    }
    expect(markup).not.toContain('href=')
    expect(markup).not.toContain('src=')
    expect(markup).not.toContain('onclick=')
  })
})

describe('extension dialog Markdown', () => {
  it('renders an inline confirm title and a block-safe Markdown message', () => {
    const markup = render(createElement(ExtensionUiDialog, {
      request: {
        type: 'extension_ui_request', id: 'confirm-markdown', method: 'confirm',
        title: '**Review** this change',
        message: '## Before continuing\n\nRead [the guide](https://example.test/confirm).\n\n- Keep `settings.json`.',
      },
      onRespond: () => undefined,
    }))

    const title = markup.match(/<h2 data-slot="dialog-title">([\s\S]*?)<\/h2>/u)?.[1]
    expect(title).toContain('<strong>Review</strong>')
    expect(title).not.toMatch(/<(?:div|p|h[1-6]|a|button)\b/u)
    expect(markup).toMatch(/<div\b[^>]*data-slot="dialog-description"/u)
    expect(markup).toContain('<h2>Before continuing</h2>')
    expect(markup).toContain('href="https://example.test/confirm"')
    expect(markup).toContain('<code>settings.json</code>')
    expect(markup).not.toMatch(/<p\b[^>]*data-slot="dialog-description"/u)
    expect(markup).toContain('common.yes')
    expect(markup).toContain('common.no')
  })

  it('formats the input title and leaves its placeholder literal', () => {
    const placeholder = '**Literal text** [label](https://example.test)'
    const markup = render(createElement(ExtensionUiDialog, {
      request: {
        type: 'extension_ui_request', id: 'input-markdown', method: 'input',
        title: 'Enter a _name_', placeholder,
      },
      onRespond: () => undefined,
    }))

    expect(markup).toContain('<em>name</em>')
    expect(markup).toContain(`placeholder="${placeholder}"`)
    expect(markup).not.toContain('<strong>Literal text</strong>')
    expect(markup).not.toContain('href="https://example.test"')
  })

  it('formats selection labels without mutating the original choices', () => {
    const option = '**Literal choice** [label](https://example.test/choice)'
    const options = [option, 'Second _raw_ choice']
    const markup = render(createElement(ExtensionUiDialog, {
      request: {
        type: 'extension_ui_request', id: 'select-markdown', method: 'select',
        title: '**Choose** a _target_', options,
      },
      onRespond: () => undefined,
    }))

    expect(markup).toContain('<strong>Choose</strong>')
    expect(markup).toContain('<em>target</em>')
    expect(markup).toContain('<strong>Literal choice</strong> label</span></button>')
    expect(markup).toContain('Second <em>raw</em> choice</span></button>')
    expect(options).toEqual([option, 'Second _raw_ choice'])
    expect(markup).not.toContain('href="https://example.test/choice"')
  })
})

describe('pending message Markdown', () => {
  const skillEnvelope = '<skill name="review-helper" location="/fixture/skills/review-helper/SKILL.md">\n## Skill instructions\n\n- **Inspect** the files.\n</skill>'

  it('preserves skill instructions, appended prose and images in a queued message', () => {
    const markup = render(createElement(PendingItemContent, {
      item: pendingItem({
        text: `${skillEnvelope}\n\nPlease **review** [this change](https://example.test/queued-change).`,
        images: [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }],
      }),
    }))
    const disclosure = markup.match(/<details\b[^>]*>([\s\S]*?)<\/details>/u)

    expect(markup).toContain('data-prompt-skill="review-helper"')
    expect(disclosure?.[1]).toContain('data-prompt-skill-content')
    expect(disclosure?.[1]).toContain('<h2>Skill instructions</h2>')
    expect(disclosure?.[1]).toContain('<strong>Inspect</strong>')
    const afterDisclosure = markup.slice(markup.indexOf('</details>') + '</details>'.length)
    expect(afterDisclosure).toContain('<strong>review</strong>')
    expect(afterDisclosure).toContain('href="https://example.test/queued-change"')
    expect(markup).toContain('src="data:image/png;base64,aGVsbG8="')
    expect(markup).toContain('data-queue-image="true"')
    expect(markup).not.toContain('<skill ')
    expect(markup).not.toContain('&lt;skill ')
  })

  it('provides only the skill disclosure for a queued skill without appended user prose', () => {
    const markup = render(createElement(PendingItemContent, { item: pendingItem({ text: skillEnvelope }) }))

    expect(markup).toContain('data-prompt-skill="review-helper"')
    expect(markup).toContain('<strong>Inspect</strong>')
    expect(markup).not.toContain('composer.pendingMessageExpand')
  })

  it('shows the skill name and appended Markdown safely in the queue header', () => {
    const markup = renderPendingRail(pendingItem({
      text: `${skillEnvelope}\n\nPlease **review** [this change](https://example.test/queued-change).`,
    }))
    const preview = [...markup.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gu)]
      .find((button) => button[1]?.includes('data-prompt-skill='))?.[1]

    expect(preview).toBeDefined()
    expect(preview).toContain('data-prompt-skill="review-helper"')
    expect(preview).toContain('review-helper')
    expect(preview).toContain('<strong>review</strong>')
    expect(preview).toContain('this change')
    expect(preview).not.toContain('Skill instructions')
    expect(preview).not.toMatch(/<(?:div|p|h[1-6]|ul|ol|li|table|pre|a|img|input|button|details|summary)\b/u)
    expect(markup).not.toContain('<skill ')
    expect(markup).not.toContain('&lt;skill ')
  })

  it('renders a complete short message as Markdown', () => {
    const markup = render(createElement(PendingItemContent, { item: pendingItem() }))

    expect(markup).toContain('<strong>Continue</strong>')
    expect(markup).toContain('href="https://example.test/guide"')
    expect(markup).not.toContain('composer.pendingMessageExpand')
  })

  it('formats the collapsed message while preserving its attached image', () => {
    const markup = render(createElement(PendingItemContent, {
      item: pendingItem({ images: [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }] }),
    }))

    expect(markup).toContain('<strong>Continue</strong>')
    expect(markup).toContain('href="https://example.test/guide"')
    expect(markup).toContain('src="data:image/png;base64,aGVsbG8="')
    expect(markup).toContain('data-queue-image="true"')
    expect(markup).toContain('composer.pendingMessageExpand')
    expect(markup).toContain('aria-expanded="false"')
  })

  it('formats a queue preview inside its disclosure without nested interactive content', () => {
    const markup = renderPendingRail(pendingItem())
    const preview = [...markup.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gu)]
      .find((button) => button[1]?.includes('<strong>Continue</strong>'))?.[1]

    expect(preview).toBeDefined()
    expect(preview).toContain('the guide')
    expect(preview).not.toMatch(/<(?:div|p|h[1-6]|ul|ol|li|table|pre|a|img|input|button)\b/u)
  })
})
