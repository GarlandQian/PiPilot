import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Headings, paragraphs, lists, tables, and links are unwrapped into their
// contents. Images and hard breaks retain a text equivalent without a request
// or focus target. This renderer is safe inside a heading or another control.
const INLINE_ELEMENTS = ['strong', 'em', 'del', 'code', 'img', 'br']
const components: Components = {
  code: ({ children }) => (
    <code className="rounded-sm border border-border/50 bg-muted/50 px-1 py-px font-mono text-[0.9em]">
      {children}
    </code>
  ),
  img: ({ alt }) => <span>{alt || ''}</span>,
  br: () => <span> </span>,
}

/** Format short reading text without introducing blocks or nested controls. */
export function InlineMarkdown({ markdown }: { markdown: string }) {
  return <span>
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm]}
      allowedElements={INLINE_ELEMENTS}
      unwrapDisallowed
      urlTransform={() => ''}
      components={components}
    >
      {markdown}
    </ReactMarkdown>
  </span>
}
