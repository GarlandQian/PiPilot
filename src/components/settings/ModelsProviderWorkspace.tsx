import * as React from 'react'
import { TbArrowRight, TbCopy, TbDots, TbEdit, TbKey, TbPlus, TbSearch, TbServer, TbTrash, TbX } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useLocale, useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { structuredProviderSupported } from '@/shared/models-config'
import { ModelsModelRow } from './ModelsModelRow'
import { searchModelProviders } from './models-catalog-model'
import { modelSelectionKey, type ModelsManager } from './useModelsManager'

export function ModelsProviderWorkspace({ manager }: { manager: ModelsManager }) {
  const t = useT()
  const locale = useLocale()
  const [query, setQuery] = React.useState('')
  const searchRef = React.useRef<HTMLInputElement>(null)
  const providerListRef = React.useRef<HTMLElement>(null)
  const numberFormat = React.useMemo(() => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }), [locale])
  const results = React.useMemo(() => searchModelProviders(manager.parsed.providers, query), [manager.parsed.providers, query])
  const selected = results.find(({ provider }) => provider.id === manager.selectedProviderId)
    ?? results.find(({ provider }) => provider.id === manager.snapshot?.defaultProvider)
    ?? results[0]
  const provider = selected?.provider
  const disabled = !manager.snapshot || manager.loading || manager.saving || !manager.parsed.valid
  const visibleSelections = selected?.models.map((model) => modelSelectionKey(selected.provider.id, model.id)) ?? []
  const selectedCount = provider?.models.filter((model) => manager.selectedCustomModels.has(modelSelectionKey(provider.id, model.id))).length ?? 0
  const visibleSelectedCount = visibleSelections.filter((key) => manager.selectedCustomModels.has(key)).length
  const allVisibleSelected = visibleSelections.length > 0 && visibleSelectedCount === visibleSelections.length
  const clearSearch = () => { setQuery(''); searchRef.current?.focus() }
  const addProvider = () => { setQuery(''); manager.setProviderDialog({ mode: 'add' }) }

  return <div className="min-w-0" data-model-provider-workspace>
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <div className="relative min-w-48 flex-1">
        <TbSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t('settings.models.workspace.search')}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) { event.preventDefault(); clearSearch() }
            if (event.key === 'ArrowDown' && results.length > 0) {
              event.preventDefault()
              providerListRef.current?.querySelector<HTMLButtonElement>('[data-model-provider]')?.focus()
            }
          }}
          placeholder={t('settings.models.workspace.search')} className="h-10 pl-9 pr-9" />
        {query ? <Button variant="ghost" size="icon-xs" className="absolute right-2 top-1/2 -translate-y-1/2"
          aria-label={t('settings.models.workspace.clearSearch')} onClick={clearSearch}><TbX aria-hidden /></Button> : null}
      </div>
      <Button disabled={disabled} onClick={addProvider}><TbPlus aria-hidden />{t('settings.models.addProvider')}</Button>
    </div>
    {manager.parsed.providers.length === 0 ? <div className="flex min-h-64 flex-col items-start justify-center gap-3 border-y border-border px-4 py-8">
      <TbServer className="size-8 text-muted-foreground" aria-hidden />
      <h3 className="text-lg font-medium">{t('settings.models.noProviders')}</h3>
      <p className="max-w-md text-caption leading-relaxed text-muted-foreground">{t('settings.models.workspace.emptyDescription')}</p>
      <Button variant="ghost" disabled={disabled} onClick={addProvider}>{t('settings.models.addProvider')}<TbArrowRight aria-hidden /></Button>
    </div> : results.length === 0 ? <div className="py-12 text-center text-caption text-muted-foreground" role="status">
      <p>{t('settings.models.workspace.noMatches')}</p>
      <Button variant="ghost" className="mt-2" onClick={clearSearch}>{t('settings.models.workspace.clearSearch')}</Button>
    </div> : <div className="grid min-w-0 border-y border-border @min-[780px]/settings-workspace:grid-cols-[220px_minmax(0,1fr)]">
      <nav ref={providerListRef} className="flex min-w-0 gap-1 overflow-x-auto py-3 @min-[780px]/settings-workspace:flex-col @min-[780px]/settings-workspace:overflow-x-visible @min-[780px]/settings-workspace:border-r @min-[780px]/settings-workspace:border-border @min-[780px]/settings-workspace:pr-4" aria-label={t('settings.models.workspace.providers')}
        onKeyDown={(event) => {
          const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-model-provider]')]
          const index = options.findIndex((option) => option === event.target)
          if (index < 0) return
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
            : event.key === 'ArrowDown' || event.key === 'ArrowRight' ? Math.min(options.length - 1, index + 1)
              : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? Math.max(0, index - 1) : null
          if (next === null) return
          event.preventDefault()
          options[next]?.focus()
          options[next]?.click()
        }}>
        {results.map(({ provider: candidate, models }) => <button key={candidate.id} type="button"
          aria-current={candidate.id === provider?.id ? 'true' : undefined}
          data-model-provider={candidate.id}
          onClick={() => manager.selectProvider(candidate.id)}
          className={cn('flex min-w-40 items-start gap-2 rounded-lg px-3 py-3 text-left outline-none transition-colors hover:bg-accent/35 focus-visible:focus-ring @min-[780px]/settings-workspace:w-full @min-[780px]/settings-workspace:min-w-0',
            candidate.id === provider?.id && 'bg-accent/60 text-foreground')}>
          <TbServer className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1"><span className="block truncate text-caption font-medium">{candidate.name || candidate.id}</span>
            <span className="mt-1 block text-micro text-muted-foreground">{t('settings.models.providerModels', { count: models.length })}</span></span>
          {candidate.id === provider?.id ? <span className="mt-1 size-1.5 shrink-0 rounded-full bg-sage" aria-hidden /> : null}
        </button>)}
      </nav>
      {provider && selected ? <section className="min-w-0 py-5 @min-[780px]/settings-workspace:pl-6" aria-label={provider.name || provider.id} data-model-provider-detail={provider.id}>
        <header className="flex min-w-0 items-start gap-3">
          <div className="min-w-0 flex-1"><h3 className="break-words text-lg font-semibold">{provider.name || provider.id}</h3>
            <p className="mt-1 break-all font-mono text-micro text-muted-foreground">{provider.id}</p></div>
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => manager.setProviderDialog({ mode: 'edit', provider })}><TbEdit aria-hidden />{t('settings.models.editProvider')}</Button>
          <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={t('settings.models.providerActions', { name: provider.name || provider.id })}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => manager.duplicateProvider(provider)}><TbCopy aria-hidden />{t('settings.models.duplicateProvider')}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={() => manager.setRemoveProviderId(provider.id)}><TbTrash aria-hidden />{t('settings.models.deleteProvider')}</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
        </header>
        <dl className="mt-5 grid gap-3 text-caption">
          <div className="min-w-0"><dt className="text-micro text-muted-foreground">{t('settings.models.workspace.endpoint')}</dt><dd className="mt-1 break-all font-mono text-caption">{provider.baseUrl || t('settings.models.workspace.defaultEndpoint')}</dd></div>
          <div><dt className="sr-only">{t('settings.models.form.connectionSection')}</dt><dd className="flex flex-wrap items-center gap-3 text-micro text-muted-foreground">{provider.api ? <span className="font-mono">{provider.api}</span> : null}<span className="inline-flex items-center gap-1"><TbKey aria-hidden />{t(provider.hasApiKey ? 'settings.models.keyStored' : 'settings.models.workspace.noStoredKey')}</span></dd></div>
        </dl>
        {!structuredProviderSupported(provider) ? <p className="mt-3 text-micro text-muted-foreground">{t('settings.models.formAdvancedNotice')}</p> : null}
        <div className="mt-7 flex flex-wrap items-center gap-3 border-b border-border pb-3">
          <h4 className="mr-auto text-caption font-semibold">{t('settings.models.workspace.models')}</h4>
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => { setQuery(''); manager.setModelDialog({ providerId: provider.id, mode: 'add' }) }}><TbPlus aria-hidden />{t('settings.models.addModel')}</Button>
        </div>
        {provider.models.length > 0 ? <div className="flex flex-wrap items-center gap-2 py-3 text-micro text-muted-foreground">
          <Checkbox checked={allVisibleSelected ? true : visibleSelectedCount > 0 ? 'indeterminate' : false} disabled={disabled || visibleSelections.length === 0}
            aria-label={t('settings.models.selectAllModels', { name: provider.name || provider.id })}
            onCheckedChange={(checked) => { for (const model of selected.models) manager.toggleCustomModel(provider.id, model.id, checked === true) }} />
          <span>{t(selectedCount > 0 ? 'settings.models.selectedCount' : 'settings.models.providerModels', { count: selectedCount || selected.models.length })}</span>
          {selectedCount > 0 ? <Button variant="ghost" size="xs" className="ml-auto text-destructive" disabled={disabled} onClick={() => manager.deleteSelectedModels(provider.id)}><TbTrash aria-hidden />{t('settings.models.deleteSelectedModels')}</Button> : null}
        </div> : null}
        {selected.models.map((model) => <ModelsModelRow key={model.id} model={model} providerId={provider.id} manager={manager} numberFormat={numberFormat} />)}
        {selected.models.length === 0 ? <p className="py-8 text-caption leading-relaxed text-muted-foreground">{t('settings.models.workspace.noModels')}</p> : null}
        <p className="border-t border-border/70 pt-4 text-micro text-muted-foreground">{t('settings.models.workspace.testDescription')}</p>
      </section> : null}
    </div>}
  </div>
}
