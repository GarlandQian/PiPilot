import * as React from 'react'
import { TbTerminal2, TbWorld } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useLocale, useT, type MessageKey } from '@/i18n'
import { MCP_TEMPLATES, type McpTemplate } from '@/shared/mcp-templates'
import { parseMcpImport } from '@/shared/mcp-import'
import { localizedText } from '@/shared/model-provider-presets'
import { FormActions, SettingsBadge, SettingsGroup, SettingsListRow, SettingsRow, SettingsSheet } from '../kit'
import { McpServerIcon } from './McpServerEditor'
import { chosenServers, McpClashSelect, McpImportPreview, type McpClashPolicy } from './McpImportPreview'
import { transportOf, type McpTransport } from './mcp-editor-model'

export type McpAddMode = 'template' | 'paste'
export type McpScope = 'global' | 'project'

/** Where new servers go, when a project is open. */
export function McpTargetRow({ value, onChange, projectName }: { value: McpScope; onChange(value: McpScope): void; projectName: string | null }) {
  const t = useT()
  if (!projectName) return null
  return <SettingsRow label={t('settings.mcp.page.addTo')} htmlFor="mcp-add-target" info={t('settings.mcp.page.addToHint')}>
    <select id="mcp-add-target" className="mac-select" value={value} onChange={(event) => onChange(event.target.value === 'project' ? 'project' : 'global')}>
      <option value="global">{t('settings.integrations.scope.global')}</option>
      <option value="project">{projectName}</option>
    </select>
  </SettingsRow>
}

