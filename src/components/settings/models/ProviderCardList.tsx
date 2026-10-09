import * as React from 'react'
import { TbChevronRight, TbCopy, TbDots, TbExternalLink, TbFlask, TbKeyOff, TbLoader2, TbServer, TbSparkles, TbStarFilled, TbTrash } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useLocale, useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { localizedText, presetForProvider } from '@/shared/model-provider-presets'
import type { BuiltinProvider, ModelsConfigProvider } from '@/shared/models-config'
import { TestResultLine, type TestState } from '../editor-page'
import { ProviderIcon } from './ProviderIcon'
import { builtinKeySource } from './BuiltinProviderEditor'

export type ProviderCardEntry =
  | { kind: 'custom'; id: string; provider: ModelsConfigProvider }
  | { kind: 'builtin'; id: string; provider: BuiltinProvider }

export interface ProviderCardActions {
  edit(entry: ProviderCardEntry): void
  test(entry: ProviderCardEntry): void
  duplicate(id: string): void
  fill(id: string): void
  remove(entry: ProviderCardEntry): void
}

function hostOf(url: string | undefined) {
  if (!url) return ''
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** One grouped list, a row per provider, like the accounts list in System Settings. */
export function ProviderCardList({ entries, defaultProvider, builtinBaseUrls, tests, recent, disabled, actions }: {
  entries: readonly ProviderCardEntry[]
  defaultProvider?: string
  builtinBaseUrls: Readonly<Record<string, string | undefined>>
  tests: Readonly<Record<string, TestState>>
  /** Just saved: highlighted for a moment and scrolled into view. */
  recent: string | null
  disabled: boolean
  actions: ProviderCardActions
}) {
  const t = useT()
  const locale = useLocale()
  return <div className="mac-group min-w-0" role="list" data-models-provider-list>
    {entries.map((entry) => {
      const match = presetForProvider({ id: entry.id, baseUrl: entry.provider.baseUrl, builtin: entry.kind === 'builtin' }, builtinBaseUrls)
      const name = entry.kind === 'custom' ? entry.provider.name || (match?.exact ? localizedText(match.preset.name, locale) : entry.id)
        : match ? localizedText(match.preset.name, locale) : entry.provider.name
      const version = match?.exact && match.preset.versions.length > 1 ? localizedText(match.version.label, locale) : null
      const models = entry.kind === 'custom' ? entry.provider.models : []
      const details = entry.kind === 'custom'
        ? [hostOf(entry.provider.baseUrl) || entry.id, ...(models.length ? [
          t('settings.models.providerModels', { count: models.length }),
          `${models.slice(0, 3).map((model) => model.name || model.id).join(t('common.listSeparator'))}${models.length > 3 ? '…' : ''}`,
        ] : [t('settings.models.cards.noModels')])]
        : [t('settings.models.cards.builtin'), t('settings.models.providerModels', { count: entry.provider.modelCount }), builtinKeySource(entry.provider, t)]
      const test = tests[entry.id]
      const holdsDefault = defaultProvider === entry.id
      const canTest = entry.kind === 'custom' ? models.length > 0 : entry.provider.configured
      return <ProviderRow key={`${entry.kind}:${entry.id}`} recent={recent === entry.id} entry={entry}>
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-0.5 text-left outline-none focus-visible:focus-ring disabled:opacity-60"
            disabled={disabled} aria-label={t('settings.models.cards.edit', { name })} onClick={() => actions.edit(entry)}>
            <ProviderIcon icon={match?.preset.icon} name={name} size="row" />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-app font-medium text-foreground">{name}</span>
                {version ? <span className="shrink-0 text-caption text-muted-foreground">{version}</span> : null}
                {holdsDefault ? <span className="inline-flex shrink-0 items-center gap-0.5 text-micro text-sage"><TbStarFilled className="size-3" aria-hidden />{t('settings.models.cards.holdsDefault')}</span> : null}
              </span>
              <span className="mt-0.5 block truncate text-caption text-muted-foreground" title={details.join(' · ')}>{details.join(' · ')}</span>
            </span>
          </button>
          <Button variant="ghost" size="xs" className="shrink-0 text-muted-foreground" disabled={disabled || !canTest || test?.state === 'testing'}
            aria-label={t('settings.models.cards.test', { name })} onClick={() => actions.test(entry)}>
            {test?.state === 'testing' ? <TbLoader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <TbFlask aria-hidden />}
            <span className="hidden @min-[560px]/settings-workspace:inline">{t('settings.models.testModel')}</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground" disabled={disabled} aria-label={t('settings.models.providerActions', { name })}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {entry.kind === 'custom' ? <>
                <DropdownMenuItem onSelect={() => actions.duplicate(entry.id)}><TbCopy aria-hidden />{t('settings.models.duplicateProvider')}</DropdownMenuItem>
                <DropdownMenuItem disabled={models.length === 0} onSelect={() => actions.fill(entry.id)}><TbSparkles aria-hidden />{t('settings.models.backfill.open')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => actions.remove(entry)}><TbTrash aria-hidden />{t('settings.models.deleteProvider')}</DropdownMenuItem>
              </> : <>
                {match?.preset.website ? <DropdownMenuItem onSelect={() => window.open(match.preset.website, '_blank', 'noopener')}><TbExternalLink aria-hidden />{t('settings.models.cards.website')}</DropdownMenuItem> : null}
                <DropdownMenuItem variant="destructive" disabled={entry.provider.source !== 'stored'} onSelect={() => actions.remove(entry)}><TbKeyOff aria-hidden />{t('settings.models.builtin.removeKey')}</DropdownMenuItem>
              </>}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon-xs" className="-mr-1 shrink-0 text-muted-foreground" tabIndex={-1} aria-hidden disabled={disabled} onClick={() => actions.edit(entry)}>
            <TbChevronRight aria-hidden />
          </Button>
        </div>
        <TestResultLine test={test} className="mt-1 pl-11" />
      </ProviderRow>
    })}
  </div>
}

function ProviderRow({ entry, recent, children }: { entry: ProviderCardEntry; recent: boolean; children: React.ReactNode }) {
  const ref = React.useRef<HTMLElement>(null)
  React.useEffect(() => {
    if (!recent) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.reducedMotion === 'true'
    ref.current?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
  }, [recent])
  return <article ref={ref} role="listitem" className={cn('min-w-0 py-2 transition-colors duration-700 first:rounded-t-[inherit] last:rounded-b-[inherit] motion-reduce:transition-none', recent && 'bg-primary/8')}
    data-models-provider-card={entry.id} data-models-provider-kind={entry.kind} data-model-recent={recent || undefined}>
    {children}
  </article>
}

export function ProvidersEmpty({ onAdd, disabled }: { onAdd(): void; disabled: boolean }) {
  const t = useT()
  return <div className="mac-group min-w-0" data-models-empty>
    <div className="flex min-h-48 flex-col items-center justify-center gap-1.5 px-4 py-8 text-center">
      <TbServer className="mb-1 size-8 text-muted-foreground/60" aria-hidden />
      <h3 className="text-app font-semibold">{t('settings.models.noProviders')}</h3>
      <p className="max-w-sm text-caption leading-relaxed text-muted-foreground">{t('settings.models.cards.emptyDescription')}</p>
      <Button variant="outline" size="sm" className="mt-2" disabled={disabled} onClick={onAdd}>{t('settings.models.cards.add')}</Button>
    </div>
  </div>
}
