import * as React from 'react'
import { createModelsConfigAdapter, type ModelsConfigAdapter } from '@/renderer/adapters/models-config-adapter'
import type { BuiltinProvider, ModelsConfigSnapshot, ModelsConfigTestResult } from '@/shared/models-config'
import { parseModelsConfigDocument, rawModelsProviderDefinition, removeModelsProvider, renameModelsProvider, upsertModelsProvider } from '@/shared/models-config-schema'
import { useConfigurationDocument } from '@/store/configuration-documents'
import type { ConfigurationDocument } from '@/renderer/configuration-documents'
import { useConfigApplyStatus } from './useConfigApplyStatus'
import { cloneJson, uniqueProviderId, type JsonRecord } from './models/provider-editor-model'

export type BuiltinProvidersState =
  | { state: 'loading'; providers: readonly BuiltinProvider[] }
  | { state: 'ready'; providers: readonly BuiltinProvider[] }
  | { state: 'error'; providers: readonly BuiltinProvider[] }

export interface SaveProviderRequest {
  /** The ID it was loaded with; null for a new provider. */
  previousId: string | null
  id: string
  definition: JsonRecord
  /** Make this model the default once saved. */
  defaultModelId?: string | null
}

export function useModelsManager(document: ConfigurationDocument<ModelsConfigSnapshot>, active: boolean) {
  const [adapter] = React.useState<ModelsConfigAdapter | null>(createModelsConfigAdapter)
  const { snapshot, draftText, revision, dirty, phase, error: documentError, savedApply } = useConfigurationDocument(document, active)
  const readApplySnapshot = React.useCallback(() => adapter!.load({ kind: 'global' }), [adapter])
  const apply = useConfigApplyStatus('models:global', snapshot, adapter ? readApplySnapshot : null)
  const loading = phase === 'loading' || (!snapshot && !documentError)
  const saving = phase === 'saving'
  const parsed = React.useMemo(() => parseModelsConfigDocument(draftText), [draftText])
  const [reloadOpen, setReloadOpen] = React.useState(false)
  const [defaultBusy, setDefaultBusy] = React.useState(false)
  const [builtin, setBuiltin] = React.useState<BuiltinProvidersState>({ state: 'loading', providers: [] })

  const refreshBuiltin = React.useCallback(async () => {
    if (!adapter) return
    setBuiltin((current) => ({ state: 'loading', providers: current.providers }))
    try {
      const result = await adapter.builtinProviders()
      setBuiltin({ state: 'ready', providers: result.providers })
    } catch {
      setBuiltin((current) => ({ state: 'error', providers: current.providers }))
    }
  }, [adapter])

  React.useEffect(() => {
    if (active) void refreshBuiltin()
  }, [active, refreshBuiltin])

  const load = React.useCallback(async (confirmDiscard = false) => {
    if (confirmDiscard && dirty) {
      setReloadOpen(true)
      return
    }
    await document.load(true)
  }, [dirty, document])

  /** Write the whole file and apply it to Pi (busy sessions pick it up when idle). */
  const persistText = async (next: string) => {
    if (!adapter || !snapshot || document.getSnapshot().phase !== 'idle') return false
    if (!document.updateDraft(next)) return false
    const result = await document.save(true)
    return result !== null
  }

  /** Save the draft as it is (the file page) and apply it. */
  const saveDraft = async () => {
    if (!adapter || !snapshot || document.getSnapshot().phase !== 'idle') return false
    return await document.save(true) !== null
  }

  const setDefault = async (providerId: string, modelId: string) => {
    if (!adapter) return false
    setDefaultBusy(true)
    try {
      const result = await adapter.setDefault(providerId, modelId)
      if (!result.settingsUpdated) return false
      document.updateSnapshot((previous) => previous ? {
        ...previous,
        ...(result.defaultProvider !== undefined ? { defaultProvider: result.defaultProvider } : {}),
        ...(result.defaultModel !== undefined ? { defaultModel: result.defaultModel } : {}),
      } : previous)
      return true
    } catch {
      return false
    } finally {
      setDefaultBusy(false)
    }
  }

  /** The draft with this provider written in, as the editor would save it. */
  const draftWithProvider = (request: SaveProviderRequest, base = document.getSnapshot().draftText) => {
    let next = base
    if (request.previousId && request.previousId !== request.id) next = renameModelsProvider(next, request.previousId, request.id)
    return upsertModelsProvider(next, request.id, request.definition)
  }

  /**
   * Save one provider and apply it. A renamed provider that held the default
   * keeps it under its new ID (the default lives in Pi's settings.json).
   */
  const saveProvider = async (request: SaveProviderRequest): Promise<'saved' | 'default-failed' | 'failed'> => {
    let next: string
    try {
      next = draftWithProvider(request)
    } catch {
      return 'failed'
    }
    const heldDefault = Boolean(request.previousId && snapshot?.defaultProvider === request.previousId)
    if (!await persistText(next)) return 'failed'
    const modelId = request.defaultModelId ?? (heldDefault && request.previousId !== request.id ? snapshot?.defaultModel : undefined)
    if (!modelId) return 'saved'
    const current = document.getSnapshot().snapshot
    if (current?.defaultProvider === request.id && current.defaultModel === modelId) return 'saved'
    return await setDefault(request.id, modelId) ? 'saved' : 'default-failed'
  }

  const removeProvider = async (providerId: string) => {
    try {
      return await persistText(removeModelsProvider(document.getSnapshot().draftText, providerId))
    } catch {
      return false
    }
  }

  /** A copy without its key: credentials are never copied. */
  const duplicateProvider = async (providerId: string) => {
    const text = document.getSnapshot().draftText
    const raw = rawModelsProviderDefinition(text, providerId)
    if (!raw) return null
    const id = uniqueProviderId(`${providerId}-copy`, parsed.providers.map((provider) => provider.id))
    const definition = cloneJson(raw)
    delete definition.apiKey
    if (typeof definition.name === 'string') definition.name = `${definition.name} copy`
    try {
      return await persistText(upsertModelsProvider(text, id, definition)) ? id : null
    } catch {
      return null
    }
  }

  /** Try one model with `content` as models.json (the editor's unsaved version included). */
  const testModel = (content: string, providerId: string, modelId: string): Promise<ModelsConfigTestResult> => {
    if (!adapter) return Promise.reject(new Error(''))
    return adapter.test({ kind: 'global' }, content, providerId, modelId)
  }

  /** Store or (null) remove the key of one of Pi's own providers in auth.json. */
  const setProviderKey = async (providerId: string, key: string | null) => {
    if (!adapter) return false
    try {
      const result = await adapter.setProviderKey({ providerId, key })
      setBuiltin({ state: 'ready', providers: result.providers })
      return true
    } catch {
      return false
    }
  }

  const rawDefinition = (providerId: string) => rawModelsProviderDefinition(draftText, providerId)

  return {
    adapter, snapshot, draftText, revision, dirty, phase, documentError, savedApply, apply, parsed,
    available: Boolean(adapter), loading, saving, reloadOpen, setReloadOpen, defaultBusy, builtin,
    load, persistText, refreshBuiltin, setDefault, draftWithProvider, saveProvider, removeProvider,
    duplicateProvider, testModel, setProviderKey, rawDefinition, updateDraft: document.updateDraft, saveDraft,
    view: document.getSnapshot().view, setView: document.setView,
    revertDraft: () => { const current = document.getSnapshot().snapshot; if (current) document.updateDraft(current.content) },
  }
}

export type ModelsManager = ReturnType<typeof useModelsManager>
