import * as React from 'react'
import { TbArrowLeft, TbCheck, TbCopy, TbX } from 'react-icons/tb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { PiResourceKind, PiResourceSummary } from '@/shared/pi-integrations'
import { usePiIntegrations } from '@/store/pi-integrations'
import { CatalogCollection, CompatibilityBadge, EmptyState, ResourceStateBadge, SearchField, focusCatalogRow } from './CatalogPrimitives'
import { filterIntegrationResources } from './catalog-model'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'

const RESOURCE_KINDS: Array<'all' | PiResourceKind> = [
  'all',
  'extension',
  'skill',
  'prompt',
  'theme',
]
function ResourceDetail({ resource, onBack }: { resource: PiResourceSummary; onBack(): void }) {
  const t = useT()
  const [copied, setCopied] = React.useState(false)
  const [copyFailed, setCopyFailed] = React.useState(false)
  React.useEffect(() => { setCopied(false); setCopyFailed(false) }, [resource.id])
  return (
    <section className="min-w-0 py-1 @min-[880px]/integrations:pl-7" aria-label={resource.label}>
      <div className="flex min-w-0 items-start gap-2">
        <Button className="@min-[880px]/integrations:hidden" variant="ghost" size="icon-sm" aria-label={t('common.back')} title={t('common.back')} onClick={onBack}>
          <TbArrowLeft aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-title">{resource.label}</h3>
          <p className="mt-0.5 break-all font-mono text-micro text-muted-foreground">{resource.path}</p>
        </div>
        <div className="flex max-w-[45%] flex-wrap justify-end gap-1.5">
          <Badge variant="outline">{t(`settings.integrations.resource.${resource.kind}`)}</Badge>
          <ResourceStateBadge value={resource.effectiveState} />
        </div>
      </div>
      {resource.description && <div className="mt-4 text-caption text-muted-foreground"><MarkdownContent markdown={resource.description} /></div>}
      {resource.invocation ? <div className="mt-5 flex min-w-0 items-center gap-2 rounded-lg bg-muted/60 px-3 py-2">
        <code className="min-w-0 flex-1 break-all font-mono text-caption">{resource.invocation}</code>
        <Button variant="ghost" size="icon-sm" aria-label={t('settings.integrations.resource.copyInvocation')} title={t('settings.integrations.resource.copyInvocation')} onClick={() => {
          void navigator.clipboard.writeText(resource.invocation!).then(() => { setCopied(true); setCopyFailed(false) }).catch(() => setCopyFailed(true))
        }}>{copied ? <TbCheck aria-hidden /> : <TbCopy aria-hidden />}</Button>
      </div> : null}
      {copyFailed ? <p className="mt-2 text-caption text-destructive" role="alert">{t('md.copyFailed')}</p> : null}
      <dl className="mt-5 grid gap-x-5 gap-y-3 border-t border-border pt-5 @min-[1080px]/integrations:grid-cols-[8rem_minmax(0,1fr)]">
        <dt className="text-caption text-muted-foreground">{t('settings.integrations.package.source')}</dt>
        <dd className="break-all text-caption">{resource.source}</dd>
        <dt className="text-caption text-muted-foreground">{t('settings.integrations.package.scope')}</dt>
        <dd className="text-caption">{t(`settings.integrations.scope.${resource.scope}`)}</dd>
        <dt className="text-caption text-muted-foreground">{t('settings.integrations.resource.state')}</dt>
        <dd className="text-caption">{t(`settings.integrations.resource.state.${resource.effectiveState}`)}</dd>
      </dl>
      <div className="mt-6 space-y-2 rounded-lg bg-muted/45 p-4">
        <CompatibilityBadge value={resource.compatibility} />
        <p className="mt-2 text-caption text-muted-foreground">
          {resource.kind === 'theme'
            ? t('settings.integrations.resources.themeBoundary')
            : t('settings.integrations.resources.readOnly')}
        </p>
        {resource.diagnostic && <div className="mt-2 text-caption text-warning"><MarkdownContent markdown={resource.diagnostic} /></div>}
      </div>
    </section>
  )
}

