import * as React from 'react'
import { TbCheck, TbCopy } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { projectShellEvidence } from '@/renderer/pi-rpc/tool-activity'
import { MarkdownContent } from './markdown/MarkdownContent'
import { ShellLogViewer } from './ShellLogViewer'

interface ShellEvidenceProps {
  label: string
  source: string
  sourceTruncated?: boolean
  tone?: 'default' | 'error'
  format?: 'auto' | 'markdown' | 'verbatim'
  live?: boolean
  followOutput?: boolean
}

/** Preserve terminal records while allowing ordinary prose through the Markdown renderer. */
export function isVerbatimToolEvidence(source: string): boolean {
  if (/\u001b\[[0-?]*[ -/]*[@-~]/u.test(source) || /\r(?!\n)/u.test(source)) return true
  const trimmed = source.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed)
      return true
    } catch {
      // A link, task list, or prose beginning with a bracket is still Markdown.
    }
  }
  // Tabs inside Markdown lists and fenced code must not turn the whole report
  // into a literal terminal block. The Markdown renderer owns these structures.
  if (/^ {0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|`{3,}|~{3,})/mu.test(source)) return false
  if (/^\s*\|?.+\|.+\r?\n\s*\|?\s*:?-{3,}:?\s*\|/mu.test(source)) return false
  if (source.includes('\t')) return true
  const lines = source.split(/\r?\n/u).filter(Boolean)
  const logLines = lines.filter((line) =>
    /^\s*(?:\d{4}-\d{2}-\d{2}[T\s]|\[?(?:trace|debug|info|warn|error|fatal)\]?\b)/iu.test(line),
  )
  return logLines.length >= 2 && logLines.length >= Math.ceil(lines.length / 2)
}

export function ShellEvidence(props: ShellEvidenceProps) {
  if (props.followOutput) {
    const format = props.format ?? 'auto'
    const markdownSummary = /^ {0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|`{3,}|~{3,})/mu.test(props.source) ||
      /(?:\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\[[^\]\n]+\]\([^\n)]+\))/u.test(props.source) ||
      /^\s*\|?.+\|.+\r?\n\s*\|?\s*:?-{3,}:?\s*\|/mu.test(props.source)
    return <ShellLogViewer {...props} allowMarkdown={format === 'markdown' || (format === 'auto' && markdownSummary && !isVerbatimToolEvidence(props.source))} />
  }
  return <StandardEvidence {...props} />
}

function StandardEvidence({
  label,
  source,
  sourceTruncated = false,
  tone = 'default',
  format = 'auto',
}: ShellEvidenceProps) {
  const t = useT()
  const evidence = React.useMemo(() => projectShellEvidence(source), [source])
  const formattedMarkdown = format === 'markdown' ||
    (format === 'auto' && !isVerbatimToolEvidence(evidence.source))
    ? evidence.source : undefined
  const defaultView = formattedMarkdown ? 'formatted' : 'raw'
  const [view, setView] = React.useState<'formatted' | 'raw'>(
    defaultView,
  )
  const explicitlySelectedRef = React.useRef(false)
  const [copied, setCopied] = React.useState(false)
  const copyFeedbackTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => () => {
    if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current)
  }, [])

  React.useEffect(() => {
    if (!formattedMarkdown) {
      setView('raw')
      return
    }
    if (!explicitlySelectedRef.current) setView(defaultView)
  }, [defaultView, formattedMarkdown])

  const copy = React.useCallback(async () => {
    if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current)
    try {
      await navigator.clipboard.writeText(evidence.source)
      setCopied(true)
      copyFeedbackTimer.current = setTimeout(() => {
        setCopied(false)
        copyFeedbackTimer.current = null
      }, 1_200)
    } catch {
      setCopied(false)
    }
  }, [evidence.source])

  if (!evidence.source.trim()) return null
  return (
    <section className="min-w-0 space-y-1" data-tool-evidence={format}>
      <header className="flex min-h-6 min-w-0 items-center gap-1.5">
        <h4 className={cn(
          'min-w-0 flex-1 truncate text-micro font-medium text-muted-foreground',
          tone === 'error' && 'text-destructive',
        )}>
          {label}
        </h4>
        {formattedMarkdown ? (
          <div
            className="flex shrink-0 items-center gap-0.5"
            aria-label={t('tool.outputView')}
          >
            {(['formatted', 'raw'] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-pressed={view === candidate}
                onClick={() => {
                  explicitlySelectedRef.current = true
                  setView(candidate)
                }}
                className={cn(
                  'h-5 rounded-sm px-1.5 text-micro text-muted-foreground outline-none hover:text-foreground focus-visible:focus-ring',
                  view === candidate && 'bg-accent/45 text-foreground',
                )}
              >
                {t(candidate === 'formatted' ? 'tool.outputFormatted' : 'tool.outputRaw')}
              </button>
            ))}
          </div>
        ) : null}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => void copy()}
          aria-label={copied ? t('tool.copied') : t('tool.copy')}
        >
          {copied ? <TbCheck className="text-sage" aria-hidden /> : <TbCopy aria-hidden />}
        </Button>
      </header>
      {view === 'formatted' && formattedMarkdown ? (
        <div className="scroll-slim max-h-[min(28rem,55vh)] min-w-0 overflow-auto pr-1">
          <MarkdownContent markdown={formattedMarkdown} />
        </div>
      ) : (
        <pre className={cn(
          'scroll-slim max-h-[min(28rem,55vh)] max-w-full overflow-auto whitespace-pre-wrap break-words font-mono text-caption leading-relaxed text-foreground/85',
          tone === 'error' && 'text-destructive',
        )}>
          <code>{evidence.source}</code>
        </pre>
      )}
      {evidence.truncated || sourceTruncated ? (
        <p className="text-micro text-muted-foreground">{t('tool.outputTruncated')}</p>
      ) : null}
    </section>
  )
}
