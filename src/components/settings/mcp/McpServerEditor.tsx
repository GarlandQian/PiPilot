import * as React from 'react'
import { parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser'
import { TbAdjustments, TbLock, TbTerminal2, TbTrash, TbWorld } from 'react-icons/tb'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useLocale, useT, type MessageKey } from '@/i18n'
import { cn } from '@/lib/utils'
import { MCP_EXPOSURES } from '@/shared/mcp-config'
import { isMcpServerOverride, validateMcpServerDefinition } from '@/shared/mcp-config-parser'
import { localizedText } from '@/shared/model-provider-presets'
import type { McpTemplate } from '@/shared/mcp-templates'
import { useConfigurationEditTransaction } from '@/store/configuration-documents'
import { JsonEditor, OutboundLink, RecordRowsEditor } from '../editor-page'
import { FormActions, SettingsBadge, SettingsDisclosure, SettingsField, SettingsGroup, SettingsIdentity, SettingsPage, SettingsRow } from '../kit'
import { isRecord, withField, type JsonRecord } from '../models/provider-editor-model'
import {
  argsFromLines, hasMcpIssues, maskMcpSecrets, mcpEditorIssues, preparedMcpDefinition, preservedFields, restoreMcpSecrets, transportOf, withTransport, type McpTransport,
} from './mcp-editor-model'
import type { McpManager } from './useMcpManager'

export interface McpEditorTarget {
  /** The name it is saved under; null while adding. */
  previousName: string | null
  name: string
  definition: JsonRecord
  template?: McpTemplate | null
}

export function McpServerIcon({ transport, className }: { transport: McpTransport | 'override'; className?: string }) {
  const Icon = transport === 'override' ? TbAdjustments : transport === 'http' ? TbWorld : TbTerminal2
  return <span aria-hidden style={{ backgroundColor: transport === 'http' ? '#2f9e8f' : '#5b6b84' }}
    className={cn('flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-[linear-gradient(to_bottom,rgb(255_255_255/0.18),transparent)] text-white shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.08)]', className)}>
    <Icon className="size-[58%] stroke-[2]" />
  </span>
}

const format = (definition: JsonRecord) => `${JSON.stringify(maskMcpSecrets(definition), null, 2)}\n`