export function ResourcesView({ focus, onClearFocus }: {
  focus: { packageId: string; kind?: PiResourceKind } | null
  onClearFocus(): void
}) {
  const t = useT()
  const integrations = usePiIntegrations()
  const resources = integrations.snapshot?.resources ?? []
  const [query, setQuery] = React.useState('')
  const [kind, setKind] = React.useState<'all' | PiResourceKind>('all')
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const collectionRef = React.useRef<HTMLElement>(null)
  const focusedPackage = integrations.snapshot?.packages.find((pkg) => pkg.id === focus?.packageId)
  React.useEffect(() => {
    if (!focus) return
    setKind(focus.kind ?? 'all')
    setQuery('')
    setSelectedId(null)
  }, [focus])
  const filtered = React.useMemo(() => filterIntegrationResources(resources, {
    query, kind, packageId: focus?.packageId,
  }), [focus, kind, query, resources])
  const selected = filtered.find((resource) => resource.id === selectedId) ?? null

  React.useEffect(() => {
    if (selectedId && !resources.some((resource) => resource.id === selectedId)) setSelectedId(null)
  }, [resources, selectedId])

  return (
    <div>
      <p className="mb-4 max-w-2xl text-caption text-muted-foreground">{t('settings.integrations.resources.description')}</p>
      {focus ? <div className="mb-4 flex min-w-0 items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-caption">
        <span className="min-w-0 flex-1 truncate">{t('settings.integrations.catalog.packageResources', { name: focusedPackage?.displayName ?? t('settings.integrations.unknown') })}</span>
        <Button variant="ghost" size="xs" onClick={() => { onClearFocus(); setKind('all'); setQuery('') }}><TbX aria-hidden />{t('settings.integrations.catalog.clearPackage')}</Button>
      </div> : null}
    <div className="grid min-h-[28rem] gap-5 @min-[880px]/integrations:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.2fr)] @min-[880px]/integrations:gap-0" data-integration-catalog="resources">
      <div className={cn(
        'min-w-0 border-border @min-[880px]/integrations:border-r @min-[880px]/integrations:pr-5',
        selected && 'hidden @min-[880px]/integrations:block',
      )}>
        <div className="border-b border-border pb-3">
          <SearchField value={query} onChange={setQuery} onBrowse={() => focusCatalogRow(collectionRef.current)} />
          <div className="mt-2 flex flex-wrap items-center gap-1" role="group" aria-label={t('settings.integrations.resources.filter')}>
            {RESOURCE_KINDS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-pressed={kind === candidate}
                className="rounded-md px-2 py-1.5 text-micro text-muted-foreground outline-none hover:text-foreground focus-visible:focus-ring aria-pressed:bg-muted aria-pressed:text-foreground"
                onClick={() => setKind(candidate)}
              >
                {t(`settings.integrations.resource.${candidate}`)}
              </button>
            ))}
            <span className="ml-auto text-micro tabular-nums text-muted-foreground">{t('settings.integrations.catalog.matches', { count: filtered.length, total: resources.length })}</span>
          </div>
        </div>
        <CatalogCollection ref={collectionRef} label={t('settings.integrations.overview.resources')}>
          {filtered.map((resource) => (
            <button
              key={resource.id}
              type="button"
              data-integration-row={resource.id}
              aria-current={selected?.id === resource.id ? 'true' : undefined}
              className={cn(
                'grid min-h-16 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-3 py-3 text-left outline-none hover:bg-muted/70 focus-visible:focus-ring',
                selected?.id === resource.id && 'bg-primary/8 ring-1 ring-inset ring-primary/20',
              )}
              onClick={() => setSelectedId(resource.id)}
            >
              <span className="min-w-0">
                <span className="block truncate text-app font-medium">{resource.label}</span>
                <span className="mt-1 block truncate text-micro text-muted-foreground">{resource.source}</span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <Badge variant="outline">{t(`settings.integrations.resource.${resource.kind}`)}</Badge>
                <ResourceStateBadge value={resource.effectiveState} />
              </span>
            </button>
          ))}
          {filtered.length === 0 && <EmptyState><div className="space-y-3"><p>{t('settings.integrations.resources.empty')}</p>{query || kind !== 'all' ? <Button variant="ghost" size="sm" onClick={() => { setQuery(''); setKind('all') }}>{t('settings.integrations.catalog.clearSearch')}</Button> : null}</div></EmptyState>}
        </CatalogCollection>
      </div>
      <div className={cn(
        'min-w-0',
        !selected && 'hidden @min-[880px]/integrations:block',
      )}>
        {selected
          ? <ResourceDetail key={selected.id} resource={selected} onBack={() => {
              setSelectedId(null)
              requestAnimationFrame(() => focusCatalogRow(collectionRef.current, selected.id))
            }} />
          : <EmptyState>{t('settings.integrations.resources.select')}</EmptyState>}
      </div>
    </div>
    </div>
  )
}
