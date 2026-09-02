import * as React from 'react'
import {
  TbCheck,
  TbChevronDown,
  TbChevronRight,
  TbCopy,
  TbDots,
  TbEdit,
  TbFlask,
  TbLoader2,
  TbPlus,
  TbRefresh,
  TbStar,
  TbStarFilled,
  TbTrash,
} from 'react-icons/tb'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLocale, useT } from '@/i18n'
import { cn } from '@/lib/utils'
import {
  createModelsConfigAdapter,
  type ModelsConfigAdapter,
} from '@/renderer/adapters/models-config-adapter'
import { structuredProviderSupported } from '@/shared/models-config'
import type {
  ModelsConfigModel,
  ModelsConfigProvider,
  ModelsConfigSnapshot,
} from '@/shared/models-config'
import {
  parseModelsConfigDocument,
  rawModelsProviderDefinition,
  removeModelsProvider,
  renameModelsProvider,
  upsertModelsProvider,
} from '@/shared/models-config-schema'
import { usePiRpcActions, usePiRuntime } from '@/store/pi-rpc'
import { SettingRow, SettingSection } from './common'
import {
  definitionFromFormValues,
  formValueFromModel,
  formValueFromProvider,
  type ModelFormValue,
  type ProviderFormValue,
} from './models-form-model'
import { ModelsModelFormDialog } from './ModelsModelFormDialog'
import { ModelsProviderFormDialog } from './ModelsProviderFormDialog'

type DraftView = 'form' | 'json'

type ProviderDialogState =
  | { mode: 'add' }
  | { mode: 'edit'; provider: ModelsConfigProvider }

type ModelDialogState =
  | { providerId: string; mode: 'add' }
  | { providerId: string; mode: 'edit'; model: ModelsConfigModel }

type ModelTestState =
  | { state: 'testing' }
  | { state: 'success'; latencyMs: number; responsePreview: string }
  | { state: 'error'; message: string }

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined
}

function modelSelectionKey(providerId: string, modelId: string) {
  return JSON.stringify([providerId, modelId])
}

function decodeModelSelectionKey(value: string): [string, string] | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) &&
      parsed.length === 2 &&
      typeof parsed[0] === 'string' &&
      typeof parsed[1] === 'string'
      ? [parsed[0], parsed[1]]
      : null
  } catch {
    return null
  }
}

function cloneJsonRecord(value: Record<string, unknown>) {
  const clone = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(clone)
    if (typeof entry === 'object' && entry !== null) {
      return Object.fromEntries(
        Object.entries(entry as Record<string, unknown>).map(([key, child]) => [key, clone(child)]),
      )
    }
    return entry
  }
  return clone(value) as Record<string, unknown>
}

function nextProviderId(baseId: string, existingIds: readonly string[]) {
  const occupied = new Set(existingIds.map((id) => id.toLowerCase()))
  const base = `${baseId.trim() || 'provider'}-copy`
  let candidate = base
  let suffix = 2
  while (occupied.has(candidate.toLowerCase())) {
    candidate = `${base}-${suffix}`
    suffix += 1
  }
  return candidate
}