export function McpServerEditor({ manager, target, takenNames, onDone, onCancel, onDirtyChange }: {
  manager: McpManager
  target: McpEditorTarget
  /** Names other servers in this file already use. */
  takenNames: readonly string[]
  onDone(result: { name: string }): void
  onCancel(): void
  onDirtyChange(dirty: boolean): void
}) {
  const t = useT()
  const locale = useLocale()
  const [name, setName] = React.useState(target.name)
  const [definition, setDefinitionState] = React.useState<JsonRecord>(target.definition)
  const [stash, setStash] = React.useState<JsonRecord>({})
  const [argsText, setArgsText] = React.useState(() => (Array.isArray(target.definition.args) ? target.definition.args.filter((arg): arg is string => typeof arg === 'string') : []).join('\n'))
  const [timeoutText, setTimeoutText] = React.useState(typeof target.definition.timeout === 'number' ? String(target.definition.timeout) : '')
  const [jsonOpen, setJsonOpen] = React.useState(false)
  const [jsonText, setJsonText] = React.useState(() => format(target.definition))
  const [jsonError, setJsonError] = React.useState<string | undefined>()
  const [showIssues, setShowIssues] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [removeOpen, setRemoveOpen] = React.useState(false)
  const source = React.useRef<'form' | 'json'>('form')

  const transport = transportOf(definition)
  const override = manager.target.kind === 'project' && isMcpServerOverride(definition)
  const editing = target.previousName !== null
  const update = (next: (current: JsonRecord) => JsonRecord) => {
    source.current = 'form'
    setJsonError(undefined)
    setDefinitionState(next)
  }
  React.useEffect(() => {
    if (source.current === 'form') setJsonText(format(definition))
  }, [definition])

  const prepared = React.useMemo(() => preparedMcpDefinition(definition), [definition])
  const piMessage = React.useMemo(() => name.trim() ? validateMcpServerDefinition(name.trim(), prepared, manager.target.kind) : null, [name, prepared, manager.target.kind])
  const issues = mcpEditorIssues(name, definition, takenNames, piMessage, jsonError, manager.target.kind)
  const visible = showIssues ? issues : { ...issues, name: issues.name === 'required' ? undefined : issues.name, command: undefined, url: issues.url === 'invalid' ? issues.url : undefined, pi: undefined }
  const fingerprint = (candidateName: string, candidate: JsonRecord) => JSON.stringify([candidateName.trim(), preparedMcpDefinition(candidate)])
  const dirty = jsonError !== undefined || fingerprint(name, definition) !== fingerprint(target.name, target.definition)
  React.useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  const preserved = preservedFields(definition)
  const template = target.template
  const title = template ? localizedText(template.title, locale) : name.trim() || t('settings.mcp.page.newServer')

  const setTransport = (next: McpTransport) => {
    if (next === transport) return
    const result = withTransport(definition, next, stash)
    setStash(result.stash)
    update(() => result.definition)
    if (next === 'stdio') setArgsText((Array.isArray(result.definition.args) ? result.definition.args : []).filter((arg): arg is string => typeof arg === 'string').join('\n'))
  }

  const onJson = (text: string) => {
    source.current = 'json'
    setJsonText(text)
    const errors: ParseError[] = []
    const value: unknown = parseJsonc(text, errors, { allowTrailingComma: true })
    if (errors.length || !isRecord(value)) {
      setJsonError(errors.length ? t('settings.models.editor.jsonInvalid', { message: printParseErrorCode(errors[0]!.error) }) : t('settings.mcp.page.jsonNotObject'))
      return
    }
    setJsonError(undefined)
    const next = restoreMcpSecrets(value, definition)
    setDefinitionState(next)
    setArgsText((Array.isArray(next.args) ? next.args : []).filter((arg): arg is string => typeof arg === 'string').join('\n'))
    setTimeoutText(typeof next.timeout === 'number' ? String(next.timeout) : '')
  }

  const save = async () => {
    if (hasMcpIssues(issues)) {
      setShowIssues(true)
      if (issues.json) setJsonOpen(true)
      setError(t('settings.models.editor.fixIssues'))
      return
    }
    setSaving(true)
    setError(null)
    const saved = await manager.saveServer(target.previousName, name.trim(), prepared)
    setSaving(false)
    if (saved) onDone({ name: name.trim() })
    else setError(t('settings.mcp.saveFailed'))
  }

  useConfigurationEditTransaction(true, {
    dirty,
    revision: jsonText + name,
    commit: () => {
      if (hasMcpIssues(issues)) {
        setShowIssues(true)
        return false
      }
      try {
        return manager.updateDraft(manager.draftWithServer(target.previousName, name.trim(), prepared))
      } catch {
        return false
      }
    },
  })

  const remove = async () => {
    if (!target.previousName) return
    setSaving(true)
    const removed = await manager.removeServer(target.previousName)
    setSaving(false)
    if (removed) onDone({ name: target.previousName })
    else setError(t('settings.mcp.saveFailed'))
  }

  const env = isRecord(definition.env) ? definition.env : {}
  const headers = isRecord(definition.headers) ? definition.headers : {}
  const exposure = typeof definition.exposure === 'string' ? definition.exposure : 'codemode'
  const rowLabels = {
    add: t('mcp.form.rows.add'), remove: t('mcp.form.rows.remove'), name: t('settings.mcp.page.variableName'),
    value: t('settings.mcp.page.variableValue'), notText: t('settings.models.editor.headerJsonOnly'),
  }

  const scopeLabel = manager.target.kind === 'project' ? t('settings.packages.project') : t('settings.integrations.scope.global')

  return <SettingsPage data-mcp-server-editor={target.previousName ?? 'new'}>
    <SettingsIdentity icon={<McpServerIcon transport={override ? 'override' : transport} className="size-12 rounded-[13px]" />} title={title} data-mcp-editor-header
      subtitle={<span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {manager.target.kind === 'project' ? <SettingsBadge tone="accent">{scopeLabel}</SettingsBadge> : <span>{scopeLabel}</span>}
        <span>{override ? t('settings.mcp.page.overrideDescription') : template ? localizedText(template.description, locale) : t(transport === 'http' ? 'settings.mcp.page.transportHttpHint' : 'settings.mcp.page.transportStdioHint')}</span>
      </span>}
      actions={template?.docs ? <OutboundLink href={template.docs}>{t('settings.mcp.page.docs')}</OutboundLink> : undefined} />

    {manager.writesBlocked ? <p className="rounded-[12px] bg-warning/10 px-3.5 py-2.5 text-caption" role="alert">{t('settings.mcp.extensionMigrationBlocked')}</p> : null}

    <SettingsGroup title={t('settings.mcp.page.server')}>
      <SettingsField label={t('mcp.form.name')} htmlFor="mcp-editor-name" info={editing ? t('settings.mcp.page.nameLocked') : t('settings.mcp.page.nameHint')}
        error={visible.name ? t(visible.name === 'required' ? 'mcp.form.name.required' : visible.name === 'taken' ? 'mcp.form.name.duplicate' : 'mcp.form.name.invalid') : undefined}>
        <div className="relative">
          <Input id="mcp-editor-name" value={name} disabled={editing} spellCheck={false} autoComplete="off" className="font-mono" placeholder="filesystem"
            aria-invalid={Boolean(visible.name) || undefined} aria-describedby="mcp-editor-name-feedback" onChange={(event) => setName(event.target.value)} />
          {editing ? <TbLock className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden /> : null}
        </div>
      </SettingsField>
      {!override ? <>
        <SettingsRow label={t('settings.mcp.page.transport')} info={t(transport === 'http' ? 'settings.mcp.page.transportHttpHint' : 'settings.mcp.page.transportStdioHint')}>
          <div className="mac-segmented max-w-full" role="radiogroup" aria-label={t('settings.mcp.page.transport')}>
            {(['stdio', 'http'] as const).map((candidate) => <button key={candidate} type="button" role="radio" aria-checked={transport === candidate} aria-pressed={transport === candidate}
              className="outline-none focus-visible:focus-ring" onClick={() => setTransport(candidate)}>{t(`settings.mcp.page.transport.${candidate}`)}</button>)}
          </div>
        </SettingsRow>
        {transport === 'stdio' ? <>
          <SettingsField label={t('mcp.form.command')} htmlFor="mcp-editor-command" info={t('settings.mcp.page.commandHint')} error={visible.command ? t('mcp.form.command.required') : undefined}>
            <Input id="mcp-editor-command" value={typeof definition.command === 'string' ? definition.command : ''} spellCheck={false} autoComplete="off" className="font-mono" placeholder="npx"
              aria-invalid={Boolean(visible.command) || undefined} aria-describedby="mcp-editor-command-feedback"
              onChange={(event) => update((current) => withField(current, 'command', event.target.value))} />
          </SettingsField>
          <SettingsField label={t('mcp.form.args')} htmlFor="mcp-editor-args" info={t(template?.needs === 'folders' ? 'settings.mcp.page.argsFoldersHint' : 'settings.mcp.page.argsHint')}>
            <Textarea id="mcp-editor-args" value={argsText} spellCheck={false} rows={Math.min(8, Math.max(2, argsText.split('\n').length + 1))}
              className="min-h-0 resize-y font-mono text-caption" placeholder={'-y\n@modelcontextprotocol/server-filesystem'}
              onChange={(event) => {
                setArgsText(event.target.value)
                const args = argsFromLines(event.target.value)
                update((current) => withField(current, 'args', args.length ? args : undefined))
              }} />
          </SettingsField>
          <SettingsField label={t('mcp.form.env')} info={t('settings.mcp.page.envHint')}>
            <RecordRowsEditor record={env} labels={{ ...rowLabels, namePlaceholder: 'API_KEY' }} onChange={(record) => update((current) => withField(current, 'env', record))} />
          </SettingsField>
          <SettingsField label={t('mcp.form.cwd')} htmlFor="mcp-editor-cwd" info={t('settings.mcp.page.cwdHint')}>
            <Input id="mcp-editor-cwd" value={typeof definition.cwd === 'string' ? definition.cwd : ''} spellCheck={false} className="font-mono" placeholder={t('mcp.form.cwd.placeholder')}
              onChange={(event) => update((current) => withField(current, 'cwd', event.target.value || undefined))} />
          </SettingsField>
        </> : <>
          <SettingsField label={t('mcp.form.url')} htmlFor="mcp-editor-url" info={t('settings.mcp.page.urlHint')}
            error={visible.url ? t(visible.url === 'required' ? 'mcp.form.url.required' : 'mcp.form.url.invalid') : undefined}>
            <Input id="mcp-editor-url" value={typeof definition.url === 'string' ? definition.url : ''} spellCheck={false} autoComplete="off" className="font-mono" placeholder={t('mcp.form.url.placeholder')}
              aria-invalid={Boolean(visible.url) || undefined} aria-describedby="mcp-editor-url-feedback"
              onChange={(event) => update((current) => withField(current, 'url', event.target.value))} />
          </SettingsField>
          <SettingsField label={t('mcp.form.headers')} info={t(template?.needs === 'token' ? 'settings.mcp.page.tokenHint' : 'settings.mcp.page.headersHint')}
            hint={t('settings.mcp.page.oauthHint')}>
            <RecordRowsEditor record={headers} labels={{ ...rowLabels, name: t('settings.models.editor.headerName'), namePlaceholder: 'Authorization' }}
              onChange={(record) => update((current) => withField(current, 'headers', record))} />
          </SettingsField>
        </>}
      </> : null}
    </SettingsGroup>

    {!override ? <SettingsGroup title={t('settings.mcp.page.piOptions')}>
      <SettingsRow label={t('mcp.form.enabled')} info={t('settings.mcp.page.enabledHint')}>
        <Switch aria-label={t('mcp.form.enabled')} checked={definition.enabled !== false} onCheckedChange={(checked) => update((current) => withField(current, 'enabled', checked ? undefined : false))} />
      </SettingsRow>
      <SettingsRow label={t('mcp.form.exposure')} htmlFor="mcp-editor-exposure" info={t(`settings.mcp.page.exposureHint.${MCP_EXPOSURES.includes(exposure as never) ? exposure : 'codemode'}` as MessageKey)}>
        <select id="mcp-editor-exposure" className="mac-select" value={exposure} aria-label={t('mcp.form.exposure')}
          onChange={(event) => update((current) => withField(current, 'exposure', event.target.value === 'codemode' ? undefined : event.target.value))}>
          {MCP_EXPOSURES.map((value) => <option key={value} value={value}>{t(`mcp.form.exposure.${value}` as MessageKey)}</option>)}
        </select>
      </SettingsRow>
      <SettingsField label={t('mcp.form.timeout')} htmlFor="mcp-editor-timeout" info={t('settings.mcp.page.timeoutHint')} error={issues.timeout ? t('mcp.form.timeout.invalid') : undefined}>
        <Input id="mcp-editor-timeout" inputMode="decimal" value={timeoutText} placeholder="60" className="w-32 font-mono tabular-nums" aria-invalid={Boolean(issues.timeout) || undefined}
          onChange={(event) => {
            setTimeoutText(event.target.value)
            const value = event.target.value.trim()
            update((current) => withField(current, 'timeout', value === '' ? undefined : Number(value)))
          }} />
      </SettingsField>
      <SettingsField label={t('mcp.form.description')} htmlFor="mcp-editor-description" info={t('mcp.form.description.hint')}>
        <Input id="mcp-editor-description" value={typeof definition.description === 'string' ? definition.description : ''} placeholder={t('mcp.form.description.placeholder')}
          onChange={(event) => update((current) => withField(current, 'description', event.target.value || undefined))} />
      </SettingsField>
    </SettingsGroup> : null}

    {visible.pi ? <p className="rounded-[12px] bg-destructive/8 px-3.5 py-2.5 text-caption text-destructive" role="alert">{visible.pi}</p> : null}

    {override ? <SettingsGroup title={t('settings.models.editor.json')} info={t('settings.mcp.page.overrideJsonHint')}>
      <div data-settings-row className="px-3 py-2.5"><JsonEditor id="mcp-editor-json" value={jsonText} onChange={onJson} error={jsonError} label={t('settings.models.editor.json')} /></div>
    </SettingsGroup> : <SettingsGroup>
      <SettingsDisclosure label={<span className="flex items-center gap-2">{t('settings.models.editor.json')}{preserved.length ? <SettingsBadge>{t('settings.mcp.page.preservedCount', { count: preserved.length })}</SettingsBadge> : null}</span>}
        open={jsonOpen} onOpenChange={setJsonOpen}>
        <div data-settings-row className="space-y-1.5 px-3 py-2.5">
          <p className="text-caption leading-snug text-muted-foreground">{preserved.length ? t('settings.mcp.page.jsonPreserved', { names: preserved.join(', ') }) : t('settings.mcp.page.jsonDescription')}</p>
          <JsonEditor id="mcp-editor-json" value={jsonText} onChange={onJson} error={jsonError} label={t('settings.models.editor.json')} />
        </div>
      </SettingsDisclosure>
    </SettingsGroup>}

    <FormActions onCancel={onCancel} onSave={() => void save()} saving={saving} canSave={(dirty || !editing) && !manager.writesBlocked} error={error}
      leading={editing ? <Button variant="ghost" className="text-destructive" disabled={saving || manager.writesBlocked} onClick={() => setRemoveOpen(true)}><TbTrash aria-hidden />{t(override ? 'settings.mcp.page.removeOverride' : 'settings.mcp.removeServer')}</Button> : null} />

    <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(override ? 'settings.mcp.page.removeOverrideConfirm' : 'settings.mcp.removeConfirm', { name: target.previousName ?? '' })}</AlertDialogTitle>
          <AlertDialogDescription>{t(override ? 'settings.mcp.page.removeOverrideDescription' : 'settings.mcp.page.removeDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void remove()}>{t(override ? 'settings.mcp.page.removeOverride' : 'settings.mcp.removeServer')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </SettingsPage>
}