/** Adding a server: a common one, a blank one, or configuration pasted from elsewhere. */
export function McpAddSheet({ open, onOpenChange, existing, projectName, onTemplate, onBlank, onAdd, disabled }: {
  open: boolean
  onOpenChange(open: boolean): void
  /** Names already used where each scope's servers go. */
  existing: Readonly<Record<McpScope, readonly string[]>>
  projectName: string | null
  onTemplate(template: McpTemplate, scope: McpScope): void
  onBlank(transport: McpTransport, scope: McpScope): void
  /** Add the pasted servers; false keeps the sheet open. */
  onAdd(servers: readonly { name: string; definition: Record<string, unknown> }[], scope: McpScope): Promise<boolean>
  disabled: boolean
}) {
  const t = useT()
  const locale = useLocale()
  const [mode, setMode] = React.useState<McpAddMode>('template')
  const [scope, setScope] = React.useState<McpScope>('global')
  const [text, setText] = React.useState('')
  const [policy, setPolicy] = React.useState<McpClashPolicy>('skip')
  const [deselected, setDeselected] = React.useState<ReadonlySet<string>>(() => new Set())
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!open) return
    setMode('template'); setText(''); setError(null); setDeselected(new Set()); setScope('global')
  }, [open])
  const names = existing[scope]
  const result = React.useMemo(() => parseMcpImport(text), [text])
  const candidates = React.useMemo(() => (result?.servers ?? []).map((server, index) => ({ ...server, key: `${index}:${server.name}` })), [result])
  const selected = React.useMemo(() => new Set(candidates.map((candidate) => candidate.key).filter((key) => !deselected.has(key))), [candidates, deselected])
  const chosen = chosenServers(candidates, selected, names, policy)

  const add = async () => {
    setSaving(true)
    setError(null)
    const added = await onAdd(chosen.map(({ name, definition }) => ({ name, definition })), scope)
    setSaving(false)
    if (!added) setError(t('settings.mcp.saveFailed'))
  }

  return <SettingsSheet open={open} onOpenChange={onOpenChange} wide title={t('settings.mcp.page.addTitle')} data-mcp-add-page={mode}
    description={mode === 'paste' ? t('settings.mcp.paste.description') : undefined}
    footer={mode === 'paste'
      ? <FormActions onCancel={() => onOpenChange(false)} onSave={() => void add()} saving={saving} canSave={chosen.length > 0 && !disabled} error={error} saveLabel={t('settings.mcp.paste.add', { count: chosen.length })} />
      : <div className="flex justify-end"><Button variant="outline" className="min-w-[76px]" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button></div>}>
    <div className="space-y-5">
      <div className="mac-segmented max-w-full" role="radiogroup" aria-label={t('settings.mcp.page.addMode')}>
        {(['template', 'paste'] as const).map((candidate) => <button key={candidate} type="button" role="radio" aria-checked={mode === candidate} aria-pressed={mode === candidate}
          className="outline-none focus-visible:focus-ring" onClick={() => setMode(candidate)}>{t(`settings.mcp.page.addMode.${candidate}` as MessageKey)}</button>)}
      </div>
      {projectName ? <SettingsGroup><McpTargetRow value={scope} onChange={setScope} projectName={projectName} /></SettingsGroup> : null}
      {mode === 'template' ? <>
        <SettingsGroup boxRole="list" data-mcp-templates>
          {MCP_TEMPLATES.map((template) => <SettingsListRow key={template.key} data-mcp-template={template.key} disabled={disabled}
            icon={<McpServerIcon transport={transportOf(template.definition as Record<string, unknown>)} />}
            title={localizedText(template.title, locale)} subtitle={localizedText(template.description, locale)} openLabel={localizedText(template.title, locale)}
            badges={names.some((name) => name.toLowerCase() === template.name) ? <SettingsBadge tone="success">{t('settings.models.presets.added')}</SettingsBadge> : null}
            onOpen={() => onTemplate(template, scope)} />)}
        </SettingsGroup>
        <SettingsGroup title={t('settings.mcp.page.blank')} boxRole="list" footer={t('settings.mcp.page.templatesCredit')}>
          {(['stdio', 'http'] as const).map((transport) => <SettingsListRow key={transport} data-mcp-blank={transport} disabled={disabled}
            icon={<span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">{transport === 'http' ? <TbWorld className="size-5" aria-hidden /> : <TbTerminal2 className="size-5" aria-hidden />}</span>}
            title={t(`settings.mcp.page.blank.${transport}` as MessageKey)} subtitle={t(transport === 'http' ? 'settings.mcp.page.transportHttpHint' : 'settings.mcp.page.transportStdioHint')}
            openLabel={t(`settings.mcp.page.blank.${transport}` as MessageKey)} onOpen={() => onBlank(transport, scope)} />)}
        </SettingsGroup>
      </> : <div className="space-y-3">
        <Textarea value={text} autoFocus spellCheck={false} aria-label={t('settings.mcp.paste.label')} placeholder={t('settings.mcp.paste.placeholder')}
          onChange={(event) => { setText(event.target.value); setDeselected(new Set()) }}
          className="scroll-slim min-h-40 resize-y rounded-[12px] bg-surface-inset p-3 font-mono text-caption leading-relaxed dark:bg-black/20" />
        {text.trim() ? result && candidates.length ? <>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-2.5">
            <p className="text-caption text-muted-foreground" role="status">{t('settings.mcp.paste.found', { count: candidates.length, format: t(`settings.mcp.paste.format.${result.format}` as MessageKey) })}</p>
            {candidates.some((candidate) => names.some((name) => name.toLowerCase() === candidate.name.toLowerCase())) ? <McpClashSelect value={policy} onChange={setPolicy} /> : null}
          </div>
          <McpImportPreview candidates={candidates} selected={selected} existing={names} policy={policy}
            onToggle={(key, on) => setDeselected((current) => {
              const next = new Set(current)
              if (on) next.delete(key)
              else next.add(key)
              return next
            })} />
        </> : <p className="px-2.5 text-caption text-destructive" role="alert">{t('settings.mcp.paste.unrecognized')}</p> : null}
      </div>}
    </div>
  </SettingsSheet>
}
