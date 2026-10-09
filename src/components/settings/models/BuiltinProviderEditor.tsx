import * as React from 'react'
import { TbCircleCheck, TbFlask, TbInfoCircle, TbLoader2, TbSearch, TbStar, TbStarFilled, TbTrash } from 'react-icons/tb'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLocale, useT } from '@/i18n'
import type { ModelCatalogEntry } from '@/shared/model-catalog'
import { localizedText, type PresetMatch } from '@/shared/model-provider-presets'
import type { BuiltinProvider } from '@/shared/models-config'
import type { ModelsManager } from '../useModelsManager'
import { ApiKeyLink, EditorField, EditorFooter, EditorSection, SecretInput, TestResultLine, type TestState } from '../editor-page'
import { PresetBar } from './PresetBar'

const PAGE = 60

/** Where Pi gets the key it uses now. */
export function builtinKeySource(provider: BuiltinProvider | undefined, t: ReturnType<typeof useT>) {
  if (!provider?.configured) return t('settings.models.builtin.noKey')
  if (provider.source === 'stored') return t('settings.models.builtin.keyStored')
  if (provider.source === 'environment') return t('settings.models.builtin.keyEnvironment', { name: provider.label ?? '' })
  return provider.label ? t('settings.models.builtin.keyOther', { source: provider.label }) : t('settings.models.builtin.keyConfigured')
}

