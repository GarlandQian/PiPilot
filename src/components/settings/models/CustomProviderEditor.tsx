import * as React from 'react'
import { parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser'
import { TbCloudDownload, TbLoader2, TbPlus, TbSparkles, TbTrash } from 'react-icons/tb'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useLocale, useT, type MessageKey } from '@/i18n'
import { useConfigurationEditTransaction } from '@/store/configuration-documents'
import type { ModelCatalogDetails } from '@/shared/model-catalog'
import { isLocalAddress, type PresetMatch } from '@/shared/model-provider-presets'
import { ModelsApiTypeSelect } from './ApiTypeSelect'
import type { ModelsManager } from '../useModelsManager'
import { ApiKeyLink, EditorDisclosure, EditorField, EditorFooter, EditorSection, JsonEditor, SecretInput, type TestState , RecordRowsEditor } from '../editor-page'
import { PresetBar } from './PresetBar'
import { ModelRowEditor } from './ModelRowEditor'
import { RemoteModelsDialog } from './RemoteModelsDialog'
import {
  definitionFromEditor, editorFromDefinition, editorIssues, fillFromDetails, hasIssues, isLiteralSecret, isRecord, maskSecrets,
  MASKED_SECRET, newRowKey, restoreSecrets, rowsFromModels, stringField, validEndpoint, withField, type JsonRecord, type ModelRow, type ProviderEditorState,
} from './provider-editor-model'

export interface CustomEditorTarget {
  /** The ID it is saved under; null while adding. */
  previousId: string | null
  id: string
  definition: JsonRecord
  preset?: PresetMatch | null
  /** Fill in what the catalog knows about each model as soon as it opens. */
  fill?: boolean
}

type CompatChoice = 'auto' | string

const COMPAT_FLAGS = ['supportsStore', 'supportsDeveloperRole', 'supportsReasoningEffort'] as const
const THINKING_FORMATS = ['openai', 'deepseek', 'qwen', 'zai', 'openrouter', 'together', 'chat-template', 'qwen-chat-template', 'string-thinking'] as const

