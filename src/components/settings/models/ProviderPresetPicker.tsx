import * as React from 'react'
import { TbChevronRight, TbSearch, TbX } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLocale, useT, type MessageKey } from '@/i18n'
import { cn } from '@/lib/utils'
import { localizedText, PROVIDER_PRESET_CATEGORIES, PROVIDER_PRESETS, searchProviderPresets, type ProviderPreset, type ProviderPresetCategory } from '@/shared/model-provider-presets'
import { ProviderIcon } from './ProviderIcon'

/** Step one of adding a provider: pick the company (or a custom address). */
export function ProviderPresetPicker({ added, onPick }: {
  /** Preset keys with at least one version already set up. */
  added: ReadonlySet<string>
  onPick(preset: ProviderPreset): void
}) {
  const t = useT()
  const locale = useLocale()
  const [query, setQuery] = React.useState('')
  const [category, setCategory] = React.useState<ProviderPresetCategory | 'all'>('all')
  const searchRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const results = searchProviderPresets(PROVIDER_PRESETS, query, category)
  React.useEffect(() => {
    const frame = requestAnimationFrame(() => searchRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])
  const clear = () => { setQuery(''); searchRef.current?.focus() }

  return <div className="min-w-0 space-y-4" data-models-preset-picker>
    <div className="glass sticky top-[calc(var(--frame-header-h)+8px)] z-10 flex min-w-0 flex-col gap-2.5 rounded-[18px] p-2.5">
      <div className="relative min-w-0">
        <TbSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          aria-label={t('settings.models.presets.search')} placeholder={t('settings.models.presets.search')}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) { event.preventDefault(); clear() }
            if (event.key === 'ArrowDown') { event.preventDefault(); listRef.current?.querySelector<HTMLButtonElement>('[data-models-preset]')?.focus() }
            if (event.key === 'Enter' && results[0]) { event.preventDefault(); onPick(results[0]) }
          }}
          className="h-8 rounded-full bg-fill pl-9 pr-8 shadow-none focus-visible:bg-control" />
        {query ? <Button variant="ghost" size="icon-xs" className="absolute right-1.5 top-1/2 -translate-y-1/2" aria-label={t('settings.models.workspace.clearSearch')} onClick={clear}><TbX aria-hidden /></Button> : null}
      </div>
      <div className="scroll-slim -mx-0.5 flex min-w-0 gap-1 overflow-x-auto px-0.5" role="radiogroup" aria-label={t('settings.models.presets.categories')}>
        {(['all', ...PROVIDER_PRESET_CATEGORIES] as const).map((candidate) => <button key={candidate} type="button" role="radio" aria-checked={category === candidate}
          className="h-6 shrink-0 rounded-full px-3 text-caption font-medium text-foreground/70 outline-none hover:bg-fill hover:text-foreground focus-visible:focus-ring aria-checked:bg-control aria-checked:text-foreground aria-checked:shadow-[inset_0_1px_0.5px_rgb(255_255_255/0.9),0_0_0_0.5px_rgb(0_0_0/0.1),0_1px_2px_rgb(0_0_0/0.12)] dark:aria-checked:bg-white/22 dark:aria-checked:shadow-none"
          onClick={() => setCategory(candidate)}>{t(`settings.models.presets.category.${candidate}` as MessageKey)}</button>)}
      </div>
    </div>

    {results.length === 0 ? <div className="py-12 text-center text-caption text-muted-foreground" role="status">
      <p>{t('settings.models.presets.noMatches')}</p>
      <Button variant="ghost" className="mt-2" onClick={() => { clear(); setCategory('custom') }}>{t('settings.models.presets.useCustom')}</Button>
    </div> : <div ref={listRef} className="grid min-w-0 gap-2 @min-[680px]/settings-workspace:grid-cols-2"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-models-preset]')]
        const index = options.findIndex((option) => option === event.target)
        if (index < 0) return
        event.preventDefault()
        if (event.key === 'ArrowUp' && index === 0) searchRef.current?.focus()
        else options[Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus()
      }}>
      {results.map((preset) => {
        const name = localizedText(preset.name, locale)
        const versions = preset.versions.map((version) => localizedText(version.label, locale))
        return <button key={preset.key} type="button" data-models-preset={preset.key} onClick={() => onPick(preset)}
          className={cn('mac-box flex min-w-0 items-center gap-3 px-3.5 py-3 text-left outline-none transition-colors hover:bg-fill focus-visible:focus-ring')}>
          <ProviderIcon icon={preset.icon} name={name} />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="break-words text-app font-medium">{name}</span>
              {added.has(preset.key) ? <span className="rounded-full bg-success/14 px-1.5 text-micro text-success">{t('settings.models.presets.added')}</span> : null}
            </span>
            <span className="mt-0.5 block truncate text-micro text-muted-foreground" title={versions.join(' · ')}>
              {preset.versions.length > 1 ? versions.join(' · ') : preset.versions[0].kind === 'builtin' ? t('settings.models.presets.builtinHint') : versions[0]}
            </span>
          </span>
          <TbChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      })}
    </div>}
    <p className="px-1 text-micro leading-relaxed text-muted-foreground">{t('settings.models.presets.credit')}</p>
  </div>
}