export function BuiltinProviderEditor({ manager, providerId, preset, isNew, onVersion, onChangePreset, onDone, onCancel, onDirtyChange }: {
  manager: ModelsManager
  providerId: string
  preset?: PresetMatch | null
  isNew: boolean
  onVersion?(key: string): void
  onChangePreset?(): void
  onDone(result: { id: string; notice?: string }): void
  onCancel(): void
  onDirtyChange(dirty: boolean): void
}) {
  const t = useT()
  const locale = useLocale()
  const numberFormat = React.useMemo(() => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }), [locale])
  const provider = manager.builtin.providers.find((candidate) => candidate.id === providerId)
  const snapshot = manager.snapshot
  const currentDefault = snapshot?.defaultProvider === providerId ? snapshot.defaultModel : undefined
  const [key, setKey] = React.useState('')
  const [defaultModel, setDefaultModel] = React.useState<string | undefined>(currentDefault)
  const [catalog, setCatalog] = React.useState<{ state: 'loading' } | { state: 'ready'; models: ModelCatalogEntry[] } | { state: 'error' }>({ state: 'loading' })
  const [query, setQuery] = React.useState('')
  const [limit, setLimit] = React.useState(PAGE)
  const [tests, setTests] = React.useState<Readonly<Record<string, TestState>>>({})
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [removeOpen, setRemoveOpen] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    setCatalog({ state: 'loading' })
    manager.adapter?.providerCatalog(providerId)
      .then((result) => { if (!cancelled) setCatalog({ state: 'ready', models: result.models }) })
      .catch(() => { if (!cancelled) setCatalog({ state: 'error' }) })
    return () => { cancelled = true }
  }, [manager.adapter, providerId])

  const dirty = key.trim() !== '' || defaultModel !== currentDefault
  React.useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])

  const name = provider?.name ?? (preset ? localizedText(preset.preset.name, locale) : providerId)
  const models = catalog.state === 'ready' ? catalog.models : []
  const words = query.trim().toLowerCase().split(/\s+/u).filter(Boolean)
  const visible = models.filter((model) => words.every((word) => `${model.id} ${model.name ?? ''}`.toLowerCase().includes(word)))
  const canTest = Boolean(provider?.configured) && key.trim() === ''
  const canSave = dirty && (Boolean(provider?.configured) || key.trim() !== '')

  const test = async (modelId: string) => {
    setTests((current) => ({ ...current, [modelId]: { state: 'testing' } }))
    try {
      const result = await manager.testModel(manager.draftText, providerId, modelId)
      setTests((current) => ({ ...current, [modelId]: { state: 'success', latencyMs: result.latencyMs, preview: result.responsePreview } }))
    } catch (caught) {
      setTests((current) => ({ ...current, [modelId]: { state: 'error', message: caught instanceof Error && caught.message ? caught.message : t('settings.models.testFailed') } }))
    }
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    if (key.trim() && !await manager.setProviderKey(providerId, key.trim())) {
      setSaving(false)
      setError(t('settings.models.builtin.keyFailed'))
      return
    }
    let notice: string | undefined
    if (defaultModel && defaultModel !== currentDefault && !await manager.setDefault(providerId, defaultModel)) notice = t('settings.models.setDefaultFailed')
    setSaving(false)
    onDone({ id: providerId, notice })
  }

  const removeKey = async () => {
    setSaving(true)
    const removed = await manager.setProviderKey(providerId, null)
    setSaving(false)
    if (!removed) setError(t('settings.models.builtin.keyFailed'))
    else if (isNew) onDone({ id: providerId })
  }

  const keyPlaceholder = provider?.source === 'stored' ? t('settings.models.builtin.replaceKey')
    : provider?.configured ? t('settings.models.builtin.overrideKey') : t('settings.models.editor.apiKeyPlaceholder')

  return <div className="min-w-0 space-y-6" data-models-builtin-editor={providerId}>
    <PresetBar preset={preset?.preset} version={preset?.version} name={name} onVersion={isNew ? onVersion : undefined} onChange={isNew ? onChangePreset : undefined}>
      <p className="mt-1 flex items-center gap-1.5 text-caption text-muted-foreground" data-models-key-source>
        {provider?.configured ? <TbCircleCheck className="size-3.5 shrink-0 text-success" aria-hidden /> : null}{builtinKeySource(provider, t)}
      </p>
    </PresetBar>

    <EditorSection title={t('settings.models.editor.connection')} description={t('settings.models.builtin.description')}>
      <EditorField label={t('settings.models.editor.baseUrl')}>
        <p className="break-all rounded-md bg-fill px-2.5 py-1.5 font-mono text-caption text-muted-foreground">{provider?.baseUrl || t('settings.models.builtin.addressByPi')}</p>
      </EditorField>
      {provider && !provider.keyLogin ? <p className="flex items-start gap-2 text-caption text-muted-foreground"><TbInfoCircle className="mt-0.5 size-4 shrink-0" aria-hidden />{t('settings.models.builtin.noKeyLogin')}</p>
        : <EditorField label={<span className="flex flex-wrap items-center justify-between gap-2">{t('settings.models.form.apiKey')}<ApiKeyLink href={preset?.version.apiKeyUrl} /></span>}
          htmlFor="models-builtin-key" hint={t('settings.models.builtin.keyHint')}>
          <div className="flex min-w-0 items-center gap-2">
            <SecretInput id="models-builtin-key" value={key} onChange={setKey} placeholder={keyPlaceholder} describedBy="models-builtin-key-feedback" />
            {provider?.source === 'stored' ? <Button variant="ghost" size="sm" className="text-destructive" disabled={saving} onClick={() => setRemoveOpen(true)}><TbTrash aria-hidden />{t('settings.models.builtin.removeKey')}</Button> : null}
          </div>
        </EditorField>}
      {provider?.oauth ? <p className="flex items-start gap-2 text-micro leading-relaxed text-muted-foreground"><TbInfoCircle className="mt-px size-3.5 shrink-0" aria-hidden />{t('settings.models.builtin.oauthHint')}</p> : null}
    </EditorSection>

    <EditorSection title={t('settings.models.editor.models')}
      description={catalog.state === 'ready' ? t('settings.models.builtin.modelsDescription', { count: models.length }) : undefined}
      actions={models.length > 8 ? <div className="relative w-56 max-w-full">
        <TbSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE) }} placeholder={t('settings.models.editor.searchModels')}
          aria-label={t('settings.models.editor.searchModels')} className="h-7 rounded-full bg-fill pl-7.5 shadow-none" />
      </div> : null}>
      {catalog.state === 'loading' ? <p className="flex items-center justify-center gap-2 py-8 text-caption text-muted-foreground" role="status"><TbLoader2 className="size-4 animate-spin" aria-hidden />{t('settings.models.loading')}</p>
        : catalog.state === 'error' ? <p className="py-6 text-center text-caption text-destructive" role="alert">{t('settings.models.builtin.catalogFailed')}</p>
          : visible.length === 0 ? <p className="py-6 text-center text-caption text-muted-foreground">{t('settings.models.workspace.noMatches')}</p>
            : <div className="-my-2 min-w-0">
              {visible.slice(0, limit).map((model) => {
                const isDefault = defaultModel === model.id
                const title = model.name || model.id
                return <article key={model.id} className="min-w-0 border-t border-border/70 py-2.5 first:border-t-0" data-model-row={model.id}>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <div className="min-w-0 flex-1 pl-1">
                      <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-app font-medium"><span className="break-words">{title}</span>
                        {isDefault ? <span className="text-micro font-normal text-sage">{t('settings.models.defaultBadge')}</span> : null}</p>
                      <p className="mt-0.5 flex min-w-0 flex-wrap gap-x-3 text-micro text-muted-foreground">
                        {model.name && model.name !== model.id ? <span className="break-all font-mono">{model.id}</span> : null}
                        {model.reasoning ? <span>{t('settings.models.form.reasoning')}</span> : null}
                        {model.input.includes('image') ? <span>{t('settings.models.workspace.vision')}</span> : null}
                        {model.contextWindow ? <span>{t('settings.models.workspace.context', { count: numberFormat.format(model.contextWindow) })}</span> : null}
                      </p>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild><Button variant="ghost" size="icon-sm" aria-pressed={isDefault} aria-label={t('settings.models.editor.makeDefault', { name: title })}
                        onClick={() => setDefaultModel(model.id)}>
                        {isDefault ? <TbStarFilled className="text-sage" aria-hidden /> : <TbStar aria-hidden />}
                      </Button></TooltipTrigger>
                      <TooltipContent>{t(isDefault ? 'settings.models.editor.isDefault' : 'settings.models.setDefault')}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild><span className="inline-flex"><Button variant="ghost" size="xs" disabled={!canTest || tests[model.id]?.state === 'testing'}
                        aria-label={t('settings.models.editor.testModel', { name: title })} onClick={() => void test(model.id)}>
                        {tests[model.id]?.state === 'testing' ? <TbLoader2 className="animate-spin" aria-hidden /> : <TbFlask aria-hidden />}
                        <span className="hidden @min-[520px]/settings-workspace:inline">{t('settings.models.testModel')}</span>
                      </Button></span></TooltipTrigger>
                      {!canTest ? <TooltipContent>{t(key.trim() ? 'settings.models.builtin.saveBeforeTest' : 'settings.models.builtin.keyBeforeTest')}</TooltipContent> : null}
                    </Tooltip>
                  </div>
                  <TestResultLine test={tests[model.id]} className="pt-1.5 pl-1" />
                </article>
              })}
              {visible.length > limit ? <div className="border-t border-border/70 py-2 text-center">
                <Button variant="ghost" size="sm" onClick={() => setLimit((current) => current + PAGE * 4)}>{t('settings.models.builtin.showMore', { count: visible.length - limit })}</Button>
              </div> : null}
            </div>}
      <p className="text-micro leading-relaxed text-muted-foreground">{t('settings.models.builtin.modelsFootnote')}</p>
    </EditorSection>

    <EditorFooter onCancel={onCancel} onSave={() => void save()} saving={saving} canSave={canSave} error={error} />

    <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('settings.models.builtin.removeKeyTitle', { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t('settings.models.builtin.removeKeyDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => void removeKey()}>{t('settings.models.builtin.removeKey')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
}