/** The few compatibility switches people need for OpenAI-compatible endpoints; the rest stay in JSON. */
function CompatEditor({ compat, onChange }: { compat: unknown; onChange(compat: JsonRecord | undefined): void }) {
  const t = useT()
  const record = isRecord(compat) ? compat : {}
  const set = (key: string, value: unknown) => {
    const next = withField(record, key, value)
    onChange(Object.keys(next).length ? next : undefined)
  }
  const choice = (key: string): CompatChoice => record[key] === undefined ? 'auto' : String(record[key])
  const others = Object.keys(record).filter((key) => !(COMPAT_FLAGS as readonly string[]).includes(key) && key !== 'maxTokensField' && key !== 'thinkingFormat')
  const row = (key: string, label: string, options: readonly { value: string; label: string }[], toValue: (value: string) => unknown) =>
    <div key={key} className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <span className="min-w-0 text-caption">{label}<span className="ml-2 font-mono text-micro text-muted-foreground">{key}</span></span>
      <Select value={choice(key)} onValueChange={(value) => set(key, value === 'auto' ? undefined : toValue(value))}>
        <SelectTrigger size="sm" className="w-44" aria-label={label}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">{t('settings.models.editor.compatAuto')}</SelectItem>
          {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          {choice(key) !== 'auto' && !options.some((option) => option.value === choice(key)) ? <SelectItem value={choice(key)}>{choice(key)}</SelectItem> : null}
        </SelectContent>
      </Select>
    </div>
  const yesNo = [{ value: 'true', label: t('settings.models.editor.compatYes') }, { value: 'false', label: t('settings.models.editor.compatNo') }]
  return <div className="min-w-0 space-y-2.5">
    {COMPAT_FLAGS.map((key) => row(key, t(`settings.models.editor.compat.${key}` as MessageKey), yesNo, (value) => value === 'true'))}
    {row('maxTokensField', t('settings.models.editor.compat.maxTokensField'), [{ value: 'max_tokens', label: 'max_tokens' }, { value: 'max_completion_tokens', label: 'max_completion_tokens' }], (value) => value)}
    {row('thinkingFormat', t('settings.models.editor.compat.thinkingFormat'), THINKING_FORMATS.map((value) => ({ value, label: value })), (value) => value)}
    <p className="text-micro leading-relaxed text-muted-foreground">{others.length
      ? t('settings.models.editor.compatOthers', { names: others.join(', ') })
      : t('settings.models.editor.compatHint')}</p>
  </div>
}

function formatJson(state: ProviderEditorState) {
  return `${JSON.stringify(maskSecrets(definitionFromEditor(state)), null, 2)}\n`
}

export function CustomProviderEditor({ manager, target, takenIds, builtinIds, onVersion, onChangePreset, onDone, onCancel, onDirtyChange }: {
  manager: ModelsManager
  target: CustomEditorTarget
  /** IDs other providers in models.json already use. */
  takenIds: readonly string[]
  /** Pi's own provider IDs: a models.json entry with one of them changes that provider. */
  builtinIds: ReadonlySet<string>
  onVersion?(key: string): void
  onChangePreset?(): void
  onDone(result: { id: string; notice?: string }): void
  onCancel(): void
  onDirtyChange(dirty: boolean): void
}) {
  const t = useT()
  const locale = useLocale()
  const numberFormat = React.useMemo(() => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }), [locale])
  const snapshot = manager.snapshot
  const holdsDefault = Boolean(target.previousId && snapshot?.defaultProvider === target.previousId)
  const [initial] = React.useState(() => editorFromDefinition(target.id, target.definition, holdsDefault ? snapshot?.defaultModel : undefined))
  const [editor, setEditor] = React.useState(initial)
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => new Set())
  const [focusKey, setFocusKey] = React.useState<string | null>(null)
  const [tests, setTests] = React.useState<Readonly<Record<string, TestState>>>({})
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [jsonOpen, setJsonOpen] = React.useState(false)
  const [jsonText, setJsonText] = React.useState(() => formatJson(initial))
  const [jsonError, setJsonError] = React.useState<string | undefined>()
  const [remoteOpen, setRemoteOpen] = React.useState(false)
  const [filling, setFilling] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [showIssues, setShowIssues] = React.useState(false)
  const [removeOpen, setRemoveOpen] = React.useState(false)
  const source = React.useRef<'form' | 'json'>('form')
  const editorRef = React.useRef(editor)
  editorRef.current = editor

  const update = (next: (current: ProviderEditorState) => ProviderEditorState) => {
    source.current = 'form'
    setJsonError(undefined)
    setEditor(next)
  }
  React.useEffect(() => {
    if (source.current === 'form') setJsonText(formatJson(editor))
  }, [editor])

  const provider = editor.provider
  const baseUrl = stringField(provider, 'baseUrl')
  const apiKey = stringField(provider, 'apiKey')
  const api = stringField(provider, 'api')
  const local = isLocalAddress(baseUrl)
  const issues = editorIssues(editor, takenIds, jsonError)
  const visibleIssues = showIssues ? issues : { ...issues, id: issues.id === 'taken' || issues.id === 'invalid' ? issues.id : undefined, baseUrl: issues.baseUrl === 'invalid' ? issues.baseUrl : undefined, models: Object.fromEntries(Object.entries(issues.models).filter(([, issue]) => issue === 'duplicate')) }
  const defaultRow = editor.models.find((row) => row.key === editor.defaultKey)
  const fingerprint = (state: ProviderEditorState) => JSON.stringify([state.id.trim(), definitionFromEditor(state), state.models.find((row) => row.key === state.defaultKey)?.raw.id ?? null])
  const dirty = jsonError !== undefined || fingerprint(editor) !== fingerprint(initial)
  React.useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])

  const preset = target.preset
  const apiKeyUrl = preset?.exact ? preset.version.apiKeyUrl : undefined
  const title = stringField(provider, 'name') || editor.id || t('settings.models.editor.newProvider')

  /* --------------------------- models --------------------------- */

  const setRow = (key: string, raw: JsonRecord) => update((current) => ({ ...current, models: current.models.map((row) => row.key === key ? { ...row, raw } : row) }))

  const lookup = async (ids: readonly string[]): Promise<Record<string, ModelCatalogDetails | null>> => {
    if (!manager.adapter || !ids.length) return {}
    try {
      const result = await manager.adapter.lookupCatalog({ baseUrl: stringField(editorRef.current.provider, 'baseUrl'), ids: [...ids] })
      return Object.fromEntries(result.models.map((model) => [model.id, model.details]))
    } catch {
      return {}
    }
  }

  /** Fill each row (or only `keys`) with what the catalog and models.dev know; never overwrite. */
  const fillRows = async (keys?: ReadonlySet<string>, remoteNames: Readonly<Record<string, string>> = {}) => {
    const rows = editorRef.current.models.filter((row) => (!keys || keys.has(row.key)) && stringField(row.raw, 'id').trim())
    if (!rows.length) return 0
    const details = await lookup(rows.map((row) => stringField(row.raw, 'id').trim()))
    // Rows may have been edited meanwhile: fill each as it is now, missing fields only.
    const fill = (row: ModelRow) => {
      if (keys && !keys.has(row.key)) return row
      const id = stringField(row.raw, 'id').trim()
      if (!id || !(id in details || remoteNames[id])) return row
      const filled = fillFromDetails(row.raw, details[id], remoteNames[id])
      return JSON.stringify(filled) === JSON.stringify(row.raw) ? row : { ...row, raw: filled }
    }
    const changed = editorRef.current.models.filter((row) => fill(row) !== row).length
    if (changed) update((current) => ({ ...current, models: current.models.map(fill) }))
    return changed
  }

  const fillAll = async () => {
    setFilling(true)
    setNotice(null)
    try {
      const changed = await fillRows()
      setNotice(changed ? t('settings.models.editor.filled', { count: changed }) : t('settings.models.editor.nothingToFill'))
    } finally {
      setFilling(false)
    }
  }

  React.useEffect(() => {
    if (target.fill) void fillAll()
    // Runs once, for the provider it was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** The first model of the very first provider becomes the default by itself. */
  const noDefaultYet = !snapshot?.defaultModel

  const addManual = () => {
    const key = newRowKey()
    update((current) => ({ ...current, models: [...current.models, { key, originalId: null, raw: { id: '' } }], defaultKey: current.defaultKey ?? (noDefaultYet ? key : null) }))
    setExpanded((current) => new Set([...current, key]))
    setFocusKey(key)
  }

  const addRemote = (models: readonly { id: string; name?: string }[]) => {
    setRemoteOpen(false)
    const known = new Set(editor.models.map((row) => stringField(row.raw, 'id')))
    const added: ModelRow[] = models.filter((model) => !known.has(model.id)).map((model) => ({ key: newRowKey(), originalId: null, raw: { id: model.id } }))
    if (!added.length) return
    update((current) => ({ ...current, models: [...current.models, ...added], defaultKey: current.defaultKey ?? (noDefaultYet ? added[0]!.key : null) }))
    const names = Object.fromEntries(models.filter((model) => model.name).map((model) => [model.id, model.name!]))
    void fillRows(new Set(added.map((row) => row.key)), names).then(() => setNotice(t('settings.models.editor.added', { count: added.length })))
  }

  const removeRow = (key: string) => update((current) => ({ ...current, models: current.models.filter((row) => row.key !== key), defaultKey: current.defaultKey === key ? null : current.defaultKey }))

  const testRow = async (row: ModelRow) => {
    const modelId = stringField(row.raw, 'id').trim()
    if (!modelId) return
    let content: string
    try {
      content = manager.draftWithProvider({ previousId: target.previousId, id: editor.id.trim(), definition: definitionFromEditor(editor) })
    } catch {
      setTests((current) => ({ ...current, [row.key]: { state: 'error', message: t('settings.models.editor.fixBeforeTest') } }))
      return
    }
    setTests((current) => ({ ...current, [row.key]: { state: 'testing' } }))
    try {
      const result = await manager.testModel(content, editor.id.trim(), modelId)
      setTests((current) => ({ ...current, [row.key]: { state: 'success', latencyMs: result.latencyMs, preview: result.responsePreview } }))
    } catch (caught) {
      setTests((current) => ({ ...current, [row.key]: { state: 'error', message: caught instanceof Error && caught.message ? caught.message : t('settings.models.testFailed') } }))
    }
  }

  /* ---------------------------- JSON ---------------------------- */

  const onJson = (text: string) => {
    source.current = 'json'
    setJsonText(text)
    const errors: ParseError[] = []
    const value: unknown = parseJsonc(text, errors, { allowTrailingComma: true, disallowComments: false })
    if (errors.length || !isRecord(value)) {
      setJsonError(errors.length ? t('settings.models.editor.jsonInvalid', { message: printParseErrorCode(errors[0]!.error) }) : t('settings.models.editor.jsonNotObject'))
      return
    }
    setJsonError(undefined)
    setEditor((current) => {
      const restored = restoreSecrets(value, definitionFromEditor(current))
      const { models, ...rest } = restored
      const rows = rowsFromModels(models, current.models)
      return { ...current, provider: rest, models: rows, hadModels: Array.isArray(models), defaultKey: rows.some((row) => row.key === current.defaultKey) ? current.defaultKey : null }
    })
  }

  /* ---------------------------- save ---------------------------- */

  const prepared = () => {
    let definition = definitionFromEditor(editor)
    definition = withField(definition, 'baseUrl', stringField(definition, 'baseUrl').trim().replace(/\/+$/u, '') || undefined)
    if (!stringField(definition, 'name').trim()) definition = withField(definition, 'name', undefined)
    // Pi lists a provider's models only when it has some key; a local server ignores it.
    if (!stringField(definition, 'apiKey') && local) definition = withField(definition, 'apiKey', 'local')
    if (Array.isArray(definition.models)) definition.models = definition.models.map((model) => isRecord(model) && typeof model.id === 'string' ? { ...model, id: model.id.trim() } : model)
    return definition
  }

  const save = async () => {
    if (hasIssues(issues)) {
      setShowIssues(true)
      if (issues.id) setAdvancedOpen(true)
      if (issues.json) setJsonOpen(true)
      setExpanded((current) => new Set([...current, ...Object.keys(issues.models)]))
      setError(t('settings.models.editor.fixIssues'))
      return
    }
    setSaving(true)
    setError(null)
    const id = editor.id.trim()
    const defaultModelId = defaultRow ? stringField(defaultRow.raw, 'id').trim() : null
    const initialDefault = initial.models.find((row) => row.key === initial.defaultKey)?.raw.id
    const result = await manager.saveProvider({
      previousId: target.previousId, id, definition: prepared(),
      defaultModelId: defaultModelId && (defaultModelId !== initialDefault || id !== target.previousId) ? defaultModelId : null,
    })
    setSaving(false)
    if (result === 'failed') {
      setError(t('settings.models.editor.saveFailed'))
      return
    }
    onDone({ id, notice: result === 'default-failed' ? t('settings.models.setDefaultFailed') : undefined })
  }

  // Quit with unsaved edits: the provider is written into the draft and saved with it.
  useConfigurationEditTransaction(true, {
    dirty,
    revision: jsonText,
    commit: () => {
      if (hasIssues(issues)) {
        setShowIssues(true)
        return false
      }
      try {
        return manager.updateDraft(manager.draftWithProvider({ previousId: target.previousId, id: editor.id.trim(), definition: prepared() }))
      } catch {
        return false
      }
    },
  })

  const remove = async () => {
    if (!target.previousId) return
    setSaving(true)
    const removed = await manager.removeProvider(target.previousId)
    setSaving(false)
    if (removed) onDone({ id: target.previousId })
    else setError(t('settings.models.editor.saveFailed'))
  }

  const idHint = builtinIds.has(editor.id.trim()) && editor.id.trim() !== target.previousId
    ? t('settings.models.editor.idOverridesBuiltin')
    : t(holdsDefault ? 'settings.models.editor.idHintDefault' : 'settings.models.editor.idHint')

  return <div className="min-w-0 space-y-6" data-models-custom-editor={target.previousId ?? 'new'}>
    <PresetBar preset={preset?.exact || target.previousId === null ? preset?.preset : null} version={preset?.exact ? preset.version : null}
      name={title} icon={preset?.preset.icon} onVersion={onVersion} onChange={onChangePreset}>
      {target.previousId && title !== target.previousId ? <p className="mt-0.5 break-all font-mono text-micro text-muted-foreground">{target.previousId}</p> : null}
    </PresetBar>

    <EditorSection title={t('settings.models.editor.connection')}>
      <div className="grid min-w-0 gap-4 @min-[640px]/settings-workspace:grid-cols-2">
        <EditorField label={t('settings.models.editor.name')} htmlFor="models-editor-name" hint={t('settings.models.editor.nameHint')}>
          <Input id="models-editor-name" value={stringField(provider, 'name')} placeholder={editor.id}
            onChange={(event) => update((current) => ({ ...current, provider: withField(current.provider, 'name', event.target.value || undefined) }))} />
        </EditorField>
        <EditorField label={t('settings.models.form.api')} htmlFor="models-editor-api" hint={t('settings.models.editor.apiHint')}>
          <ModelsApiTypeSelect id="models-editor-api" value={api} allowProviderDefault={builtinIds.has(editor.id.trim())}
            onChange={(value) => update((current) => ({ ...current, provider: withField(current.provider, 'api', value || undefined) }))} />
        </EditorField>
      </div>
      <EditorField label={t('settings.models.editor.baseUrl')} htmlFor="models-editor-url"
        error={visibleIssues.baseUrl ? t(visibleIssues.baseUrl === 'required' ? 'settings.models.editor.baseUrlRequired' : 'settings.models.editor.baseUrlInvalid') : undefined}
        hint={t('settings.models.editor.baseUrlHint')}>
        <Input id="models-editor-url" value={baseUrl} spellCheck={false} autoComplete="off" className="font-mono" placeholder="https://api.example.com/v1"
          aria-invalid={Boolean(visibleIssues.baseUrl) || undefined} aria-describedby="models-editor-url-feedback"
          onChange={(event) => update((current) => ({ ...current, provider: withField(current.provider, 'baseUrl', event.target.value || undefined) }))} />
      </EditorField>
      <EditorField label={<span className="flex flex-wrap items-center justify-between gap-2">{t('settings.models.form.apiKey')}<ApiKeyLink href={apiKeyUrl} /></span>}
        htmlFor="models-editor-key" hint={t(local ? 'settings.models.editor.apiKeyLocalHint' : 'settings.models.editor.apiKeyHint')}>
        <SecretInput id="models-editor-key" value={apiKey} describedBy="models-editor-key-feedback"
          placeholder={t(local ? 'settings.models.editor.apiKeyLocalPlaceholder' : 'settings.models.editor.apiKeyPlaceholder')}
          onChange={(value) => update((current) => ({ ...current, provider: withField(current.provider, 'apiKey', value || undefined) }))} />
      </EditorField>
    </EditorSection>

    <EditorSection title={t('settings.models.editor.models')}
      description={editor.models.length ? t('settings.models.editor.modelsCount', { count: editor.models.length }) : t('settings.models.editor.modelsDescription')}
      actions={<>
        <Button variant="outline" size="sm" disabled={!validEndpoint(baseUrl) || !manager.adapter} onClick={() => setRemoteOpen(true)}><TbCloudDownload aria-hidden />{t('settings.models.editor.fetchModels')}</Button>
        <Button variant="outline" size="sm" onClick={addManual}><TbPlus aria-hidden />{t('settings.models.editor.addManually')}</Button>
        <Button variant="ghost" size="sm" disabled={filling || editor.models.length === 0 || !manager.adapter} onClick={() => void fillAll()}>
          {filling ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <TbSparkles aria-hidden />}{t('settings.models.editor.fill')}
        </Button>
      </>}>
      {notice ? <p className="text-caption text-muted-foreground" role="status">{notice}</p> : null}
      {editor.models.length === 0 ? <p className="py-6 text-center text-caption leading-relaxed text-muted-foreground">{t(local ? 'settings.models.editor.noModelsLocal' : 'settings.models.editor.noModels')}</p>
        : <div className="-my-2 min-w-0">{editor.models.map((row) => <ModelRowEditor key={row.key} row={row} issue={visibleIssues.models[row.key]}
          expanded={expanded.has(row.key)} onExpandedChange={(open) => setExpanded((current) => {
            const next = new Set(current)
            if (open) next.add(row.key)
            else next.delete(row.key)
            return next
          })}
          isDefault={editor.defaultKey === row.key} onDefault={() => update((current) => ({ ...current, defaultKey: row.key }))}
          onChange={(raw) => setRow(row.key, raw)} onRemove={() => removeRow(row.key)}
          test={tests[row.key]} onTest={() => void testRow(row)} testDisabled={!manager.adapter}
          autoFocus={focusKey === row.key} onIdCommit={row.originalId === null ? () => void fillRows(new Set([row.key])) : undefined}
          numberFormat={numberFormat} />)}</div>}
      <p className="text-micro leading-relaxed text-muted-foreground">{t('settings.models.editor.modelsFootnote')}</p>
    </EditorSection>

    <div className="min-w-0 space-y-3">
      <EditorDisclosure title={t('settings.models.editor.advanced')} description={t('settings.models.editor.advancedDescription')} open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <EditorField label={t('settings.models.editor.providerId')} htmlFor="models-editor-id"
          error={visibleIssues.id ? t(`settings.models.editor.id.${visibleIssues.id}` as MessageKey) : undefined} hint={idHint}>
          <Input id="models-editor-id" value={editor.id} spellCheck={false} autoComplete="off" className="font-mono" aria-invalid={Boolean(visibleIssues.id) || undefined}
            aria-describedby="models-editor-id-feedback" onChange={(event) => update((current) => ({ ...current, id: event.target.value }))} />
        </EditorField>
        <EditorField label={t('settings.models.editor.headers')} hint={t('settings.models.editor.headersHint')}>
          <RecordRowsEditor record={isRecord(provider.headers) ? provider.headers : {}} labels={{
            add: t('settings.models.editor.addHeader'), remove: t('settings.models.editor.removeHeader'), name: t('settings.models.editor.headerName'),
            value: t('settings.models.editor.headerValue'), notText: t('settings.models.editor.headerJsonOnly'), namePlaceholder: 'Header',
          }} onChange={(headers) => update((current) => ({ ...current, provider: withField(current.provider, 'headers', headers) }))} />
        </EditorField>
        {!api || api === 'openai-completions' ? <EditorField label={t('settings.models.editor.compatibility')}>
          <CompatEditor compat={provider.compat} onChange={(compat) => update((current) => ({ ...current, provider: withField(current.provider, 'compat', compat) }))} />
        </EditorField> : null}
      </EditorDisclosure>
      <EditorDisclosure title={t('settings.models.editor.json')} open={jsonOpen} onOpenChange={setJsonOpen}
        description={isLiteralSecret(apiKey) || jsonText.includes(MASKED_SECRET) ? t('settings.models.editor.jsonMaskedDescription') : t('settings.models.editor.jsonDescription')}>
        <JsonEditor id="models-editor-json" value={jsonText} onChange={onJson} error={jsonError} label={t('settings.models.editor.json')} />
      </EditorDisclosure>
    </div>

    <EditorFooter onCancel={onCancel} onSave={() => void save()} saving={saving} canSave={dirty || target.previousId === null} error={error}
      leading={target.previousId ? <Button variant="ghost" className="mr-auto text-destructive" disabled={saving} onClick={() => setRemoveOpen(true)}><TbTrash aria-hidden />{t('settings.models.deleteProvider')}</Button> : null} />

    <RemoteModelsDialog open={remoteOpen} onOpenChange={setRemoteOpen} existingIds={editor.models.map((row) => stringField(row.raw, 'id'))}
      load={() => manager.adapter!.listRemote({ baseUrl: baseUrl.trim(), api: api || 'openai-completions', ...(isLiteralSecret(apiKey) ? { apiKey } : {}) })}
      onAdd={addRemote} />

    <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('settings.models.deleteProviderConfirm', { name: title })}</AlertDialogTitle>
          <AlertDialogDescription>{t('settings.models.deleteProviderConfirmDesc')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void remove()}>{t('settings.models.deleteProvider')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
}