export function ModelsSettings() {
  const t = useT()
  const locale = useLocale()
  const runtime = usePiRuntime()
  const actions = usePiRpcActions()
  const [busy, setBusy] = React.useState<string | null>(null)
  const numberFormat = React.useMemo(
    () => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }),
    [locale],
  )

  const run = React.useCallback(async (key: string, operation: () => Promise<void>) => {
    if (busy) return
    setBusy(key)
    try {
      await operation()
    } catch {
      // The shared Pi runtime slice renders the official error below.
    } finally {
      setBusy(null)
    }
  }, [busy])

  const connected = runtime.runtime?.state === 'ready'

  /* ---------------------------------------------------------------- */
  /* models.json config surface: single JSONC draft shared by the      */
  /* Form and JSON views (mirrors McpSettings; design §7).             */
  /* ---------------------------------------------------------------- */
  const [adapter] = React.useState<ModelsConfigAdapter | null>(createModelsConfigAdapter)
  const [snapshot, setSnapshot] = React.useState<ModelsConfigSnapshot | null>(null)
  const [draftText, setDraftText] = React.useState('')
  const [view, setView] = React.useState<DraftView>('form')
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<string | null>(null)
  const [providerDialog, setProviderDialog] = React.useState<ProviderDialogState | null>(null)
  const [modelDialog, setModelDialog] = React.useState<ModelDialogState | null>(null)
  const [removeProviderId, setRemoveProviderId] = React.useState<string | null>(null)
  const [removeModel, setRemoveModel] = React.useState<{
    providerId: string
    modelId: string
  } | null>(null)
  const [defaultBusy, setDefaultBusy] = React.useState<string | null>(null)
  const [expandedProviders, setExpandedProviders] = React.useState<Record<string, boolean>>({})
  const [selectedCustomModels, setSelectedCustomModels] = React.useState<Set<string>>(
    () => new Set(),
  )
  const [modelTests, setModelTests] = React.useState<Record<string, ModelTestState>>({})
  const requestEpoch = React.useRef(0)
  const draftRevision = React.useRef(0)
  const parsed = React.useMemo(() => parseModelsConfigDocument(draftText), [draftText])
  // The structured form owns common fields and preserves advanced fields
  // from the raw JSONC draft. Advanced entries are a notice, not a gate.
  const hasAdvancedFields = parsed.valid && parsed.providers.some(
    (provider) => !structuredProviderSupported(provider),
  )
  const dirty = Boolean(snapshot && draftText !== snapshot.content)

  const updateDraft = React.useCallback((next: string) => {
    draftRevision.current += 1
    setDraftText(next)
  }, [])

  const load = React.useCallback(async (confirmDiscard = false) => {
    if (!adapter) return
    if (confirmDiscard && dirty && !window.confirm(t('settings.models.discardConfirm'))) return
    const epoch = ++requestEpoch.current
    const expectedDraftRevision = draftRevision.current
    setLoading(true)
    setError(null)
    setStatus(null)
    try {
      const next = await adapter.load({ kind: 'global' })
      if (epoch !== requestEpoch.current || expectedDraftRevision !== draftRevision.current) return
      setSnapshot(next)
      setDraftText(next.content)
    } catch {
      if (epoch === requestEpoch.current) setError(t('settings.models.loadFailed'))
    } finally {
      if (epoch === requestEpoch.current) setLoading(false)
    }
  }, [adapter, dirty, t])

  React.useEffect(() => {
    void load()
    // Draft edits must not reload the surface; target is always global.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const save = async (restart: boolean) => {
    if (!adapter || !snapshot || !dirty || !parsed.valid || loading || saving) return
    const epoch = ++requestEpoch.current
    const expectedDraftRevision = draftRevision.current
    setSaving(true)
    setError(null)
    setStatus(null)
    try {
      const result = restart
        ? await adapter.saveAndRestart({ kind: 'global' }, draftText, snapshot.fingerprint)
        : await adapter.save({ kind: 'global' }, draftText, snapshot.fingerprint)
      if (epoch !== requestEpoch.current) return
      setSnapshot(result.snapshot)
      if (expectedDraftRevision === draftRevision.current) {
        setDraftText(result.snapshot.content)
      }
      setStatus(t(`settings.models.apply.${result.apply}`))
      if (restart) await actions.refresh().catch(() => undefined)
    } catch (caught) {
      if (epoch === requestEpoch.current) {
        setError(
          errorCode(caught) === 'MODELS_CONFIG_CONFLICT'
            ? t('settings.models.conflict')
            : t('settings.models.saveFailed'),
        )
      }
    } finally {
      if (epoch === requestEpoch.current) setSaving(false)
    }
  }

  const setDefault = async (providerId: string, modelId: string) => {
    if (!adapter || defaultBusy) return
    const key = modelSelectionKey(providerId, modelId)
    setDefaultBusy(key)
    setError(null)
    setStatus(null)
    try {
      const result = await adapter.setDefault(providerId, modelId)
      if (!result.settingsUpdated) throw new Error('settings not updated')
      setSnapshot((previous) =>
        previous
          ? {
              ...previous,
              ...(result.defaultProvider !== undefined
                ? { defaultProvider: result.defaultProvider }
                : {}),
              ...(result.defaultModel !== undefined
                ? { defaultModel: result.defaultModel }
                : {}),
            }
          : previous,
      )
      setStatus(t('settings.models.setDefaultDone'))
    } catch {
      setError(t('settings.models.setDefaultFailed'))
    } finally {
      setDefaultBusy(null)
    }
  }

  const testModel = async (providerId: string, modelId: string) => {
    if (!adapter || !parsed.valid) return
    const key = modelSelectionKey(providerId, modelId)
    setModelTests((previous) => ({ ...previous, [key]: { state: 'testing' } }))
    try {
      const result = await adapter.test({ kind: 'global' }, draftText, providerId, modelId)
      setModelTests((previous) => ({
        ...previous,
        [key]: {
          state: 'success',
          latencyMs: result.latencyMs,
          responsePreview: result.responsePreview,
        },
      }))
    } catch (caught) {
      setModelTests((previous) => ({
        ...previous,
        [key]: {
          state: 'error',
          message: caught instanceof Error && caught.message
            ? caught.message
            : t('settings.models.testFailed'),
        },
      }))
    }
  }

  /* -------------------- structured edit handlers ------------------ */

  const submitProviderForm = (value: ProviderFormValue) => {
    try {
      let next = draftText
      if (providerDialog?.mode === 'edit') {
        const provider = providerDialog.provider
        const rawExisting = rawModelsProviderDefinition(draftText, provider.id)
        const definition = definitionFromFormValues(
          value,
          provider.models.map((model) => formValueFromModel(model)),
          rawExisting,
        )
        if (value.id !== provider.id) {
          next = renameModelsProvider(next, provider.id, value.id)
        }
        next = upsertModelsProvider(next, value.id, definition)
      } else {
        next = upsertModelsProvider(next, value.id, definitionFromFormValues(value, []))
      }
      updateDraft(next)
      setError(null)
      setProviderDialog(null)
    } catch {
      setError(t('settings.models.editFailed'))
    }
  }

  const submitModelForm = (value: ModelFormValue) => {
    if (!modelDialog) return
    const provider = parsed.providers.find((entry) => entry.id === modelDialog.providerId)
    if (!provider) return
    try {
      const models = provider.models.map((model) => formValueFromModel(model))
      if (modelDialog.mode === 'edit') {
        const index = provider.models.findIndex((model) => model.id === modelDialog.model.id)
        if (index >= 0) models[index] = value
      } else {
        models.push(value)
      }
      let rawExisting = rawModelsProviderDefinition(draftText, provider.id)
      if (
        modelDialog.mode === 'edit' &&
        rawExisting &&
        modelDialog.model.id !== value.id &&
        Array.isArray(rawExisting.models)
      ) {
        const index = provider.models.findIndex((model) => model.id === modelDialog.model.id)
        const rawModels = rawExisting.models.map((model) => (
          model && typeof model === 'object' && !Array.isArray(model)
            ? { ...(model as Record<string, unknown>) }
            : model
        ))
        const rawModel = rawModels[index]
        if (index >= 0 && rawModel && typeof rawModel === 'object' && !Array.isArray(rawModel)) {
          rawModels[index] = { ...(rawModel as Record<string, unknown>), id: value.id.trim() }
          rawExisting = { ...rawExisting, models: rawModels }
        }
      }
      const definition = definitionFromFormValues(
        formValueFromProvider(provider),
        models,
        rawExisting,
      )
      updateDraft(upsertModelsProvider(draftText, provider.id, definition))
      setError(null)
      setModelDialog(null)
    } catch {
      setError(t('settings.models.editFailed'))
    }
  }

  const removeProvider = (providerId: string) => {
    try {
      updateDraft(removeModelsProvider(draftText, providerId))
      setError(null)
    } catch {
      setError(t('settings.models.editFailed'))
    }
  }

  const removeModelFromProvider = (providerId: string, modelId: string) => {
    const provider = parsed.providers.find((entry) => entry.id === providerId)
    if (!provider) return
    try {
      const models = provider.models
        .filter((model) => model.id !== modelId)
        .map((model) => formValueFromModel(model))
      const definition = definitionFromFormValues(
        formValueFromProvider(provider),
        models,
        rawModelsProviderDefinition(draftText, provider.id),
      )
      updateDraft(upsertModelsProvider(draftText, provider.id, definition))
      setError(null)
    } catch {
      setError(t('settings.models.editFailed'))
    }
  }

  const toggleProvider = (providerId: string, open: boolean) => {
    setExpandedProviders((previous) => ({ ...previous, [providerId]: open }))
  }

  const toggleCustomModel = (providerId: string, modelId: string, checked: boolean) => {
    const key = modelSelectionKey(providerId, modelId)
    setSelectedCustomModels((previous) => {
      const next = new Set(previous)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const duplicateProvider = (provider: ModelsConfigProvider) => {
    try {
      const raw = rawModelsProviderDefinition(draftText, provider.id)
      if (!raw) throw new Error('Provider is not available in the draft.')
      const id = nextProviderId(provider.id, parsed.providers.map((entry) => entry.id))
      const definition = cloneJsonRecord(raw)
      // Credentials are never copied into a new provider. The user can add a
      // replacement key explicitly in the provider form.
      delete definition.apiKey
      const next = upsertModelsProvider(draftText, id, definition)
      updateDraft(next)
      setExpandedProviders((previous) => ({ ...previous, [id]: true }))
      setStatus(t('settings.models.providerDuplicated'))
      setError(null)
    } catch {
      setError(t('settings.models.editFailed'))
    }
  }

  const deleteSelectedModels = () => {
    if (selectedCustomModels.size === 0) return
    try {
      let next = draftText
      for (const selection of selectedCustomModels) {
        const pair = decodeModelSelectionKey(selection)
        if (!pair) continue
        const [providerId, modelId] = pair
        const provider = parseModelsConfigDocument(next).providers.find((entry) => entry.id === providerId)
        if (!provider) continue
        const models = provider.models
          .filter((model) => model.id !== modelId)
          .map((model) => formValueFromModel(model))
        next = upsertModelsProvider(
          next,
          providerId,
          definitionFromFormValues(
            formValueFromProvider(provider),
            models,
            rawModelsProviderDefinition(next, providerId),
          ),
        )
      }
      updateDraft(next)
      setSelectedCustomModels(new Set())
      setStatus(t('settings.models.modelsDeleted'))
      setError(null)
    } catch {
      setError(t('settings.models.editFailed'))
    }
  }

  const isDefault = (providerId: string, modelId: string) =>
    snapshot?.defaultProvider === providerId && snapshot?.defaultModel === modelId

  /* ------------------------------ render -------------------------- */

  return (
    <>
      <SettingSection
        title={t('settings.models.customProviders')}
        desc={t('settings.models.customProvidersDesc')}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 px-2">
          <p
            title={snapshot?.path}
            className="min-w-0 flex-1 truncate font-mono text-micro text-muted-foreground"
          >
            {snapshot?.path ?? t('settings.models.noPath')}
          </p>
          <div className="flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={!adapter || loading || saving}
                    aria-label={t('common.refresh')}
                    onClick={() => void load(true)}
                  >
                    <TbRefresh className={loading ? 'animate-spin' : ''} aria-hidden />
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{t('common.refresh')}</TooltipContent>
            </Tooltip>
            <Button
              variant="outline"
              size="sm"
              disabled={!dirty || !parsed.valid || loading || saving}
              onClick={() => void save(false)}
            >
              {t('common.save')}
            </Button>
            <Button
              size="sm"
              disabled={!dirty || !parsed.valid || loading || saving}
              onClick={() => void save(true)}
            >
              {t('settings.models.saveRestart')}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <div
              className="inline-flex rounded-md bg-muted p-0.5"
              role="group"
              aria-label={t('settings.models.mode.form')}
            >
              {(['form', 'json'] as const).map((candidate) => (
                <button
                  key={candidate}
                  type="button"
                  aria-pressed={view === candidate}
                  className="h-7 rounded px-2.5 text-caption text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-40 aria-pressed:bg-background aria-pressed:text-foreground"
                  onClick={() => setView(candidate)}
                >
                  {t(`settings.models.mode.${candidate}`)}
                </button>
              ))}
            </div>
            {hasAdvancedFields && (
              <span className="text-micro text-muted-foreground">
                {t('settings.models.formAdvancedNotice')}
              </span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={view !== 'form' || !parsed.valid}
            onClick={() => setProviderDialog({ mode: 'add' })}
          >
            <TbPlus aria-hidden />
            {t('settings.models.addProvider')}
          </Button>
        </div>

        {view === 'form'
          ? (
              <div className="mt-3 divide-y divide-border rounded-md border border-border">
                {parsed.providers.map((provider) => {
                  const hasAdvancedFieldsForProvider = !structuredProviderSupported(provider)
                  const expanded = expandedProviders[provider.id] ?? true
                  const providerSelections = provider.models.map((model) => modelSelectionKey(provider.id, model.id))
                  const selectedCount = providerSelections.filter((key) => selectedCustomModels.has(key)).length
                  const allSelected = providerSelections.length > 0 && selectedCount === providerSelections.length
                  return (
                    <Collapsible
                      key={provider.id}
                      open={expanded}
                      onOpenChange={(open) => toggleProvider(provider.id, open)}
                      className="px-3 py-2.5"
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <CollapsibleTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={expanded ? t('settings.models.collapseProvider', { name: provider.name || provider.id }) : t('settings.models.expandProvider', { name: provider.name || provider.id })}
                          >
                            {expanded ? <TbChevronDown aria-hidden /> : <TbChevronRight aria-hidden />}
                          </Button>
                        </CollapsibleTrigger>
                        <span className="truncate text-caption font-medium">
                          {provider.name || provider.id}
                        </span>
                        {provider.api && <Badge variant="outline">{provider.api}</Badge>}
                        {provider.hasApiKey && (
                          <span className="text-micro text-muted-foreground">
                            {t('settings.models.keyStored')}
                          </span>
                        )}
                        {hasAdvancedFieldsForProvider && (
                          <Badge variant="soft-warning">{t('settings.models.advancedFields')}</Badge>
                        )}
                        <span className="text-micro text-muted-foreground">
                          {t('settings.models.providerModels', { count: provider.models.length })}
                        </span>
                        <div className="ml-auto flex items-center gap-0.5">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-xs" aria-label={t('settings.models.providerActions', { name: provider.name || provider.id })}>
                                <TbDots aria-hidden />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              <DropdownMenuItem disabled={!parsed.valid} onSelect={() => setProviderDialog({ mode: 'edit', provider })}>
                                <TbEdit aria-hidden />{t('settings.models.editProvider')}
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => duplicateProvider(provider)}>
                                <TbCopy aria-hidden />{t('settings.models.duplicateProvider')}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem variant="destructive" onSelect={() => setRemoveProviderId(provider.id)}>
                                <TbTrash aria-hidden />{t('settings.models.deleteProvider')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      <CollapsibleContent>
                        <div className="mt-1 flex flex-wrap items-center gap-2 pl-7">
                          {provider.baseUrl && <span className="truncate font-mono text-micro text-muted-foreground">{provider.baseUrl}</span>}
                          {hasAdvancedFieldsForProvider && <Badge variant="soft-warning">{t('settings.models.advancedFields')}</Badge>}
                        </div>
                        <div className="mt-2 flex items-center gap-2 pl-7">
                          <Checkbox
                            checked={allSelected ? true : selectedCount > 0 ? 'indeterminate' : false}
                            aria-label={t('settings.models.selectAllModels', { name: provider.name || provider.id })}
                            onCheckedChange={(checked) => {
                              for (const model of provider.models) toggleCustomModel(provider.id, model.id, checked === true)
                            }}
                          />
                          <span className="text-micro text-muted-foreground">{t('settings.models.selectModels')}</span>
                          {selectedCount > 0 && <span className="text-micro text-sage">{t('settings.models.selectedCount', { count: selectedCount })}</span>}
                          <div className="ml-auto flex items-center gap-1">
                            <Button variant="outline" size="xs" disabled={!parsed.valid} onClick={() => setModelDialog({ providerId: provider.id, mode: 'add' })}>
                              <TbPlus aria-hidden />{t('settings.models.addModel')}
                            </Button>
                            <Button variant="ghost" size="icon-xs" disabled={selectedCount === 0} aria-label={t('settings.models.deleteSelectedModels')} onClick={deleteSelectedModels}>
                              <TbTrash aria-hidden />
                            </Button>
                          </div>
                        </div>
                        <div className="mt-1 flex flex-col gap-1 pl-7">
                          {provider.models.map((model) => {
                            const modelIsDefault = isDefault(provider.id, model.id)
                            const modelSelected = selectedCustomModels.has(modelSelectionKey(provider.id, model.id))
                            const testState = modelTests[modelSelectionKey(provider.id, model.id)]
                            return (
                          <div
                            key={model.id}
                            className="group/model flex min-h-10 flex-wrap items-center gap-2 rounded-md border border-border/60 px-2 py-1.5"
                          >
                            <Checkbox checked={modelSelected} aria-label={t('settings.models.selectModel', { name: model.name || model.id })} onCheckedChange={(checked) => toggleCustomModel(provider.id, model.id, checked === true)} />
                            <span className="min-w-44 flex-1 truncate font-mono text-micro text-foreground">
                              <span className="font-sans text-caption">{model.name || model.id}</span>
                              <span className="ml-2 text-muted-foreground">{model.id}</span>
                            </span>
                            {modelIsDefault && <Badge variant="soft-success"><TbCheck aria-hidden />{t('settings.models.defaultBadge')}</Badge>}
                            {model.contextWindow !== undefined && (
                              <span className="shrink-0 text-micro text-muted-foreground">
                                {numberFormat.format(model.contextWindow)}
                                {model.maxTokens !== undefined
                                  ? ` / ${numberFormat.format(model.maxTokens)}`
                                  : ''}
                              </span>
                            )}
                            {testState?.state === 'success' && (
                              <p className="order-last w-full break-words pl-7 text-micro text-success" role="status">
                                {t('settings.models.testSuccess', { latency: testState.latencyMs })}
                                {' · '}
                                {testState.responsePreview || t('settings.models.testNoPreview')}
                              </p>
                            )}
                            {testState?.state === 'error' && (
                              <p className="order-last w-full break-words pl-7 text-micro text-destructive" role="alert">
                                {t('settings.models.testFailed')}
                                {' '}
                                {testState.message}
                              </p>
                            )}
                            <Button
                              variant="ghost"
                              size="xs"
                              disabled={!adapter || !parsed.valid || testState?.state === 'testing'}
                              onClick={() => void testModel(provider.id, model.id)}
                            >
                              {testState?.state === 'testing'
                                ? <TbLoader2 className="animate-spin" aria-hidden />
                                : <TbFlask aria-hidden />}
                              {testState?.state === 'testing'
                                ? t('settings.models.testing')
                                : t('settings.models.testModel')}
                            </Button>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  disabled={defaultBusy !== null}
                                  aria-label={`${t('settings.models.setDefault')} ${model.name || model.id}`}
                                  onClick={() => void setDefault(provider.id, model.id)}
                                >
                                  {defaultBusy === modelSelectionKey(provider.id, model.id)
                                    ? <TbLoader2 className="animate-spin" aria-hidden />
                                    : modelIsDefault
                                      ? <TbStarFilled className="text-sage" aria-hidden />
                                      : <TbStar aria-hidden />}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{t('settings.models.setDefault')}</TooltipContent>
                            </Tooltip>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon-xs" aria-label={t('settings.models.modelActions', { name: model.name || model.id })}><TbDots aria-hidden /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-40">
                                <DropdownMenuItem disabled={!parsed.valid} onSelect={() => setModelDialog({ providerId: provider.id, mode: 'edit', model })}><TbEdit aria-hidden />{t('settings.models.editModel')}</DropdownMenuItem>
                                <DropdownMenuItem variant="destructive" onSelect={() => setRemoveModel({ providerId: provider.id, modelId: model.id })}><TbTrash aria-hidden />{t('settings.models.deleteModel')}</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                            )
                          })}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )
                })}
                {parsed.providers.length === 0 && (
                  <div className="grid min-h-28 place-items-center px-6 text-center text-caption text-muted-foreground">
                    {t('settings.models.noProviders')}
                  </div>
                )}
              </div>
            )
          : (
              <Textarea
                value={draftText}
                onChange={(event) => updateDraft(event.target.value)}
                spellCheck={false}
                aria-invalid={!parsed.valid}
                aria-label={t('settings.models.mode.json')}
                className="mt-3 min-h-[24rem] resize-y font-mono text-caption"
              />
            )}

        {parsed.diagnostics.length > 0 && (
          <div
            className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2"
            role="alert"
          >
            {parsed.diagnostics.slice(0, 5).map((diagnostic, index) => (
              <p
                key={`${diagnostic.code}:${diagnostic.offset}:${index}`}
                className="text-micro text-destructive"
              >
                {t('settings.models.diagnostics', {
                  line: diagnostic.line,
                  column: diagnostic.column,
                  message: diagnostic.message,
                })}
              </p>
            ))}
          </div>
        )}
        {(error || status) && (
          <p
            className={cn('pt-2 text-caption', error ? 'text-destructive' : 'text-muted-foreground')}
            role={error ? 'alert' : 'status'}
          >
            {error ?? status}
          </p>
        )}
      </SettingSection>

      <SettingSection
        title={t('settings.models.thinkingTitle')}
        desc={t('settings.models.thinkingDesc')}
      >
        <SettingRow label={t('settings.models.thinkingTitle')}>
          <Select
            value={runtime.session?.thinkingLevel}
            disabled={!runtime.selectedModel || runtime.thinkingLevels.length === 0 || Boolean(busy)}
            onValueChange={(value) => void run(
              `thinking:${value}`,
              () => actions.selectThinking(value as (typeof runtime.thinkingLevels)[number]),
            )}
          >
            <SelectTrigger
              size="sm"
              className="w-40"
              aria-label={t('settings.models.thinkingTitle')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {runtime.thinkingLevels.map((level) => (
                <SelectItem key={level} value={level}>
                  {t(`settings.models.thinking.${level}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          label={t('settings.models.autoCompaction')}
          desc={t('settings.models.autoCompactionDesc')}
        >
          <Switch
            checked={runtime.session?.autoCompactionEnabled ?? false}
            disabled={!connected || Boolean(busy)}
            onCheckedChange={(enabled) => void run(
              'auto-compaction',
              () => actions.setAutoCompaction(enabled),
            )}
          />
        </SettingRow>
      </SettingSection>

      <ModelsProviderFormDialog
        open={providerDialog !== null}
        onOpenChange={(open) => !open && setProviderDialog(null)}
        mode={providerDialog?.mode === 'edit' ? 'edit' : 'add'}
        initial={providerDialog?.mode === 'edit'
          ? formValueFromProvider(providerDialog.provider)
          : undefined}
        hasApiKey={providerDialog?.mode === 'edit' ? providerDialog.provider.hasApiKey : false}
        existingIds={parsed.providers.map((provider) => provider.id)}
        onSubmit={submitProviderForm}
      />

      {modelDialog && (
        <ModelsModelFormDialog
          open
          onOpenChange={(open) => !open && setModelDialog(null)}
          mode={modelDialog.mode}
          initial={modelDialog.mode === 'edit'
            ? formValueFromModel(modelDialog.model)
            : undefined}
          existingIds={
            parsed.providers
              .find((provider) => provider.id === modelDialog.providerId)
              ?.models.map((model) => model.id) ?? []
          }
          onSubmit={submitModelForm}
        />
      )}

      <AlertDialog
        open={removeProviderId !== null}
        onOpenChange={(open) => !open && setRemoveProviderId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('settings.models.deleteProviderConfirm', { name: removeProviderId ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.models.deleteProviderConfirmDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (removeProviderId) removeProvider(removeProviderId)
                setRemoveProviderId(null)
              }}
            >
              {t('settings.models.deleteProvider')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={removeModel !== null}
        onOpenChange={(open) => !open && setRemoveModel(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('settings.models.deleteModelConfirm', {
                provider: removeModel?.providerId ?? '',
                name: removeModel?.modelId ?? '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.models.deleteModelConfirmDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (removeModel) removeModelFromProvider(removeModel.providerId, removeModel.modelId)
                setRemoveModel(null)
              }}
            >
              {t('settings.models.deleteModel')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
