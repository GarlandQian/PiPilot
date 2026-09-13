import * as React from 'react'
import { useT } from '@/i18n'
import { createModelsConfigAdapter, type ModelsConfigAdapter } from '@/renderer/adapters/models-config-adapter'
import { structuredProviderSupported, type ModelsConfigModel, type ModelsConfigProvider, type ModelsConfigSnapshot } from '@/shared/models-config'
import { parseModelsConfigDocument, rawModelsProviderDefinition, removeModelsProvider, renameModelsProvider, upsertModelsProvider } from '@/shared/models-config-schema'
import { useConfigurationDocument } from '@/store/configuration-documents'
import type { ConfigurationDocument } from '@/renderer/configuration-documents'
import { useConfigApplyStatus } from './useConfigApplyStatus'
import { definitionFromFormValues, formValueFromModel, formValueFromProvider, type ModelFormValue, type ProviderFormValue } from './models-form-model'
import { modelTestSuccess, settleModelTest, type ModelTestStates } from './models-test-state'

type ProviderDialogState =
  | { mode: 'add' }
  | { mode: 'edit'; provider: ModelsConfigProvider }

type ModelDialogState =
  | { providerId: string; mode: 'add' }
  | { providerId: string; mode: 'edit'; model: ModelsConfigModel }

export function modelSelectionKey(providerId: string, modelId: string) {
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

export function useModelsManager(document: ConfigurationDocument<ModelsConfigSnapshot>, active: boolean) {
  const t = useT()
  const [adapter] = React.useState<ModelsConfigAdapter | null>(createModelsConfigAdapter)
  const { snapshot, draftText, revision, view, dirty, phase, error: documentError, savedApply } = useConfigurationDocument(document, active)
  const setSnapshot = document.updateSnapshot
  const setView = document.setView
  const updateDraft = document.updateDraft
  const readApplySnapshot = React.useCallback(() => adapter!.load({ kind: 'global' }), [adapter])
  const apply = useConfigApplyStatus('models:global', snapshot, adapter ? readApplySnapshot : null)
  const loading = phase === 'loading' || (!snapshot && !documentError)
  const saving = phase === 'saving'
  const [reloadOpen, setReloadOpen] = React.useState(false)
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
  const [selectedProviderId, setSelectedProviderId] = React.useState<string | null>(null)
  const [selectedCustomModels, setSelectedCustomModels] = React.useState<Set<string>>(
    () => new Set(),
  )
  const [modelTests, setModelTests] = React.useState<ModelTestStates>({})
  const modelTestRequests = React.useRef(new Map<string, { revision: number; requestId: number }>())
  const nextModelTestRequest = React.useRef(0)
  const parsed = React.useMemo(() => parseModelsConfigDocument(draftText), [draftText])
  // The structured form owns common fields and preserves advanced fields
  // from the raw JSONC draft. Advanced entries are a notice, not a gate.
  const hasAdvancedFields = parsed.valid && parsed.providers.some(
    (provider) => !structuredProviderSupported(provider),
  )
  const load = React.useCallback(async (confirmDiscard = false) => {
    if (confirmDiscard && dirty) {
      setReloadOpen(true)
      return
    }
    setError(null)
    setStatus(null)
    await document.load(true)
  }, [dirty, document])

  const save = async (restart: boolean) => {
    if (!adapter || !snapshot || (!dirty && !restart) || !parsed.valid || loading || saving) return
    setError(null)
    setStatus(null)
    await document.save(restart)
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
    if (!adapter || !parsed.valid || loading || saving) return
    const key = modelSelectionKey(providerId, modelId)
    const testedRevision = document.getSnapshot().revision
    if (modelTestRequests.current.get(key)?.revision === testedRevision) return
    const identity = { revision: testedRevision, requestId: ++nextModelTestRequest.current }
    modelTestRequests.current.set(key, identity)
    setModelTests((previous) => ({ ...previous, [key]: { state: 'testing', ...identity } }))
    try {
      const result = await adapter.test({ kind: 'global' }, draftText, providerId, modelId)
      setModelTests((previous) => settleModelTest(previous, key, identity,
        document.getSnapshot().revision, modelTestSuccess(result)))
    } catch (caught) {
      setModelTests((previous) => settleModelTest(previous, key, identity,
        document.getSnapshot().revision, {
          state: 'error',
          message: caught instanceof Error && caught.message ? caught.message : t('settings.models.testFailed'),
        }))
    } finally {
      if (modelTestRequests.current.get(key)?.requestId === identity.requestId) {
        modelTestRequests.current.delete(key)
      }
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
      setSelectedProviderId(value.id)
      setSelectedCustomModels(new Set())
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

  const selectProvider = (providerId: string) => {
    setSelectedProviderId(providerId)
    setSelectedCustomModels(new Set())
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
      setSelectedProviderId(id)
      setSelectedCustomModels(new Set())
      setStatus(t('settings.models.providerDuplicated'))
      setError(null)
    } catch {
      setError(t('settings.models.editFailed'))
    }
  }

  const deleteSelectedModels = (targetProviderId: string) => {
    if (selectedCustomModels.size === 0) return
    try {
      let next = draftText
      for (const selection of selectedCustomModels) {
        const pair = decodeModelSelectionKey(selection)
        if (!pair) continue
        const [providerId, modelId] = pair
        if (providerId !== targetProviderId) continue
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
      setSelectedCustomModels((previous) => new Set([...previous].filter((selection) =>
        decodeModelSelectionKey(selection)?.[0] !== targetProviderId)))
      setStatus(t('settings.models.modelsDeleted'))
      setError(null)
    } catch {
      setError(t('settings.models.editFailed'))
    }
  }

  const isDefault = (providerId: string, modelId: string) =>
    snapshot?.defaultProvider === providerId && snapshot?.defaultModel === modelId

  return {
    snapshot, draftText, revision, view, dirty, phase, documentError, savedApply, apply,
    available: Boolean(adapter), loading, saving, reloadOpen, setReloadOpen,
    error, status, providerDialog, setProviderDialog, modelDialog, setModelDialog,
    removeProviderId, setRemoveProviderId, removeModel, setRemoveModel, defaultBusy,
    selectedProviderId, selectProvider, selectedCustomModels, modelTests, parsed, hasAdvancedFields,
    load, save, setDefault, testModel, submitProviderForm, submitModelForm, removeProvider,
    removeModelFromProvider, toggleCustomModel, duplicateProvider, deleteSelectedModels,
    isDefault, setView, updateDraft,
  }
}

export type ModelsManager = ReturnType<typeof useModelsManager>
