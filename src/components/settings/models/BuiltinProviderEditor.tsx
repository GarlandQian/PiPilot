import * as React from 'react'
import { TbDots, TbFlask, TbLoader2, TbSearch, TbStar } from 'react-icons/tb'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useLocale, useT } from '@/i18n'
import type { ModelCatalogEntry } from '@/shared/model-catalog'
import { localizedText, type PresetMatch } from '@/shared/model-provider-presets'
import type { BuiltinProvider } from '@/shared/models-config'
import type { ModelsManager } from '../useModelsManager'
import { ApiKeyLink, SecretInput, type TestState } from '../editor-page'
import { FormActions, SettingsBadge, SettingsField, SettingsGroup, SettingsIdentity, SettingsListRow, SettingsPage, SettingsRow, StatusText } from '../kit'
import { ProviderIcon } from './ProviderIcon'
import { TestStatus } from './ProviderCardList'

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

  const versions = isNew && preset && preset.preset.versions.length > 1 && onVersion ? preset.preset.versions : null
  const identityModel = defaultModel ?? models[0]?.id
  const identityTest = identityModel ? tests[identityModel] : undefined

  return <SettingsPage data-models-builtin-editor={providerId}>
    <SettingsIdentity icon={<ProviderIcon icon={preset?.preset.icon} name={name} size="lg" />} title={name}
      subtitle={<span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        {versions ? <select className="mac-select" aria-label={t('settings.models.editor.version')} value={preset!.version.key} onChange={(event) => onVersion!(event.target.value)}>
          {versions.map((version) => <option key={version.key} value={version.key}>{localizedText(version.label, locale)}</option>)}
        </select> : preset && preset.preset.versions.length > 1 ? <span>{localizedText(preset.version.label, locale)}</span> : null}
        <StatusText tone={provider?.configured ? 'success' : 'warning'}><span data-models-key-source>{builtinKeySource(provider, t)}</span></StatusText>
      </span>}
      actions={<>
        {isNew && onChangePreset ? <Button variant="outline" size="sm" onClick={onChangePreset}>{t('settings.models.editor.changePreset')}</Button> : null}
        <Button variant="outline" size="sm" disabled={!canTest || !identityModel || identityTest?.state === 'testing'} title={!canTest ? t(key.trim() ? 'settings.models.builtin.saveBeforeTest' : 'settings.models.builtin.keyBeforeTest') : undefined}
          onClick={() => identityModel && void test(identityModel)}>
          {identityTest?.state === 'testing' ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <TbFlask aria-hidden />}{t('settings.models.testModel')}
        </Button>
      </>}>
      {identityTest && identityTest.state !== 'testing' ? <div className="mt-1"><TestStatus test={identityTest} /></div> : null}
    </SettingsIdentity>

    <SettingsGroup title={t('settings.models.editor.connection')} info={t('settings.models.builtin.description')}
      footer={<span className="flex flex-wrap items-center gap-x-3 gap-y-1"><ApiKeyLink href={preset?.version.apiKeyUrl} />{provider?.oauth ? <span>{t('settings.models.builtin.oauthHint')}</span> : null}</span>}>
      <SettingsRow label={t('settings.models.editor.baseUrl')} info={t('settings.models.builtin.addressByPi')}>
        <span className="min-w-0 truncate font-mono text-caption text-muted-foreground" title={provider?.baseUrl}>{provider?.baseUrl || t('settings.models.builtin.addressByPi')}</span>
      </SettingsRow>
      {provider && !provider.keyLogin ? <SettingsRow label={t('settings.models.form.apiKey')} description={t('settings.models.builtin.noKeyLogin')} />
        : <SettingsField label={t('settings.models.form.apiKey')} htmlFor="models-builtin-key" info={t('settings.models.builtin.keyHint')}>
          <SecretInput id="models-builtin-key" value={key} onChange={setKey} placeholder={keyPlaceholder} />
        </SettingsField>}
      {provider?.source === 'stored' ? <SettingsRow label={t('settings.models.builtin.storedKey')} description={t('settings.models.builtin.storedKeyDescription')}>
        <Button variant="outline" size="sm" className="text-destructive" disabled={saving} onClick={() => setRemoveOpen(true)}>{t('settings.models.builtin.removeKey')}</Button>
      </SettingsRow> : null}
    </SettingsGroup>

    <SettingsGroup title={t('settings.models.editor.models')} info={t('settings.models.builtin.modelsFootnote')} boxRole={visible.length ? 'list' : undefined}
      actions={models.length > 8 ? <div className="relative w-52 max-w-full">
        <TbSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE) }} placeholder={t('settings.models.editor.searchModels')}
          aria-label={t('settings.models.editor.searchModels')} className="h-6 rounded-full bg-fill pl-7.5 text-caption shadow-none" />
      </div> : null}
      footer={catalog.state === 'ready' ? t('settings.models.builtin.modelsDescription', { count: models.length }) : undefined}>
      {catalog.state === 'loading' ? <div data-settings-row className="flex items-center justify-center gap-2 px-3 py-8 text-caption text-muted-foreground" role="status"><TbLoader2 className="size-4 animate-spin" aria-hidden />{t('settings.models.loading')}</div>
        : catalog.state === 'error' ? <div data-settings-row className="px-3 py-6 text-center text-caption text-destructive" role="alert">{t('settings.models.builtin.catalogFailed')}</div>
          : visible.length === 0 ? <div data-settings-row className="px-3 py-6 text-center text-caption text-muted-foreground">{t('settings.models.workspace.noMatches')}</div>
            : <>
              {visible.slice(0, limit).map((model) => {
                const isDefault = defaultModel === model.id
                const title = model.name || model.id
                const details = [
                  model.name && model.name !== model.id ? model.id : null,
                  model.reasoning ? t('settings.models.form.reasoning') : null,
                  model.input.includes('image') ? t('settings.models.workspace.vision') : null,
                  model.contextWindow ? t('settings.models.workspace.context', { count: numberFormat.format(model.contextWindow) }) : null,
                ].filter(Boolean).join(' · ')
                return <SettingsListRow key={model.id} data-model-row={model.id} title={title} subtitle={details || undefined}
                  badges={isDefault ? <SettingsBadge tone="accent">{t('settings.models.defaultBadge')}</SettingsBadge> : null}
                  status={<TestStatus test={tests[model.id]} />}
                  menu={<DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={t('settings.models.modelActions', { name: title })}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem disabled={!canTest} onSelect={() => void test(model.id)}><TbFlask aria-hidden />{t('settings.models.cards.testAction')}</DropdownMenuItem>
                      <DropdownMenuItem disabled={isDefault} onSelect={() => setDefaultModel(model.id)}><TbStar aria-hidden />{t('settings.models.setDefault')}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>} />
              })}
              {visible.length > limit ? <div data-settings-row className="px-3 py-1.5 text-center">
                <Button variant="ghost" size="sm" onClick={() => setLimit((current) => current + PAGE * 4)}>{t('settings.models.builtin.showMore', { count: visible.length - limit })}</Button>
              </div> : null}
            </>}
    </SettingsGroup>

    <FormActions onCancel={onCancel} onSave={() => void save()} saving={saving} canSave={canSave} error={error} />

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
  </SettingsPage>
}
