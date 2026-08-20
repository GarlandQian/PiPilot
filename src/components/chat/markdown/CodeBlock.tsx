import * as React from 'react'
import { TbCopy, TbCheck, TbChevronDown, TbChevronUp, TbTextWrap, TbListNumbers } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { useSettings } from '@/store/settings'
import { cn } from '@/lib/utils'

const COLLAPSE_LINE_THRESHOLD = 24
const COLLAPSED_VISIBLE_LINES = 12

interface CodeBlockProps {
  language?: string
  filePath?: string
  code: string
  /** Keep long chat snippets bounded; full-file viewers can disable this. */
  allowCollapse?: boolean
  /** highlighted inner HTML produced by rehype-highlight (already escaped) */
  children?: React.ReactNode
}

export function CodeBlock({
  language,
  filePath,
  code,
  allowCollapse = true,
  children,
}: CodeBlockProps) {
  const t = useT()
  const { appearance } = useSettings()
  const [copied, setCopied] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [wrap, setWrap] = React.useState(appearance.wordWrap)
  const [lineNumbers, setLineNumbers] = React.useState(appearance.showLineNumbers)
  const [expanded, setExpanded] = React.useState(false)

  const lineCount = React.useMemo(() => (code.endsWith('\n') ? code.slice(0, -1) : code).split('\n').length, [code])
  const collapsible = allowCollapse && lineCount > COLLAPSE_LINE_THRESHOLD
  const collapsedStyle: React.CSSProperties | undefined =
    collapsible && !expanded
      ? { maxHeight: `calc(${COLLAPSED_VISIBLE_LINES} * var(--code-font-size) * 1.5 + 20px)`, overflow: 'hidden' }
      : undefined

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setFailed(false)
    } catch {
      setFailed(true)
    }
    setTimeout(() => {
      setCopied(false)
      setFailed(false)
    }, 1400)
  }

  return (
    <figure className="group/code my-2 overflow-hidden rounded-md border border-border bg-muted/40">
      <figcaption className="flex h-8 items-center gap-1 border-b border-border bg-muted/60 px-2">
        <span className="min-w-0 flex-1 truncate font-mono text-micro text-muted-foreground" title={filePath ?? language}>
          {filePath ?? language ?? 'text'}
          {filePath && language ? <span className="text-muted-foreground/60"> · {language}</span> : null}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('md.toggleLineNumbers')}
              aria-pressed={lineNumbers}
              onClick={() => setLineNumbers((v) => !v)}
              className={cn(lineNumbers && 'text-foreground')}
            >
              <TbListNumbers aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('md.toggleLineNumbers')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('md.toggleWrap')}
              aria-pressed={wrap}
              onClick={() => setWrap((v) => !v)}
              className={cn(wrap && 'text-foreground')}
            >
              <TbTextWrap aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('md.toggleWrap')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" onClick={copy} aria-label={t('md.copy')}>
              {copied ? <TbCheck className="text-sage" aria-hidden /> : <TbCopy aria-hidden />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{failed ? t('md.copyFailed') : copied ? t('md.copied') : t('md.copy')}</TooltipContent>
        </Tooltip>
      </figcaption>

      <div className="scroll-slim overflow-x-auto" style={collapsedStyle}>
        {lineNumbers ? (
          <pre className="code-body flex p-2.5">
            <span aria-hidden className="code-line-no sticky left-0 select-none pr-3 text-right">
              {Array.from({ length: lineCount }, (_, i) => (
                <span key={i} className="block">
                  {i + 1}
                </span>
              ))}
            </span>
            <code className={cn('hljs block min-w-0 flex-1', wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')}>
              {children ?? code}
            </code>
          </pre>
        ) : (
          <pre className={cn('code-body p-2.5', wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')}>
            <code className="hljs block">{children ?? code}</code>
          </pre>
        )}
      </div>

      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex h-7 w-full cursor-pointer items-center justify-center gap-1 border-t border-border text-micro text-muted-foreground outline-none transition-colors duration-(--duration-fast) hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {expanded ? <TbChevronUp className="size-3" aria-hidden /> : <TbChevronDown className="size-3" aria-hidden />}
          {expanded ? t('md.collapseCode') : t('md.expandCode', { count: lineCount - COLLAPSED_VISIBLE_LINES })}
        </button>
      )}
    </figure>
  )
}
