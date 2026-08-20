import * as React from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { Components } from 'react-markdown'
import { CodeBlock } from './CodeBlock'
import { MarkdownLink, sanitizeHref } from './MarkdownLink'
import { useT } from '@/i18n'

/** Minimal structural hast types (avoids a @types/hast dependency). */
interface HastNode {
  type: string
  tagName?: string
  value?: string
  children?: HastNode[]
  properties?: { className?: string[] }
  data?: { meta?: string }
}

/** Extra URL guard on top of react-markdown's defaultUrlTransform. */
function urlTransform(url: string, key: string) {
  const transformed = defaultUrlTransform(url)
  if (!transformed) return ''
  // Remote images stay text-only: production CSP intentionally does not grant
  // Markdown an ambient network request channel.
  if (key === 'src') return ''
  return sanitizeHref(transformed) ?? ''
}

/** Plain-text content of a hast subtree (used for copy + line counting). */
function textContent(node: HastNode | undefined): string {
  if (!node) return ''
  if (node.type === 'text') return node.value ?? ''
  return node.children ? node.children.map(textContent).join('') : ''
}

interface MarkdownCodeOptions {
  sourceCode?: string
  allowCollapse?: boolean
}

function useMarkdownComponents(options?: MarkdownCodeOptions): Components {
  const t = useT()
  return React.useMemo<Components>(
    () => ({
      a: ({ node: _node, ...props }) => <MarkdownLink {...props} />,
      pre: ({ node, children }) => {
        const hast = node as unknown as HastNode | undefined
        const codeEl = hast?.children?.find((c) => c.type === 'element' && c.tagName === 'code')
        const className = codeEl?.properties?.className?.join(' ') ?? ''
        const language = /language-([\w+-]+)/.exec(className)?.[1]
        const meta = (codeEl?.data?.meta ?? '').trim()
        const filePath = meta ? meta.replace(/^(?:title|path)=/, '') : undefined
        const raw = options?.sourceCode ?? textContent(hast)
        return (
          <CodeBlock
            language={language}
            filePath={filePath}
            code={raw}
            allowCollapse={options?.allowCollapse}
          >
            {React.isValidElement(children) ? (children.props as { children?: React.ReactNode }).children : children}
          </CodeBlock>
        )
      },
      table: ({ node: _node, children, ...props }) => (
        <div className="scroll-slim my-2 max-w-full overflow-x-auto rounded-md border border-border outline-none focus-visible:focus-ring" role="region" aria-label={t('md.table')} tabIndex={0}>
          <table {...props} className="w-full border-collapse text-caption">
            {children}
          </table>
        </div>
      ),
      img: ({ node: _node, src, alt, ...props }) => {
        const safe = typeof src === 'string' ? sanitizeHref(src) : undefined
        if (!safe) return <span className="text-micro text-muted-foreground">[{alt || t('md.image')}]</span>
        return (
          <img
            {...props}
            src={safe}
            alt={alt ?? ''}
            loading="lazy"
            className="my-2 max-h-72 max-w-full rounded-md border border-border object-contain"
          />
        )
      },
      input: ({ node: _node, checked, ...props }) => (
        <input
          {...props}
          type="checkbox"
          checked={checked ?? false}
          readOnly
          disabled
          aria-label={checked ? t('md.taskDone') : t('md.taskPending')}
          className="mr-1.5 size-3.5 translate-y-[2px] accent-[var(--color-sage)]"
        />
      ),
    }),
    [options?.allowCollapse, options?.sourceCode, t],
  )
}

interface MarkdownContentProps {
  markdown: string
  /** true while tokens are arriving or the live typewriter is catching up */
  streaming?: boolean
}

interface MarkdownRendererProps extends MarkdownContentProps {
  codeOptions?: MarkdownCodeOptions
}

function MarkdownRenderer({ markdown, streaming = false, codeOptions }: MarkdownRendererProps) {
  const components = useMarkdownComponents(codeOptions)
  return (
    <div className="md-body w-full min-w-0 max-w-[800px]">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        rehypePlugins={streaming
          ? []
          : [[rehypeHighlight, { detect: false, ignoreUnknown: true }]]}
        urlTransform={urlTransform}
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}

export function MarkdownContent(props: MarkdownContentProps) {
  return <MarkdownRenderer {...props} />
}

function sourceFence(code: string, language?: string) {
  let longestRun = 0
  for (const match of code.matchAll(/`+/g)) {
    longestRun = Math.max(longestRun, match[0].length)
  }
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  const safeLanguage = language && /^[\w+-]+$/.test(language) ? language : ''
  return `${fence}${safeLanguage}\n${code}${code.endsWith('\n') ? '' : '\n'}${fence}`
}

interface MarkdownSourceProps {
  code: string
  language?: string
}

/**
 * Highlight a complete read-only source document through the same safe
 * Markdown/rehype pipeline used by chat code fences.
 */
export function MarkdownSource({ code, language }: MarkdownSourceProps) {
  const markdown = React.useMemo(() => sourceFence(code, language), [code, language])
  const codeOptions = React.useMemo<MarkdownCodeOptions>(
    () => ({ sourceCode: code, allowCollapse: false }),
    [code],
  )
  return <MarkdownRenderer markdown={markdown} codeOptions={codeOptions} />
}
