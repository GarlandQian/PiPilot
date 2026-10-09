import * as React from 'react'
import { TbAlertTriangle, TbDots, TbFileCode, TbLoader2, TbPlus, TbRefresh } from 'react-icons/tb'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'
import { useLocale, useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ModelsConfigSnapshot } from '@/shared/models-config'
import { isLocalAddress, localizedText, presetForProvider, PROVIDER_PRESETS, type ProviderPreset, type PresetMatch } from '@/shared/model-provider-presets'
import type { ConfigurationDocument } from '@/renderer/configuration-documents'
import { useModelsConfigurationDocument } from '@/store/configuration-documents'
import { useSettings, useUpdateSettings } from '@/store/settings'
import { subscribeModelsQuickAddRequest, takeModelsQuickAddRequest } from '@/renderer/models-intent'
import { SettingRow, SettingSection } from './common'
import { ConfigApplyNotice } from './ConfigApplyNotice'
import { ConfigurationDocumentError, ConfigurationDocumentUnavailable, ConfigurationReloadConfirmation } from './ConfigurationDocumentFeedback'
import { ModelsRuntimeSettings } from './ModelsRuntimeSettings'
import { useSettingsSubpage } from './settings-subpage'
import { useModelsManager, type ModelsManager } from './useModelsManager'
import { BuiltinProviderEditor } from './models/BuiltinProviderEditor'
import { CustomProviderEditor, type CustomEditorTarget } from './models/CustomProviderEditor'
import { DiscardChangesDialog, type TestState } from './editor-page'
import { ModelsFileEditor } from './models/ModelsFileEditor'
import { ProviderCardList, ProvidersEmpty, type ProviderCardEntry } from './models/ProviderCardList'
import { ProviderPresetPicker } from './models/ProviderPresetPicker'
import { uniqueProviderId } from './models/provider-editor-model'

type Route =
  | { page: 'list' }
  | { page: 'presets' }
  | { page: 'custom'; target: CustomEditorTarget; from: 'list' | 'presets'; nonce: number }
  | { page: 'builtin'; providerId: string; preset: PresetMatch | null; isNew: boolean; from: 'list' | 'presets'; nonce: number }
  | { page: 'file'; nonce: number }

export function ModelsSettings({ operationOwnerKey, active = true }: { operationOwnerKey: string; active?: boolean }) {
  const [, retry] = React.useReducer((value: number) => value + 1, 0)
  const { document, available } = useModelsConfigurationDocument()
  return document ? <ModelsDocumentSettings document={document} operationOwnerKey={operationOwnerKey} active={active} />
    : <ConfigurationDocumentUnavailable capacity={available} retry={retry} />
}

