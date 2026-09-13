const ELEMENT_NODE = 1
const TEXT_NODE = 3

const BLOCK_ELEMENTS = new Set([
  'ADDRESS',
  'ARTICLE',
  'ASIDE',
  'BLOCKQUOTE',
  'DD',
  'DIV',
  'DL',
  'DT',
  'FIELDSET',
  'FIGCAPTION',
  'FIGURE',
  'FOOTER',
  'FORM',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HEADER',
  'HR',
  'LI',
  'MAIN',
  'NAV',
  'OL',
  'P',
  'PRE',
  'SECTION',
  'TABLE',
  'TR',
  'UL',
])

const OMITTED_ELEMENTS = new Set([
  'NOSCRIPT',
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
])

export interface ComposerClipboardData {
  files?: ArrayLike<File> | null
  getData(format: string): string
  items?: ArrayLike<Pick<DataTransferItem, 'getAsFile' | 'kind'>> | null
}

export interface ComposerClipboardPayload {
  files: readonly File[]
  handled: boolean
  text: string | null
}

interface ComposerClipboardDependencies {
  htmlToText?: (html: string) => string
}

interface PendingNode {
  closing: boolean
  node: Node
  preserveWhitespace: boolean
}

function appendLineBreak(parts: string[]) {
  const previous = parts[parts.length - 1]
  if (parts.length > 0 && previous !== '\n') parts.push('\n')
}

function appendText(parts: string[], value: string, preserveWhitespace: boolean) {
  let text = value.replace(/\r\n?/gu, '\n')
  if (!preserveWhitespace) text = text.replace(/[\t\n\f ]+/gu, ' ')
  if (!text) return

  const previous = parts[parts.length - 1]
  if ((parts.length === 0 || previous === '\n') && text.startsWith(' ')) {
    text = text.slice(1)
  } else if (previous?.endsWith(' ') && text.startsWith(' ')) {
    text = text.slice(1)
  }
  if (text) parts.push(text)
}

export function plainTextFromHtmlDocument(document: Document) {
  const parts: string[] = []
  const pending: PendingNode[] = Array.from(document.body.childNodes)
    .reverse()
    .map((node) => ({ closing: false, node, preserveWhitespace: false }))

  while (pending.length > 0) {
    const current = pending.pop()!
    if (current.node.nodeType === TEXT_NODE) {
      appendText(parts, current.node.nodeValue ?? '', current.preserveWhitespace)
      continue
    }
    if (current.node.nodeType !== ELEMENT_NODE) continue

    const tagName = current.node.nodeName.toUpperCase()
    if (OMITTED_ELEMENTS.has(tagName)) continue
    if (current.closing) {
      if (tagName === 'TD' || tagName === 'TH') {
        const previous = parts[parts.length - 1]
        if (previous && previous !== '\n' && !previous.endsWith('\t')) parts.push('\t')
      } else if (BLOCK_ELEMENTS.has(tagName)) {
        appendLineBreak(parts)
      }
      continue
    }

    if (tagName === 'BR') {
      appendLineBreak(parts)
      continue
    }
    if (BLOCK_ELEMENTS.has(tagName)) appendLineBreak(parts)

    const preserveWhitespace = current.preserveWhitespace || tagName === 'PRE'
    pending.push({ ...current, closing: true, preserveWhitespace })
    const children = Array.from(current.node.childNodes)
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push({
        closing: false,
        node: children[index],
        preserveWhitespace,
      })
    }
  }

  return parts.join('')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n[ \t]+/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

export function plainTextFromClipboardHtml(html: string) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  return plainTextFromHtmlDocument(document)
}

export function normalizeComposerClipboard(
  clipboardData: ComposerClipboardData | null,
  dependencies: ComposerClipboardDependencies = {},
): ComposerClipboardPayload {
  if (!clipboardData) return { files: [], handled: false, text: null }

  const files = Array.from(clipboardData.files ?? [])
  if (files.length === 0) {
    for (const item of Array.from(clipboardData.items ?? [])) {
      if (item.kind !== 'file') continue
      const file = item.getAsFile()
      if (file) files.push(file)
    }
  }
  const plainText = clipboardData.getData('text/plain')
  let text = plainText.length > 0 ? plainText.replace(/\r\n?/gu, '\n') : null

  if (text === null) {
    const html = clipboardData.getData('text/html')
    if (html.length > 0) {
      const htmlToText = dependencies.htmlToText ?? plainTextFromClipboardHtml
      const fallback = htmlToText(html).replace(/\r\n?/gu, '\n')
      if (fallback.length > 0) text = fallback
    }
  }

  return {
    files,
    handled: text !== null || files.length > 0,
    text,
  }
}
