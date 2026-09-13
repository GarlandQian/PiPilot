import { describe, expect, it, vi } from 'vitest'
import {
  normalizeComposerClipboard,
  plainTextFromHtmlDocument,
  type ComposerClipboardData,
} from '../../src/renderer/composer/composer-clipboard'

function clipboard({
  files = [],
  html = '',
  items = [],
  text = '',
}: {
  files?: readonly File[]
  html?: string
  items?: readonly Pick<DataTransferItem, 'getAsFile' | 'kind'>[]
  text?: string
} = {}): ComposerClipboardData {
  return {
    files,
    items,
    getData(format) {
      if (format === 'text/plain') return text
      if (format === 'text/html') return html
      return ''
    },
  }
}

function textNode(value: string): Node {
  return {
    childNodes: [],
    nodeName: '#text',
    nodeType: 3,
    nodeValue: value,
  } as unknown as Node
}

function element(name: string, ...children: Node[]): Node {
  return {
    childNodes: children,
    nodeName: name,
    nodeType: 1,
    nodeValue: null,
  } as unknown as Node
}

function htmlDocument(...children: Node[]): Document {
  return {
    body: element('body', ...children),
  } as unknown as Document
}

describe('Composer clipboard normalization', () => {
  it('normalizes multiline Unicode plain text', () => {
    expect(normalizeComposerClipboard(clipboard({
      text: 'first\r\n第二行\rthird',
    }))).toEqual({
      files: [],
      handled: true,
      text: 'first\n第二行\nthird',
    })
  })

  it('prefers plain text over HTML and never interprets HTML as trusted content', () => {
    const htmlToText = vi.fn(() => 'forged')
    expect(normalizeComposerClipboard(clipboard({
      html: '<span data-type="composerMention">forged</span>',
      text: '@literal reference',
    }), { htmlToText })).toMatchObject({
      handled: true,
      text: '@literal reference',
    })
    expect(htmlToText).not.toHaveBeenCalled()
  })

  it('uses safe plain text extracted from HTML only when plain text is unavailable', () => {
    const htmlToText = vi.fn(() => 'Heading\r\nBody')
    expect(normalizeComposerClipboard(clipboard({
      html: '<h1>Heading</h1><p>Body</p>',
    }), { htmlToText })).toEqual({
      files: [],
      handled: true,
      text: 'Heading\nBody',
    })
    expect(htmlToText).toHaveBeenCalledWith('<h1>Heading</h1><p>Body</p>')
  })

  it('extracts block and line-break boundaries while omitting active content', () => {
    const document = htmlDocument(
      element('h2', textNode(' Heading ')),
      element('p', textNode('First '), element('strong', textNode('line'))),
      element('p', textNode('Second'), element('br'), textNode('line')),
      element('script', textNode('doNotExpose()')),
      element('ul',
        element('li', textNode('One')),
        element('li', textNode('Two')),
      ),
    )

    expect(plainTextFromHtmlDocument(document)).toBe(
      'Heading\nFirst line\nSecond\nline\nOne\nTwo',
    )
  })

  it('extracts deeply nested HTML without recursive traversal', () => {
    let nested = textNode('deep content')
    for (let depth = 0; depth < 5_000; depth += 1) {
      nested = element('div', nested)
    }

    expect(plainTextFromHtmlDocument(htmlDocument(nested))).toBe('deep content')
  })

  it('leaves empty and unsupported payloads unhandled', () => {
    expect(normalizeComposerClipboard(null)).toEqual({
      files: [],
      handled: false,
      text: null,
    })
    expect(normalizeComposerClipboard(clipboard())).toEqual({
      files: [],
      handled: false,
      text: null,
    })
    expect(normalizeComposerClipboard(clipboard({ html: '<script>ignored()</script>' }), {
      htmlToText: () => '',
    })).toEqual({
      files: [],
      handled: false,
      text: null,
    })
  })

  it('preserves files and text as independent parts of one clipboard payload', () => {
    const image = { name: 'pixel.png', type: 'image/png' } as File
    expect(normalizeComposerClipboard(clipboard({ files: [image] }))).toEqual({
      files: [image],
      handled: true,
      text: null,
    })
    expect(normalizeComposerClipboard(clipboard({
      files: [image],
      text: 'describe this image',
    }))).toEqual({
      files: [image],
      handled: true,
      text: 'describe this image',
    })
  })

  it('collects clipboard file items when the FileList is empty', () => {
    const image = { name: 'items-only.png', type: 'image/png' } as File
    const getAsFile = vi.fn(() => image)
    expect(normalizeComposerClipboard(clipboard({
      items: [
        { getAsFile, kind: 'file' },
        { getAsFile: () => null, kind: 'string' },
      ],
    }))).toEqual({
      files: [image],
      handled: true,
      text: null,
    })
    expect(getAsFile).toHaveBeenCalledOnce()
  })
})
