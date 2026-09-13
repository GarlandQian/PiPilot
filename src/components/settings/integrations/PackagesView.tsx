import * as React from 'react'
import { TbArrowLeft, TbChevronRight, TbDownload, TbPackage, TbTrash } from 'react-icons/tb'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { PiPackageSummary, PiResourceKind } from '@/shared/pi-integrations'
import { usePiIntegrations } from '@/store/pi-integrations'
import { CatalogCollection, CompatibilityBadge, EmptyState, SearchField, focusCatalogRow, totalResources } from './CatalogPrimitives'
import { filterIntegrationPackages } from './catalog-model'

function PackageDetail({
  pkg,
  busy,
  onBack,
  onRemove,
  onUpdate,
  onOpenResources,
}: {
  pkg: PiPackageSummary
  busy: boolean
  onBack(): void
  onRemove(): void
  onUpdate(): void
  onOpenResources(kind?: PiResourceKind): void
}) {
  const t = useT()
  const fields = [
    [t('settings.integrations.package.source'), pkg.source],
    [t('settings.integrations.package.scope'), t(`settings.integrations.scope.${pkg.scope}`)],
    [t('settings.integrations.package.version'), pkg.installedVersion ?? t('settings.integrations.unknown')],
    [t('settings.integrations.package.path'), pkg.installedPath ?? t('settings.integrations.unknown')],
  ] as const

  return (
    <section className="min-w-0 py-1 @min-[880px]/integrations:pl-7" aria-label={pkg.displayName}>
      <div className="flex min-w-0 items-start gap-2">
        <Button className="@min-[880px]/integrations:hidden" variant="ghost" size="icon-sm" aria-label={t('common.back')} title={t('common.back')} onClick={onBack}>
          <TbArrowLeft aria-hidden />
        </Button>
        <TbPackage className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-title">{pkg.displayName}</h3>
          <p className="mt-0.5 truncate font-mono text-micro text-muted-foreground">{pkg.source}</p>
        </div>
        <div className="flex max-w-[45%] flex-wrap justify-end gap-1.5">
          {pkg.updateAvailable ? (
            <Badge variant="soft-warning">{t('settings.integrations.package.updateAvailable')}</Badge>
          ) : null}
          <CompatibilityBadge value={pkg.compatibility} />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 border-b border-border pb-5">
        <Button variant="outline" size="sm" disabled={busy || pkg.pinned} onClick={onUpdate}>
          <TbDownload aria-hidden />
          {pkg.pinned ? t('settings.integrations.package.pinned') : t('settings.integrations.update')}
        </Button>
        <Button variant="ghost" size="sm" disabled={totalResources(pkg) === 0} onClick={() => onOpenResources()}>
          {t('settings.integrations.package.viewResources')}<TbChevronRight aria-hidden />
        </Button>
        <Button variant="ghost" className="ml-auto text-destructive hover:text-destructive" size="sm" disabled={busy} onClick={onRemove}>
          <TbTrash aria-hidden />{t('settings.integrations.remove')}
        </Button>
      </div>

      <dl className="mt-5 grid gap-x-5 gap-y-3 text-caption @min-[1080px]/integrations:grid-cols-[8rem_minmax(0,1fr)]">
        {fields.map(([label, value]) => (
          <React.Fragment key={label}>
            <dt className="text-caption text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-all text-caption text-foreground">{value}</dd>
          </React.Fragment>
        ))}
        <dt className="text-caption text-muted-foreground">{t('settings.integrations.package.resources')}</dt>
        <dd className="flex flex-wrap gap-1.5">
          {(['extension', 'skill', 'prompt', 'theme'] as const).map((kind) => (
            <Button key={kind} variant="ghost" size="xs" disabled={pkg.resourceCounts[kind] === 0} onClick={() => onOpenResources(kind)}>
              {t(`settings.integrations.resource.${kind}`)} {pkg.resourceCounts[kind]}
            </Button>
          ))}
        </dd>
      </dl>

      <div className="mt-6 rounded-lg bg-muted/45 p-4">
        <p className="text-caption font-medium text-foreground">
          {t('settings.integrations.compatibility.title')}
        </p>
        <p className="mt-1 text-caption text-muted-foreground">
          {t(`settings.integrations.compatibility.${pkg.compatibility}.desc`)}
        </p>
      </div>
    </section>
  )
}