const endpoint = (url: string | undefined) => {
  if (!url) return ''
  try {
    const parsed = new URL(url.trim())
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/u, '')}`
  } catch {
    return ''
  }
}

let nonce = 0

function ModelsDocumentSettings({ document, operationOwnerKey, active }: {
  document: ConfigurationDocument<ModelsConfigSnapshot>
  operationOwnerKey: string
  active: boolean
}) {
  const t = useT()
  const locale = useLocale()
  const manager = useModelsManager(document, active)
  const settings = useSettings()
  const { update: updateSettings } = useUpdateSettings()
  const rootRef = React.useRef<HTMLDivElement>(null)
  // The file page lives in the document's view, so it survives like the draft it edits.
  const [route, setRoute] = React.useState<Route>(() => document.getSnapshot().view === 'json' ? { page: 'file', nonce: ++nonce } : { page: 'list' })
  const [pending, setPending] = React.useState<Route | null>(null)
  const editorDirty = React.useRef(false)
  const onDirtyChange = React.useCallback((dirty: boolean) => { editorDirty.current = dirty }, [])
  const [recent, setRecent] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<{ text: string; error?: boolean } | null>(null)
  const [cardTests, setCardTests] = React.useState<Readonly<Record<string, TestState>>>({})
  const [removing, setRemoving] = React.useState<ProviderCardEntry | null>(null)
  const listScroll = React.useRef(0)

  const { parsed, snapshot } = manager
  const builtinProviders = manager.builtin.providers
  const builtinIds = React.useMemo(() => new Set(builtinProviders.map((provider) => provider.id)), [builtinProviders])
  const builtinBaseUrls = React.useMemo(() => Object.fromEntries(builtinProviders.map((provider) => [provider.id, provider.baseUrl])), [builtinProviders])
  const customIds = parsed.providers.map((provider) => provider.id)
  const entries: ProviderCardEntry[] = [
    ...parsed.providers.map((provider) => ({ kind: 'custom' as const, id: provider.id, provider })),
    ...builtinProviders.filter((provider) => provider.configured && !customIds.includes(provider.id))
      .map((provider) => ({ kind: 'builtin' as const, id: provider.id, provider })),
  ]
  const ready = Boolean(snapshot) && !manager.loading
  const editable = ready && parsed.valid && !manager.saving

  /* -------------------------- navigation -------------------------- */

  const scroller = () => rootRef.current?.closest<HTMLElement>('[data-settings-section]') ?? null
  const show = (next: Route) => {
    const container = scroller()
    if (route.page === 'list' && container) listScroll.current = container.scrollTop
    editorDirty.current = false
    manager.setView(next.page === 'file' ? 'json' : 'form')
    setRoute(next)
    requestAnimationFrame(() => {
      const target = scroller()
      if (target) target.scrollTop = next.page === 'list' ? listScroll.current : 0
    })
  }
  const navigate = (next: Route) => {
    if ((route.page === 'custom' || route.page === 'builtin' || route.page === 'file') && editorDirty.current) setPending(next)
    else show(next)
  }
  const back = () => navigate(route.page === 'custom' || route.page === 'builtin' ? (route.from === 'presets' ? { page: 'presets' } : { page: 'list' }) : { page: 'list' })

  const subpageTitle = (() => {
    switch (route.page) {
      case 'list': return null
      case 'presets': return t('settings.models.presets.title')
      case 'file': return t('settings.models.file.title')
      case 'builtin': {
        const provider = builtinProviders.find((candidate) => candidate.id === route.providerId)
        return route.preset ? localizedText(route.preset.preset.name, locale) : provider?.name ?? route.providerId
      }
      case 'custom': return route.target.previousId === null ? t('settings.models.presets.addTitle', { name: route.target.preset ? localizedText(route.target.preset.preset.name, locale) : t('settings.models.editor.newProvider') })
        : (typeof route.target.definition.name === 'string' && route.target.definition.name) || route.target.previousId
    }
  })()
  useSettingsSubpage('models', subpageTitle === null ? null : { title: subpageTitle, back })

  /* ----------------------------- open ----------------------------- */

  const customTarget = (id: string, fill = false): CustomEditorTarget | null => {
    const definition = manager.rawDefinition(id)
    if (!definition) return null
    const provider = parsed.providers.find((candidate) => candidate.id === id)
    return { previousId: id, id, definition, preset: presetForProvider({ id, baseUrl: provider?.baseUrl }, builtinBaseUrls), fill }
  }

  const editEntry = (entry: ProviderCardEntry, fill = false) => {
    if (entry.kind === 'builtin') {
      show({ page: 'builtin', providerId: entry.id, preset: presetForProvider({ id: entry.id, builtin: true }), isNew: false, from: 'list', nonce: ++nonce })
      return
    }
    const target = customTarget(entry.id, fill)
    if (target) show({ page: 'custom', target, from: 'list', nonce: ++nonce })
  }

  /** A preset version is set up already: a configured Pi provider, or a models.json provider at its address. */
  const existingFor = (version: ProviderPreset['versions'][number]) => version.kind === 'builtin'
    ? builtinProviders.find((provider) => provider.id === version.providerId && provider.configured) ? version.providerId : null
    : version.baseUrl ? parsed.providers.find((provider) => endpoint(provider.baseUrl) === endpoint(version.baseUrl))?.id ?? null : null

  const openPreset = (preset: ProviderPreset, versionKey?: string) => {
    const version = (versionKey ? preset.versions.find((candidate) => candidate.key === versionKey) : undefined)
      ?? preset.versions.find((candidate) => !existingFor(candidate)) ?? preset.versions[0]
    const go = navigate
    const match: PresetMatch = { preset, version, exact: true }
    const existing = existingFor(version)
    if (version.kind === 'builtin') {
      go({ page: 'builtin', providerId: version.providerId, preset: match, isNew: !existing, from: 'presets', nonce: ++nonce })
      return
    }
    if (existing) {
      const target = customTarget(existing)
      if (target) go({ page: 'custom', target: { ...target, preset: match }, from: 'presets', nonce: ++nonce })
      return
    }
    const presetName = localizedText(preset.name, locale)
    const customVersions = preset.versions.filter((candidate) => candidate.kind === 'custom').length
    const name = preset.category === 'custom' ? '' : customVersions > 1 || preset.versions.length > 1 ? `${presetName} · ${localizedText(version.label, locale)}` : presetName
    const id = uniqueProviderId(version.providerId, [...customIds, ...builtinIds])
    go({
      page: 'custom', from: 'presets', nonce: ++nonce,
      target: {
        previousId: null, id, preset: preset.category === 'custom' ? null : match,
        definition: {
          ...(name ? { name } : {}),
          ...(version.baseUrl ? { baseUrl: version.baseUrl } : {}),
          api: version.api,
          ...(version.compat ? { compat: { ...version.compat } } : {}),
          ...(version.local || isLocalAddress(version.baseUrl) ? { apiKey: 'local' } : {}),
          models: [],
        },
      },
    })
  }

  // "Add model" from the composer's model picker opens the preset list here.
  React.useEffect(() => {
    if (!ready) return
    const take = () => { if (takeModelsQuickAddRequest()) navigate({ page: 'presets' }) }
    take()
    return subscribeModelsQuickAddRequest(take)
    // `navigate` is recreated each render; the request is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  React.useEffect(() => {
    if (!recent) return
    const timer = window.setTimeout(() => setRecent(null), 4_000)
    return () => window.clearTimeout(timer)
  }, [recent])

  const done = ({ id, notice: message }: { id: string; notice?: string }) => {
    show({ page: 'list' })
    setRecent(id)
    setNotice(message ? { text: message, error: true } : null)
  }

  /* ---------------------------- cards ----------------------------- */

  const testEntry = async (entry: ProviderCardEntry) => {
    setCardTests((current) => ({ ...current, [entry.id]: { state: 'testing' } }))
    try {
      let modelId = snapshot?.defaultProvider === entry.id ? snapshot.defaultModel : undefined
      if (!modelId && entry.kind === 'custom') modelId = entry.provider.models[0]?.id
      if (!modelId && entry.kind === 'builtin') modelId = (await manager.adapter?.providerCatalog(entry.id))?.models[0]?.id
      if (!modelId) throw new Error(t('settings.models.cards.nothingToTest'))
      const result = await manager.testModel(manager.draftText, entry.id, modelId)
      setCardTests((current) => ({ ...current, [entry.id]: { state: 'success', latencyMs: result.latencyMs, preview: modelId! } }))
    } catch (caught) {
      setCardTests((current) => ({ ...current, [entry.id]: { state: 'error', message: caught instanceof Error && caught.message ? caught.message : t('settings.models.testFailed') } }))
    }
  }

  const duplicate = async (id: string) => {
    const copy = await manager.duplicateProvider(id)
    if (copy) { setRecent(copy); setNotice({ text: t('settings.models.providerDuplicated') }) }
    else setNotice({ text: t('settings.models.editFailed'), error: true })
  }

  const confirmRemove = async () => {
    const entry = removing
    setRemoving(null)
    if (!entry) return
    const removed = entry.kind === 'custom' ? await manager.removeProvider(entry.id) : await manager.setProviderKey(entry.id, null)
    setNotice(removed ? null : { text: t('settings.models.editFailed'), error: true })
  }

  const added = React.useMemo(() => new Set(PROVIDER_PRESETS.filter((preset) => preset.category !== 'custom' && preset.versions.some((version) => existingFor(version))).map((preset) => preset.key)),
    // `existingFor` reads exactly these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [builtinProviders, parsed.providers])

  /* ---------------------------- pages ----------------------------- */

  const page = (() => {
    switch (route.page) {
      case 'presets': return <ProviderPresetPicker added={added} onPick={(preset) => openPreset(preset)} />
      case 'file': return <ModelsFileEditor key={route.nonce} manager={manager} onDone={() => done({ id: '' })} onCancel={back} onDirtyChange={onDirtyChange} />
      case 'builtin': return <BuiltinProviderEditor key={route.nonce} manager={manager} providerId={route.providerId} preset={route.preset} isNew={route.isNew}
        onVersion={route.preset ? (key) => openPreset(route.preset!.preset, key) : undefined}
        onChangePreset={() => navigate({ page: 'presets' })} onDone={done} onCancel={back} onDirtyChange={onDirtyChange} />
      case 'custom': return <CustomProviderEditor key={route.nonce} manager={manager} target={route.target}
        takenIds={customIds.filter((id) => id !== route.target.previousId)} builtinIds={builtinIds}
        onVersion={route.target.previousId === null && route.target.preset ? (key) => openPreset(route.target.preset!.preset, key) : undefined}
        onChangePreset={route.target.previousId === null ? () => navigate({ page: 'presets' }) : undefined}
        onDone={done} onCancel={back} onDirtyChange={onDirtyChange} />
      case 'list': return null
    }
  })()

  return <div ref={rootRef} className="min-w-0" data-models-settings data-models-page={route.page}>
    {route.page !== 'list' ? (manager.loading ? <Loading /> : page) : <div className="min-w-0 space-y-7">
      <ModelsRuntimeSettings snapshot={snapshot} operationOwnerKey={operationOwnerKey} />
      <section className="min-w-0" aria-label={t('settings.models.cards.title')} data-models-providers>
        <header className="mb-2 flex min-w-0 flex-wrap items-end gap-x-3 gap-y-2 px-1">
          <div className="min-w-0 flex-1 basis-64">
            <h2 className="text-app font-semibold text-foreground">{t('settings.models.cards.title')}</h2>
            <p className="mt-0.5 max-w-[72ch] text-caption leading-snug text-muted-foreground">{t('settings.models.cards.description')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {manager.saving ? <TbLoader2 className="mr-1 size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-label={t('settings.models.workspace.saving')} /> : null}
            <Button variant="outline" size="sm" disabled={!editable} onClick={() => navigate({ page: 'presets' })}><TbPlus aria-hidden />{t('settings.models.cards.add')}</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={t('settings.models.cards.more')}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!ready} onSelect={() => show({ page: 'file', nonce: ++nonce })}><TbFileCode aria-hidden />{t('settings.models.file.open')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!manager.available || manager.loading || manager.saving} onSelect={() => { void manager.load(true); void manager.refreshBuiltin() }}><TbRefresh aria-hidden />{t('common.refresh')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div className="min-w-0 space-y-2">
          <ConfigApplyNotice status={manager.apply.status} readFailed={manager.apply.readFailed} />
          <ConfigurationDocumentError error={manager.documentError} />
          {notice ? <div role={notice.error ? 'alert' : 'status'} className={cn('px-1 text-caption [&_.md-body]:text-caption', notice.error ? 'text-destructive [&_.md-body]:text-destructive' : 'text-muted-foreground')}><MarkdownContent markdown={notice.text} /></div> : null}
          {!snapshot?.applyStatus && manager.savedApply && manager.savedApply !== 'applied' && manager.savedApply !== 'saved' ? <p className="px-1 text-caption text-muted-foreground" role="status">{t(`settings.models.apply.${manager.savedApply}`)}</p> : null}
          {manager.loading ? <div className="mac-group"><Loading /></div>
            : !parsed.valid ? <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg bg-destructive/8 px-3.5 py-2.5" role="alert">
              <TbAlertTriangle className="size-4 shrink-0 text-destructive" aria-hidden />
              <p className="min-w-0 flex-1 text-caption text-destructive">{t('settings.models.cards.invalidFile')}</p>
              <Button variant="outline" size="sm" onClick={() => show({ page: 'file', nonce: ++nonce })}>{t('settings.models.file.open')}</Button>
            </div>
              : entries.length === 0 ? (manager.builtin.state === 'loading' ? <div className="mac-group"><Loading /></div> : <ProvidersEmpty disabled={!editable} onAdd={() => navigate({ page: 'presets' })} />)
                : <ProviderCardList entries={entries} defaultProvider={snapshot?.defaultProvider} builtinBaseUrls={builtinBaseUrls} tests={cardTests} recent={recent}
                  disabled={!editable} actions={{
                    edit: (entry) => editEntry(entry),
                    test: (entry) => void testEntry(entry),
                    duplicate: (id) => void duplicate(id),
                    fill: (id) => editEntry({ kind: 'custom', id, provider: parsed.providers.find((provider) => provider.id === id)! }, true),
                    remove: setRemoving,
                  }} />}
          {manager.builtin.state === 'error' ? <p className="px-1 text-micro text-muted-foreground" role="status">{t('settings.models.cards.builtinFailed')}</p> : null}
        </div>
      </section>
      <SettingSection title={t('settings.models.metadata.title')}>
        <SettingRow label={t('settings.models.metadata.online')} desc={t('settings.models.metadata.onlineDescription')}>
          <Switch checked={settings.models.onlineMetadata} aria-label={t('settings.models.metadata.online')}
            onCheckedChange={(onlineMetadata) => updateSettings({ models: { onlineMetadata } })} />
        </SettingRow>
      </SettingSection>
    </div>}

    <ConfigurationReloadConfirmation open={manager.reloadOpen} onOpenChange={manager.setReloadOpen} onReload={() => { manager.setReloadOpen(false); void manager.load() }} />
    <DiscardChangesDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null) }}
      onDiscard={() => { const next = pending; setPending(null); if (route.page === 'file') manager.revertDraft(); if (next) show(next) }} />
    <RemoveProviderDialog entry={removing} manager={manager} onOpenChange={(open) => { if (!open) setRemoving(null) }} onConfirm={() => void confirmRemove()} />
  </div>
}

function Loading() {
  const t = useT()
  return <div className="flex min-h-40 items-center justify-center gap-2 text-caption text-muted-foreground" role="status"><TbLoader2 className="size-4 animate-spin" aria-hidden />{t('settings.models.loading')}</div>
}

function RemoveProviderDialog({ entry, manager, onOpenChange, onConfirm }: {
  entry: ProviderCardEntry | null
  manager: ModelsManager
  onOpenChange(open: boolean): void
  onConfirm(): void
}) {
  const t = useT()
  const name = entry ? entry.provider.name || entry.id : ''
  return <AlertDialog open={entry !== null} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{t(entry?.kind === 'builtin' ? 'settings.models.builtin.removeKeyTitle' : 'settings.models.deleteProviderConfirm', { name })}</AlertDialogTitle>
        <AlertDialogDescription>{t(entry?.kind === 'builtin' ? 'settings.models.builtin.removeKeyDescription' : 'settings.models.deleteProviderConfirmDesc')}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
        <AlertDialogAction variant="destructive" disabled={manager.saving} onClick={onConfirm}>
          {t(entry?.kind === 'builtin' ? 'settings.models.builtin.removeKey' : 'settings.models.deleteProvider')}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
}
