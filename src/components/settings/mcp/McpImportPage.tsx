import * as React from 'react'
import { TbAlertTriangle, TbLoader2, TbRefresh } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import type { McpImportApp, McpImportSourcesResult } from '@/shared/mcp-config'
import { EditorFooter } from '../editor-page'
import { chosenServers, McpClashSelect, McpImportPreview, type McpClashPolicy, type McpImportCandidate } from './McpImportPreview'

const APP_NAMES: Readonly<Record<McpImportApp, string>> = {
  'claude-code': 'Claude Code',
  'claude-desktop': 'Claude Desktop',
  codex: 'Codex',
  cursor: 'Cursor',
  gemini: 'Gemini CLI',
  vscode: 'VS Code',
  windsurf: 'Windsurf',
}

/** Copy servers other apps on this computer already have; their files are only read. */
export function McpImportPage({ load, existing, onAdd, onCancel, disabled }: {
  load(): Promise<McpImportSourcesResult>
  existing: readonly string[]
  onAdd(servers: readonly { name: string; definition: Record<string, unknown> }[]): Promise<boolean>
  onCancel(): void
  disabled: boolean
}) {
  const t = useT()
  const [state, setState] = React.useState<{ phase: 'loading' } | { phase: 'ready'; result: McpImportSourcesResult } | { phase: 'error' }>({ phase: 'loading' })
  const [policy, setPolicy] = React.useState<McpClashPolicy>('skip')
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(() => new Set())
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const loadRef = React.useRef(load)
  loadRef.current = load

  const refresh = React.useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const result = await loadRef.current()
      setState({ phase: 'ready', result })
      // Everything new is chosen; servers already here, and SSE ones Pi cannot use, stay unchosen.
      const taken = new Set(existing.map((name) => name.toLowerCase()))
      setSelected(new Set(result.sources.flatMap((source) => source.servers
        .filter((server) => !taken.has(server.name.toLowerCase()) && !server.notes.some((note) => note.kind === 'sse'))
        .map((server) => `${source.path}:${server.name}`))))
    } catch {
      setState({ phase: 'error' })
    }
    // `existing` only seeds the first choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  React.useEffect(() => { void refresh() }, [refresh])

  const sources = state.phase === 'ready' ? state.result.sources : []
  const candidates: McpImportCandidate[] = sources.flatMap((source) => source.servers.map((server) => ({ ...server, key: `${source.path}:${server.name}` })))
  const chosen = chosenServers(candidates, selected, existing, policy)
  const toggle = (key: string, on: boolean) => setSelected((current) => {
    const next = new Set(current)
    if (on) next.add(key)
    else next.delete(key)
    return next
  })

  const add = async () => {
    setSaving(true)
    setError(null)
    const added = await onAdd(chosen.map(({ name, definition }) => ({ name, definition })))
    setSaving(false)
    if (!added) setError(t('settings.mcp.saveFailed'))
  }

  return <div className="min-w-0 space-y-5" data-mcp-import-page>
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 px-1">
      <p className="min-w-0 max-w-[72ch] flex-1 text-caption leading-relaxed text-muted-foreground">{t('settings.mcp.import.description')}</p>
      <div className="flex shrink-0 items-center gap-2">
        {candidates.some((candidate) => existing.some((name) => name.toLowerCase() === candidate.name.toLowerCase())) ? <McpClashSelect value={policy} onChange={setPolicy} /> : null}
        <Button variant="ghost" size="icon-sm" aria-label={t('common.refresh')} disabled={state.phase === 'loading'} onClick={() => void refresh()}>
          <TbRefresh className={state.phase === 'loading' ? 'animate-spin motion-reduce:animate-none' : ''} aria-hidden />
        </Button>
      </div>
    </div>
    {state.phase === 'loading' ? <div className="mac-group"><p className="flex items-center justify-center gap-2 py-12 text-caption text-muted-foreground" role="status"><TbLoader2 className="size-4 animate-spin" aria-hidden />{t('settings.mcp.import.looking')}</p></div>
      : state.phase === 'error' ? <div className="mac-group"><p className="py-10 text-center text-caption text-destructive" role="alert">{t('settings.mcp.import.failed')}</p></div>
        : sources.length === 0 ? <div className="mac-group"><p className="px-4 py-10 text-center text-caption leading-relaxed text-muted-foreground">{t('settings.mcp.import.none')}</p></div>
          : sources.map((source) => <section key={source.path} className="min-w-0 space-y-2" aria-label={APP_NAMES[source.app]} data-mcp-import-source={source.app}>
            <header className="min-w-0 px-1">
              <h2 className="text-app font-semibold">{APP_NAMES[source.app]}<span className="ml-2 text-caption font-normal text-muted-foreground">{t('settings.mcp.import.count', { count: source.servers.length })}</span></h2>
              <p className="mt-0.5 break-all font-mono text-micro text-muted-foreground">{source.path}</p>
            </header>
            {source.error ? <p className="flex items-center gap-1.5 px-1 text-caption text-warning" role="status"><TbAlertTriangle className="size-3.5" aria-hidden />{t(`settings.mcp.import.error.${source.error}`)}</p>
              : <McpImportPreview candidates={candidates.filter((candidate) => candidate.key.startsWith(`${source.path}:`))} selected={selected} onToggle={toggle} existing={existing} policy={policy} />}
          </section>)}
    <EditorFooter onCancel={onCancel} onSave={() => void add()} saving={saving} canSave={chosen.length > 0 && !disabled} error={error}
      saveLabel={t('settings.mcp.import.add', { count: chosen.length })} />
  </div>
}