export function PackagesView({ active = true, onOpenResources }: { active?: boolean; onOpenResources(packageId: string, kind?: PiResourceKind): void }) {
  const t = useT()
  const integrations = usePiIntegrations()
  const packages = integrations.snapshot?.packages ?? []
  const [query, setQuery] = React.useState('')
  const [updatesOnly, setUpdatesOnly] = React.useState(false)
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const collectionRef = React.useRef<HTMLElement>(null)
  const [removeCandidate, setRemoveCandidate] = React.useState<PiPackageSummary | null>(null)
  React.useEffect(() => { if (!active) setRemoveCandidate(null) }, [active])
  const filtered = React.useMemo(() => filterIntegrationPackages(packages, query, updatesOnly), [packages, query, updatesOnly])
  const selected = filtered.find((pkg) => pkg.id === selectedId) ?? null
  const busy = integrations.status === 'operating' || integrations.status === 'loading' || integrations.status === 'checking'

  React.useEffect(() => {
    if (selectedId && !packages.some((pkg) => pkg.id === selectedId)) setSelectedId(null)
  }, [packages, selectedId])

  return (
    <>
      <p className="mb-4 max-w-2xl text-caption text-muted-foreground">{t('settings.integrations.packages.description')}</p>
      <div className="grid min-h-[28rem] gap-5 @min-[880px]/integrations:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.2fr)] @min-[880px]/integrations:gap-0" data-integration-catalog="packages">
        <div className={cn(
          'min-w-0 border-border @min-[880px]/integrations:border-r @min-[880px]/integrations:pr-5',
          selected && 'hidden @min-[880px]/integrations:block',
        )}>
          <div className="flex items-center gap-2">
            <SearchField value={query} onChange={setQuery} onBrowse={() => focusCatalogRow(collectionRef.current)} />
          </div>
          <div className="flex flex-wrap items-center gap-1 border-b border-border pb-3 pt-2">
            {[false, true].map((updates) => <button key={String(updates)} type="button" aria-pressed={updatesOnly === updates} onClick={() => setUpdatesOnly(updates)} className="rounded-md px-2 py-1.5 text-micro text-muted-foreground outline-none hover:text-foreground focus-visible:focus-ring aria-pressed:bg-muted aria-pressed:text-foreground">
              {t(updates ? 'settings.integrations.catalog.updates' : 'settings.integrations.catalog.allPackages')}
            </button>)}
            <span className="ml-auto text-micro tabular-nums text-muted-foreground">{t('settings.integrations.catalog.matches', { count: filtered.length, total: packages.length })}</span>
          </div>
          <CatalogCollection ref={collectionRef} label={t('settings.integrations.overview.packages')}>
            {filtered.map((pkg) => (
              <button
                key={pkg.id}
                type="button"
                data-integration-row={pkg.id}
                aria-current={selected?.id === pkg.id ? 'true' : undefined}
                className={cn(
                  'grid min-h-16 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-3 py-3 text-left outline-none hover:bg-muted/70 focus-visible:focus-ring',
                  selected?.id === pkg.id && 'bg-primary/8 ring-1 ring-inset ring-primary/20',
                )}
                onClick={() => setSelectedId(pkg.id)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-app font-medium text-foreground">{pkg.displayName}</span>
                  <span className="mt-1 block truncate font-mono text-micro text-muted-foreground">{pkg.source}</span>
                </span>
                <span className="flex max-w-44 flex-col items-end gap-1 text-right text-micro text-muted-foreground">
                  <span>{pkg.installedVersion ?? pkg.sourceType}</span>
                  {pkg.updateAvailable ? (
                    <Badge variant="soft-warning">{t('settings.integrations.package.updateAvailable')}</Badge>
                  ) : (
                    <span>{t('settings.integrations.resourceCount', { count: totalResources(pkg) })}</span>
                  )}
                </span>
              </button>
            ))}
            {filtered.length === 0 && <EmptyState><div className="space-y-3"><p>{t('settings.integrations.packages.empty')}</p>{query || updatesOnly ? <Button variant="ghost" size="sm" onClick={() => { setQuery(''); setUpdatesOnly(false) }}>{t('settings.integrations.catalog.clearSearch')}</Button> : null}</div></EmptyState>}
          </CatalogCollection>
        </div>
        <div className={cn(
          'min-w-0',
          !selected && 'hidden @min-[880px]/integrations:block',
        )}>
          {selected
            ? (
                <PackageDetail
                  pkg={selected}
                  busy={busy}
                  onBack={() => {
                    setSelectedId(null)
                    requestAnimationFrame(() => focusCatalogRow(collectionRef.current, selected.id))
                  }}
                  onUpdate={() => void integrations.update(selected.source)}
                  onRemove={() => setRemoveCandidate(selected)}
                  onOpenResources={(kind) => onOpenResources(selected.id, kind)}
                />
              )
            : <EmptyState>{t('settings.integrations.packages.select')}</EmptyState>}
        </div>
      </div>

      <AlertDialog open={Boolean(removeCandidate)} onOpenChange={(open) => !open && setRemoveCandidate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.integrations.removeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.integrations.removeConfirm', { name: removeCandidate?.displayName ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (removeCandidate) void integrations.remove(removeCandidate.source)
                setRemoveCandidate(null)
              }}
            >
              {t('settings.integrations.remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
