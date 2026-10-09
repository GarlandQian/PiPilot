import * as React from 'react'
import { TbChevronRight, TbTerminal2, TbWorld } from 'react-icons/tb'
import { Textarea } from '@/components/ui/textarea'
import { useLocale, useT, type MessageKey } from '@/i18n'
import { MCP_TEMPLATES, type McpTemplate } from '@/shared/mcp-templates'
import { parseMcpImport } from '@/shared/mcp-import'
import { localizedText } from '@/shared/model-provider-presets'
import { EditorFooter } from '../editor-page'
import { McpServerIcon } from './McpServerEditor'
import { chosenServers, McpClashSelect, McpImportPreview, type McpClashPolicy } from './McpImportPreview'
import { transportOf, type McpTransport } from './mcp-editor-model'

export type McpAddMode = 'template' | 'paste'

/** Step one of adding a server: a common one, a blank one, or configuration pasted from elsewhere. */
export function McpAddPage({ mode, onMode, existing, onTemplate, onBlank, onAdd, onCancel, onDirtyChange, disabled }: {
  mode: McpAddMode
  onMode(mode: McpAddMode): void
  existing: readonly string[]
  onTemplate(template: McpTemplate): void
  onBlank(transport: McpTransport): void
  /** Add the pasted servers; false keeps the page open. */
  onAdd(servers: readonly { name: string; definition: Record<string, unknown> }[]): Promise<boolean>
  onCancel(): void
  onDirtyChange(dirty: boolean): void
  disabled: boolean
}) {
  const t = useT()
  const locale = useLocale()
  const [text, setText] = React.useState('')
  const [policy, setPolicy] = React.useState<McpClashPolicy>('skip')
  const [deselected, setDeselected] = React.useState<ReadonlySet<string>>(() => new Set())
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const result = React.useMemo(() => parseMcpImport(text), [text])
  const candidates = React.useMemo(() => (result?.servers ?? []).map((server, index) => ({ ...server, key: `${index}:${server.name}` })), [result])
  const selected = React.useMemo(() => new Set(candidates.map((candidate) => candidate.key).filter((key) => !deselected.has(key))), [candidates, deselected])
  const chosen = chosenServers(candidates, selected, existing, policy)
  const dirty = mode === 'paste' && text.trim() !== ''
  React.useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])

  const add = async () => {
    setSaving(true)
    setError(null)
    const added = await onAdd(chosen.map(({ name, definition }) => ({ name, definition })))
    setSaving(false)
    if (!added) setError(t('settings.mcp.saveFailed'))
  }

  return <div className="min-w-0 space-y-5" data-mcp-add-page={mode}>
    <div className="mac-segmented mx-auto w-fit max-w-full" role="radiogroup" aria-label={t('settings.mcp.page.addMode')}>
      {(['template', 'paste'] as const).map((candidate) => <button key={candidate} type="button" role="radio" aria-checked={mode === candidate} aria-pressed={mode === candidate}
        className="outline-none focus-visible:focus-ring" onClick={() => onMode(candidate)}>{t(`settings.mcp.page.addMode.${candidate}` as MessageKey)}</button>)}
    </div>

    {mode === 'template' ? <div className="min-w-0 space-y-5">
      <div className="grid min-w-0 gap-2 @min-[680px]/settings-workspace:grid-cols-2" data-mcp-templates>
        {MCP_TEMPLATES.map((template) => <button key={template.key} type="button" data-mcp-template={template.key} disabled={disabled} onClick={() => onTemplate(template)}
          className="mac-box flex min-w-0 items-center gap-3 px-3.5 py-3 text-left outline-none transition-colors hover:bg-fill focus-visible:focus-ring disabled:opacity-60">
          <McpServerIcon transport={transportOf(template.definition as Record<string, unknown>)} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2"><span className="text-app font-medium">{localizedText(template.title, locale)}</span>
              {existing.some((name) => name.toLowerCase() === template.name) ? <span className="rounded-full bg-success/14 px-1.5 text-micro text-success">{t('settings.models.presets.added')}</span> : null}</span>
            <span className="mt-0.5 block text-micro leading-snug text-muted-foreground">{localizedText(template.description, locale)}</span>
          </span>
          <TbChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>)}
      </div>
      <section className="min-w-0 space-y-2" aria-label={t('settings.mcp.page.blank')}>
        <h2 className="px-1 text-app font-semibold">{t('settings.mcp.page.blank')}</h2>
        <div className="mac-group min-w-0">
          {(['stdio', 'http'] as const).map((transport) => <button key={transport} type="button" data-mcp-blank={transport} disabled={disabled} onClick={() => onBlank(transport)}
            className="flex w-full min-w-0 items-center gap-3 py-2.5 text-left outline-none focus-visible:focus-ring disabled:opacity-60">
            {transport === 'http' ? <TbWorld className="size-5 shrink-0 text-muted-foreground" aria-hidden /> : <TbTerminal2 className="size-5 shrink-0 text-muted-foreground" aria-hidden />}
            <span className="min-w-0 flex-1"><span className="block text-app">{t(`settings.mcp.page.blank.${transport}` as MessageKey)}</span>
              <span className="block text-micro text-muted-foreground">{t(transport === 'http' ? 'settings.mcp.page.transportHttpHint' : 'settings.mcp.page.transportStdioHint')}</span></span>
            <TbChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>)}
        </div>
      </section>
      <p className="px-1 text-micro leading-relaxed text-muted-foreground">{t('settings.mcp.page.templatesCredit')}</p>
    </div> : <div className="min-w-0 space-y-3">
      <p className="px-1 text-caption leading-relaxed text-muted-foreground">{t('settings.mcp.paste.description')}</p>
      <Textarea value={text} autoFocus spellCheck={false} aria-label={t('settings.mcp.paste.label')} placeholder={t('settings.mcp.paste.placeholder')}
        onChange={(event) => { setText(event.target.value); setDeselected(new Set()) }}
        className="scroll-slim min-h-48 resize-y rounded-lg bg-surface-inset p-3 font-mono text-caption leading-relaxed dark:bg-black/20" />
      {text.trim() ? result && candidates.length ? <>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-1">
          <p className="text-caption text-muted-foreground" role="status">{t('settings.mcp.paste.found', { count: candidates.length, format: t(`settings.mcp.paste.format.${result.format}` as MessageKey) })}</p>
          {candidates.some((candidate) => existing.some((name) => name.toLowerCase() === candidate.name.toLowerCase())) ? <McpClashSelect value={policy} onChange={setPolicy} /> : null}
        </div>
        <McpImportPreview candidates={candidates} selected={selected} existing={existing} policy={policy}
          onToggle={(key, on) => setDeselected((current) => {
            const next = new Set(current)
            if (on) next.delete(key)
            else next.add(key)
            return next
          })} />
      </> : <p className="px-1 text-caption text-destructive" role="alert">{t('settings.mcp.paste.unrecognized')}</p> : null}
      <EditorFooter onCancel={onCancel} onSave={() => void add()} saving={saving} canSave={chosen.length > 0 && !disabled} error={error}
        saveLabel={t('settings.mcp.paste.add', { count: chosen.length })} />
    </div>}
  </div>
}
