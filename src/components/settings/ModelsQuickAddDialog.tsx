import * as React from 'react'
import { TbAlertTriangle, TbInfoCircle, TbLoader2, TbSearch, TbX } from 'react-icons/tb'
import { useConfigurationEditTransaction } from '@/store/configuration-documents'
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
import { Checkbox } from '@/components/ui/checkbox'
import { FormDialog } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ModelsConfigProvider, ModelsRemoteListResult } from '@/shared/models-config'
import { ModelsAdvancedFields, ModelsFormField as FormRow } from './ModelsFormFields'
import { findProviderForEndpoint, isLocalEndpoint, isValidEndpoint, normalizeEndpoint, QUICK_ADD_API_TYPES, splitModelIds, type QuickAddValue } from './models-quick-add'

type RemoteModels = ModelsRemoteListResult['models']

interface ModelsQuickAddDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  providers: readonly ModelsConfigProvider[]
  /** Lists the endpoint's models; absent when the bridge is unavailable. */
  listRemote?: (request: { baseUrl: string; api: string; apiKey?: string }) => Promise<ModelsRemoteListResult>
  /** The key already saved for a provider, to list its models without retyping it. */
  storedKey(providerId: string): string | undefined
  /** Writes the value into the draft; false keeps the dialog open. */
  onSubmit(value: QuickAddValue): boolean
  /** The Add button saved it (the Quit transaction only commits the draft). */
  onAdded(): void
}

interface Draft {
  baseUrl: string
  apiKey: string
  modelIds: string[]
  pendingModel: string
  api: string
  name: string
}

type Listing =
  | { state: 'idle' | 'waiting-key' | 'loading' }
  | { state: 'ready'; models: RemoteModels }
  | { state: 'error'; reason: 'key' | 'unreachable' | 'other'; detail: string }

const EMPTY: Draft = { baseUrl: '', apiKey: '', modelIds: [], pendingModel: '', api: QUICK_ADD_API_TYPES[0], name: '' }
/** Small lists start fully ticked; long ones (OpenRouter) start empty. */
const PRESELECT_LIMIT = 10
const SEARCH_FROM = 12

function listingError(error: unknown): Extract<Listing, { state: 'error' }> {
  const { code, message } = (error ?? {}) as { code?: string; message?: string }
  const status = /HTTP (\d{3})/u.exec(message ?? '')?.[1]
  if (status === '401' || status === '403') return { state: 'error', reason: 'key', detail: `HTTP ${status}` }
  if (code === 'MODELS_LIST_UNREACHABLE') return { state: 'error', reason: 'unreachable', detail: message ?? '' }
  return { state: 'error', reason: 'other', detail: message ?? '' }
}

