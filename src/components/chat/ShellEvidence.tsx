import * as React from 'react'
import { TbCheck, TbCopy } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { projectShellEvidence } from '@/renderer/pi-rpc/tool-activity'
import { MarkdownContent } from './markdown/MarkdownContent'

interface ShellEvidenceProps {
  label: string
  source: string
  tone?: 'default' | 'error'
}

export function ShellEvidence({ label, source, tone = 'default' }: ShellEvidenceProps) {
  const t = useT()
  const evidence = React.useMemo(() => projectShellEvidence(source), [source])
  const [view, setView] = React.useState<'formatted' | 'raw'>(evidence.defaultView)
  const explicitlySelectedRef = React.useRef(false)
  const [copied, setCopied] = React.useState(false)
  const copyFeedbackTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => () => {
    if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current)
  }, [])

  React.useEffect(() => {
    if (!evidence.formattedMarkdown) {
      setView('raw')
      return
    }
    if (!explicitlySelectedRef.current) setView(evidence.defaultView)
  }, [evidence.defaultView, evidence.formattedMarkdown])

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
    <section className="min-w-0 space-y-1.5">
      <header className="flex min-h-6 min-w-0 items-center gap-1.5">
        <h4 className={cn(
          'min-w-0 flex-1 truncate text-micro font-medium text-muted-foreground',
          tone === 'error' && 'text-destructive',
        )}>
          {label}
        </h4>
        {evidence.formattedMarkdown ? (
          <div
            className="flex shrink-0 items-center rounded-md bg-muted p-0.5"
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
                  view === candidate && 'bg-background text-foreground shadow-xs',
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
      {view === 'formatted' && evidence.formattedMarkdown ? (
        <div className="min-w-0 rounded-md bg-muted/35 px-2.5 py-2">
          <MarkdownContent markdown={evidence.formattedMarkdown} />
        </div>
      ) : (
        <pre className="scroll-slim max-h-64 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2.5 font-mono text-micro text-foreground/90">
          <code>{evidence.source}</code>
        </pre>
      )}
      {evidence.truncated ? (
        <p className="text-micro text-muted-foreground">{t('tool.outputTruncated')}</p>
      ) : null}
    </section>
  )
}
