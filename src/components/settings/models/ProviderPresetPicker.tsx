import * as React from 'react'
import { TbSearch, TbX } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLocale, useT, type MessageKey } from '@/i18n'
import { localizedText, PROVIDER_PRESET_CATEGORIES, PROVIDER_PRESETS, searchProviderPresets, type ProviderPreset, type ProviderPresetCategory } from '@/shared/model-provider-presets'
import { SettingsBadge, SettingsListRow, SettingsSheet } from '../kit'
import { ProviderIcon } from './ProviderIcon'

/** Adding a provider starts here: pick the company, or a custom address. */
export function ProviderPresetSheet({ open, onOpenChange, added, onPick }: {
  open: boolean
  onOpenChange(open: boolean): void
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
    if (!open) return
    setQuery('')
    setCategory('all')
  }, [open])
  const clear = () => { setQuery(''); searchRef.current?.focus() }

  return <SettingsSheet open={open} onOpenChange={onOpenChange} title={t('settings.models.presets.title')} description={t('settings.models.presets.description')}
    data-models-preset-picker onOpenAutoFocus={(event) => { event.preventDefault(); searchRef.current?.focus() }}
    footer={<div className="flex items-center gap-3">
      <p className="min-w-0 flex-1 text-micro leading-snug text-muted-foreground">{t('settings.models.presets.credit')}</p>
      <Button variant="outline" className="min-w-[76px]" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
    </div>}>
    <div className="sticky top-0 z-10 -mx-5 space-y-2 bg-surface-raised px-5 pb-3">
      <div className="relative">
        <TbSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          aria-label={t('settings.models.presets.search')} placeholder={t('settings.models.presets.search')}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); clear() }
            if (event.key === 'ArrowDown') { event.preventDefault(); listRef.current?.querySelector<HTMLButtonElement>('[data-settings-row-action]')?.focus() }
            if (event.key === 'Enter' && results[0]) { event.preventDefault(); onPick(results[0]) }
          }}
          className="h-7 rounded-full bg-fill pl-8 pr-8 shadow-none focus-visible:bg-control" />
        {query ? <Button variant="ghost" size="icon-xs" className="absolute right-1 top-1/2 -translate-y-1/2" aria-label={t('settings.models.workspace.clearSearch')} onClick={clear}><TbX aria-hidden /></Button> : null}
      </div>
      <div className="mac-segmented max-w-full overflow-x-auto" role="radiogroup" aria-label={t('settings.models.presets.categories')}>
        {(['all', ...PROVIDER_PRESET_CATEGORIES] as const).map((candidate) => <button key={candidate} type="button" role="radio" aria-checked={category === candidate} aria-pressed={category === candidate}
          className="shrink-0 outline-none focus-visible:focus-ring" onClick={() => setCategory(candidate)}>{t(`settings.models.presets.category.${candidate}` as MessageKey)}</button>)}
      </div>
    </div>
    {results.length === 0 ? <div className="py-10 text-center text-caption text-muted-foreground" role="status">
      <p>{t('settings.models.presets.noMatches')}</p>
      <Button variant="ghost" size="sm" className="mt-2" onClick={() => { clear(); setCategory('custom') }}>{t('settings.models.presets.useCustom')}</Button>
    </div> : <div ref={listRef} role="list" className="settings-group min-w-0"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-settings-row-action]')]
        const index = options.findIndex((option) => option === event.target)
        if (index < 0) return
        event.preventDefault()
        if (event.key === 'ArrowUp' && index === 0) searchRef.current?.focus()
        else options[Math.max(0, Math.min(options.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus()
      }}>
      {results.map((preset) => {
        const name = localizedText(preset.name, locale)
        const versions = preset.versions.map((version) => localizedText(version.label, locale))
        return <SettingsListRow key={preset.key} data-models-preset={preset.key} icon={<ProviderIcon icon={preset.icon} name={name} size="row" />}
          title={name} openLabel={name} onOpen={() => onPick(preset)}
          badges={added.has(preset.key) ? <SettingsBadge tone="success">{t('settings.models.presets.added')}</SettingsBadge> : null}
          subtitle={preset.versions.length > 1 ? versions.join(' · ') : preset.versions[0].kind === 'builtin' ? t('settings.models.presets.builtinHint') : versions[0]} />
      })}
    </div>}
  </SettingsSheet>
}