/** One step: endpoint, key and models; the endpoint's model list loads by itself. */
export function ModelsQuickAddDialog({ open, onOpenChange, providers, listRemote, storedKey, onSubmit, onAdded }: ModelsQuickAddDialogProps) {
  const t = useT()
  const [draft, setDraft] = React.useState<Draft>(EMPTY)
  const [checked, setChecked] = React.useState<ReadonlySet<string>>(new Set())
  const [listing, setListing] = React.useState<Listing>({ state: 'idle' })
  const [filter, setFilter] = React.useState('')
  const [attempted, setAttempted] = React.useState(false)
  const [urlTouched, setUrlTouched] = React.useState(false)
  const [advancedOpen, setAdvancedOpen] = React.useState(false)
  const [confirmDiscard, setConfirmDiscard] = React.useState(false)
  const modelInputRef = React.useRef<HTMLInputElement>(null)
  const urlId = React.useId()
  const keyId = React.useId()
  const modelsId = React.useId()
  const apiId = React.useId()
  const nameId = React.useId()

  React.useEffect(() => {
    if (!open) return
    setDraft(EMPTY)
    setChecked(new Set())
    setListing({ state: 'idle' })
    setFilter('')
    setAttempted(false)
    setUrlTouched(false)
    setAdvancedOpen(false)
    setConfirmDiscard(false)
  }, [open])

  const urlValid = isValidEndpoint(draft.baseUrl)
  const existing = urlValid ? findProviderForEndpoint(providers, draft.baseUrl) : undefined
  const knownIds = React.useMemo(() => new Set(existing?.models.map((model) => model.id)), [existing])
  const api = existing?.api || draft.api
  const listKey = draft.apiKey.trim() || (existing ? storedKey(existing.id) : undefined)
  const canList = urlValid && Boolean(listRemote) && (Boolean(listKey) || isLocalEndpoint(draft.baseUrl))

  // Fetch after typing settles; a newer address or key supersedes the request.
  const request = canList ? JSON.stringify([normalizeEndpoint(draft.baseUrl), api, listKey ?? '']) : ''
  React.useEffect(() => {
    if (!open) return
    if (!request) {
      setListing(urlValid && listRemote ? { state: 'waiting-key' } : { state: 'idle' })
      return
    }
    let current = true
    setListing({ state: 'loading' })
    const timer = window.setTimeout(() => {
      listRemote!({ baseUrl: draft.baseUrl.trim(), api, ...(listKey ? { apiKey: listKey } : {}) }).then((result) => {
        if (!current) return
        setListing({ state: 'ready', models: result.models })
        const fresh = result.models.map((model) => model.id).filter((id) => !knownIds.has(id))
        setChecked(new Set(fresh.length <= PRESELECT_LIMIT ? fresh : []))
      }, (error: unknown) => { if (current) setListing(listingError(error)) })
    }, 500)
    return () => { current = false; window.clearTimeout(timer) }
    // `request` captures every input of the listing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, request])

  const remote = listing.state === 'ready' ? listing.models : []
  const remoteIds = new Set(remote.map((model) => model.id))
  const manualIds = [...new Set([...draft.modelIds, ...splitModelIds(draft.pendingModel)])]
  const chosen = [...new Set([...remote.map((model) => model.id).filter((id) => checked.has(id)), ...manualIds])]
  const newIds = chosen.filter((id) => !knownIds.has(id))
  const urlError = !draft.baseUrl.trim() ? t('settings.models.quickAdd.urlRequired')
    : !urlValid ? t('settings.models.quickAdd.urlInvalid') : undefined
  const modelsError = newIds.length === 0
    ? t(chosen.length > 0 ? 'settings.models.quickAdd.modelsExisting' : 'settings.models.quickAdd.modelsRequired') : undefined
  const dirty = JSON.stringify(draft) !== JSON.stringify(EMPTY) || checked.size > 0
  const query = filter.trim().toLowerCase()
  const visible = query ? remote.filter((model) => `${model.id} ${model.name ?? ''}`.toLowerCase().includes(query)) : remote
  const selectable = visible.filter((model) => !knownIds.has(model.id))
  const allVisibleChecked = selectable.length > 0 && selectable.every((model) => checked.has(model.id))

  const update = (patch: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...patch }))
  const toggle = (ids: readonly string[], on: boolean) => setChecked((previous) => {
    const next = new Set(previous)
    for (const id of ids) {
      if (on) next.add(id)
      else next.delete(id)
    }
    return next
  })
  const commitPending = (text = draft.pendingModel) => {
    const ids = splitModelIds(text)
    // An ID that is in the fetched list is simply ticked there.
    toggle(ids.filter((id) => remoteIds.has(id)), true)
    setDraft((previous) => ({ ...previous, pendingModel: '', modelIds: [...new Set([...previous.modelIds, ...ids.filter((id) => !remoteIds.has(id))])] }))
  }

  const handleSubmit = () => {
    if (shutdownLocked) return false
    if (urlError || modelsError) {
      setAttempted(true)
      return false
    }
    return onSubmit({ baseUrl: draft.baseUrl.trim(), apiKey: draft.apiKey.trim(), modelIds: newIds, api: draft.api, name: draft.name })
  }
  const shutdownLocked = useConfigurationEditTransaction(open, { dirty, revision: [draft, [...checked]], commit: handleSubmit })

  const requestOpenChange = (next: boolean) => {
    if (next) onOpenChange(true)
    else if (dirty) setConfirmDiscard(true)
    else onOpenChange(false)
  }
  const required = <span className="text-destructive" aria-hidden="true">{' *'}</span>

  return <>
    <FormDialog
      open={open}
      onOpenChange={requestOpenChange}
      title={t('settings.models.quickAdd.title')}
      description={t('settings.models.quickAdd.description')}
      className="sm:max-w-[560px]"
      bodyClassName="py-5"
      cancelLabel={t('common.cancel')}
      submitLabel={newIds.length > 1 ? t('settings.models.quickAdd.submitCount', { count: newIds.length }) : t('settings.models.quickAdd.submit')}
      onSubmit={() => { if (handleSubmit()) onAdded() }}
      disabled={shutdownLocked}
    >
      <div className="flex flex-col gap-4" data-models-quick-add>
        <FormRow label={<span>{t('settings.models.form.baseUrl')}{required}</span>} htmlFor={urlId}
          error={(attempted || urlTouched) ? urlError : undefined}>
          <Input id={urlId} value={draft.baseUrl} autoFocus spellCheck={false} autoComplete="off"
            placeholder="https://api.example.com/v1" className="font-mono"
            aria-invalid={((attempted || urlTouched) && urlError !== undefined) || undefined}
            aria-describedby={(attempted || urlTouched) && urlError ? `${urlId}-feedback` : undefined}
            onChange={(event) => update({ baseUrl: event.target.value })} onBlur={() => setUrlTouched(true)} />
          {existing ? <p className="flex items-start gap-1.5 text-micro leading-relaxed text-muted-foreground" role="status" data-quick-add-existing={existing.id}>
            <TbInfoCircle className="mt-px size-3.5 shrink-0 text-primary" aria-hidden />
            {t('settings.models.quickAdd.existing', { name: existing.name || existing.id })}
          </p> : null}
        </FormRow>

        <FormRow label={t('settings.models.form.apiKey')} htmlFor={keyId} hint={t('settings.models.quickAdd.keyHint')}>
          <Input id={keyId} type="password" value={draft.apiKey} autoComplete="off" className="font-mono"
            aria-describedby={`${keyId}-feedback`}
            placeholder={t(existing?.hasApiKey ? 'settings.models.form.apiKeyPlaceholderEdit' : 'settings.models.form.apiKeyPlaceholderAdd')}
            onChange={(event) => update({ apiKey: event.target.value })} />
        </FormRow>

        <FormRow label={<span>{t('settings.models.quickAdd.models')}{required}</span>} htmlFor={modelsId}
          error={attempted ? modelsError : undefined}
          hint={t(listing.state === 'ready' && remote.length ? 'settings.models.quickAdd.manualHint' : 'settings.models.quickAdd.modelsHint')}>
          {listing.state === 'waiting-key' ? <p className="text-micro text-muted-foreground" data-quick-add-listing="waiting-key">{t('settings.models.quickAdd.listNeedsKey')}</p>
            : listing.state === 'loading' ? <p className="flex items-center gap-1.5 text-micro text-muted-foreground" role="status" data-quick-add-listing="loading">
              <TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />{t('settings.models.quickAdd.listLoading')}
            </p>
              : listing.state === 'error' ? <p className="flex items-start gap-1.5 text-micro leading-relaxed text-muted-foreground" role="status" data-quick-add-listing="error">
                <TbAlertTriangle className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
                {t(`settings.models.quickAdd.listFailed.${listing.reason}`, { detail: listing.detail })}
              </p>
                : listing.state === 'ready' && remote.length === 0 ? <p className="text-micro text-muted-foreground" role="status" data-quick-add-listing="empty">{t('settings.models.quickAdd.listEmpty')}</p>
                  : null}

          {listing.state === 'ready' && remote.length > 0 ? <div className="mac-box overflow-hidden" data-quick-add-listing="ready">
            <div className="flex items-center gap-2 border-b border-border/70 px-2.5 py-1.5">
              <Checkbox checked={allVisibleChecked ? true : selectable.some((model) => checked.has(model.id)) ? 'indeterminate' : false}
                disabled={selectable.length === 0} aria-label={t('settings.models.quickAdd.selectAll')}
                onCheckedChange={(on) => toggle(selectable.map((model) => model.id), on === true)} />
              <span className="min-w-0 flex-1 truncate text-micro text-muted-foreground" role="status">
                {t('settings.models.quickAdd.listSummary', { count: remote.length, selected: chosen.filter((id) => remoteIds.has(id) && !knownIds.has(id)).length })}
              </span>
              {remote.length >= SEARCH_FROM ? <div className="relative w-40">
                <TbSearch className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input type="search" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label={t('settings.models.quickAdd.filter')}
                  placeholder={t('settings.models.quickAdd.filter')} className="h-6 rounded-full bg-fill pl-6 text-caption shadow-none dark:bg-fill" />
              </div> : null}
            </div>
            <ul className="scroll-slim max-h-[220px] overflow-y-auto py-1" aria-label={t('settings.models.quickAdd.models')}>
              {visible.map((model) => {
                const known = knownIds.has(model.id)
                return <li key={model.id}>
                  <label className={cn('flex min-h-[28px] items-center gap-2 px-2.5 py-1 hover:bg-fill', known && 'opacity-60')} data-quick-add-remote={model.id}>
                    <Checkbox checked={known || checked.has(model.id)} disabled={known} onCheckedChange={(on) => toggle([model.id], on === true)} />
                    <span className="min-w-0 flex-1 truncate font-mono text-caption">{model.id}</span>
                    {known ? <span className="shrink-0 text-micro text-muted-foreground">{t('settings.models.quickAdd.modelExists')}</span>
                      : model.name ? <span className="max-w-[45%] shrink-0 truncate text-micro text-muted-foreground">{model.name}</span> : null}
                  </label>
                </li>
              })}
              {visible.length === 0 ? <li className="px-2.5 py-2 text-micro text-muted-foreground">{t('settings.models.quickAdd.filterEmpty')}</li> : null}
            </ul>
          </div> : null}

          {/* Model IDs not in the list: Enter, comma or paste adds; Backspace on empty removes the last. */}
          <div onClick={() => modelInputRef.current?.focus()}
            className={cn('flex min-h-(--control-h) w-full flex-wrap items-center gap-1 rounded-md bg-control px-1 py-[3px] shadow-[0_0_0_0.5px_var(--color-input),inset_0_0.5px_1px_rgb(0_0_0/0.06)] transition-[box-shadow] duration-(--duration-fast) focus-within:shadow-[0_0_0_0.5px_var(--color-ring),0_0_0_3.5px_color-mix(in_srgb,var(--color-ring)_45%,transparent)] dark:bg-white/5',
              attempted && modelsError && 'shadow-[0_0_0_1px_var(--color-destructive)]')}>
            {draft.modelIds.map((id) => <span key={id} data-quick-add-model={id}
              className={cn('inline-flex h-[22px] max-w-full items-center gap-0.5 rounded-full bg-fill-strong pr-0.5 pl-2 font-mono text-caption', knownIds.has(id) && 'text-muted-foreground line-through')}
              title={knownIds.has(id) ? t('settings.models.quickAdd.modelExists') : undefined}>
              <span className="truncate">{id}</span>
              <button type="button" aria-label={t('settings.models.quickAdd.removeModel', { id })}
                className="flex size-[18px] shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-fill hover:text-foreground focus-visible:focus-ring"
                onClick={(event) => { event.stopPropagation(); update({ modelIds: draft.modelIds.filter((candidate) => candidate !== id) }) }}>
                <TbX className="size-3" aria-hidden />
              </button>
            </span>)}
            <input ref={modelInputRef} id={modelsId} value={draft.pendingModel} spellCheck={false} autoComplete="off"
              placeholder={draft.modelIds.length ? '' : t(listing.state === 'ready' && remote.length ? 'settings.models.quickAdd.manualPlaceholder' : 'settings.models.quickAdd.modelsPlaceholder')}
              aria-invalid={(attempted && modelsError !== undefined) || undefined}
              aria-describedby={`${modelsId}-feedback`}
              className="h-[22px] min-w-32 flex-1 bg-transparent px-1 font-mono text-app text-foreground outline-none placeholder:font-sans placeholder:text-muted-foreground/80"
              onChange={(event) => {
                const value = event.target.value
                if (/[\s,，、]/u.test(value)) commitPending(value)
                else update({ pendingModel: value })
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  if (draft.pendingModel.trim()) commitPending()
                  else if (handleSubmit()) onAdded()
                } else if (event.key === 'Backspace' && !draft.pendingModel && draft.modelIds.length) {
                  update({ modelIds: draft.modelIds.slice(0, -1) })
                }
              }}
              onBlur={() => { if (draft.pendingModel.trim()) commitPending() }} />
          </div>
        </FormRow>

        {/* An endpoint that is already added keeps its own type and name. */}
        {!existing ? <ModelsAdvancedFields open={advancedOpen} onOpenChange={setAdvancedOpen} title={t('settings.models.quickAdd.more')}
          description={t('settings.models.quickAdd.moreDescription')}>
          <FormRow label={t('settings.models.form.api')} htmlFor={apiId}>
            <select id={apiId} className="mac-select w-full" value={draft.api} onChange={(event) => update({ api: event.target.value })}>
              {QUICK_ADD_API_TYPES.map((type) => <option key={type} value={type}>{t(`settings.models.quickAdd.api.${type}`)}</option>)}
            </select>
          </FormRow>
          <FormRow label={t('settings.models.form.name')} htmlFor={nameId}>
            <Input id={nameId} value={draft.name} placeholder={t('settings.models.form.namePlaceholder')}
              onChange={(event) => update({ name: event.target.value })} />
          </FormRow>
        </ModelsAdvancedFields> : null}
      </div>
    </FormDialog>

    <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('settings.models.form.dirtyTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('settings.models.form.dirtyDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('settings.models.form.dirtyKeep')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => { setConfirmDiscard(false); onOpenChange(false) }}>
            {t('settings.models.form.dirtyDiscard')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>
}
