import * as React from 'react'
import { TbChevronLeft, TbSearch, TbX } from 'react-icons/tb'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SettingsIconTile } from '@/components/settings/common'
import { SETTINGS_GROUPS, type SettingsSectionId } from '@/components/settings/settings-navigation'

/** System Settings sidebar: back to the app (Codex), search field, colored icon tiles. */
export function SettingsNavigation({ section, onSelect, onBack }: {
  section: SettingsSectionId
  onSelect(section: SettingsSectionId): void
  onBack?: () => void
}) {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const navRef = React.useRef<HTMLDivElement>(null)
  const words = query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean)
  const groups = SETTINGS_GROUPS.map((group) => ({ ...group, sections: group.sections.filter((item) => {
    const text = `${t(item.labelKey)} ${t(item.descriptionKey)} ${item.searchTerms}`.toLocaleLowerCase()
    return words.every((word) => text.includes(word))
  }) })).filter((group) => group.sections.length > 0)
  return <div className="space-y-3 px-2.5 pb-6 pt-0.5" ref={navRef} onKeyDown={(event) => {
    if (!(event.target instanceof HTMLButtonElement) || !event.target.hasAttribute('data-context-panel-nav-id')) return
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(navRef.current?.querySelectorAll<HTMLButtonElement>('[data-context-panel-nav-id]') ?? [])
    const index = buttons.indexOf(event.target)
    if (index < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)))
    buttons[next]?.focus()
  }}>
    <h2 className="sr-only">{t('rail.settings')}</h2>
    {onBack ? <button type="button" onClick={onBack}
      className="flex h-[30px] w-full items-center gap-1 rounded-[8px] px-1.5 text-left text-app text-foreground/90 outline-none hover:bg-fill focus-visible:focus-ring">
      <TbChevronLeft className="size-4 text-muted-foreground" aria-hidden />
      {t('settings.backToApp')}
    </button> : null}
    <div className="relative">
      <TbSearch className="pointer-events-none absolute left-2 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} className="h-7 rounded-full bg-fill pl-7 pr-7 text-app shadow-none dark:bg-fill focus-visible:bg-control" aria-label={t('settings.redesign.search')} placeholder={t('settings.redesign.search')} onKeyDown={(event) => {
        if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery('') }
        if (event.key === 'ArrowDown') { event.preventDefault(); navRef.current?.querySelector<HTMLButtonElement>('[data-context-panel-nav-id]')?.focus() }
        if (event.key === 'Enter' && groups[0]?.sections[0]) { event.preventDefault(); onSelect(groups[0].sections[0].id) }
      }} />
      {query ? <Button variant="ghost" size="icon-xs" className="absolute right-0.5 top-1/2 size-5 -translate-y-1/2 rounded-full" aria-label={t('settings.redesign.clearSearch')} onClick={() => { setQuery(''); inputRef.current?.focus() }}><TbX aria-hidden /></Button> : null}
    </div>
    {groups.length === 0 ? <p className="px-2 text-caption text-muted-foreground" role="status">{t('settings.redesign.noResults')}</p> : groups.map((group) => <section key={group.id}>
      <h3 className="px-2 pb-1 text-micro font-semibold text-muted-foreground/90">{t(group.labelKey)}</h3>
      <nav aria-label={t(group.labelKey)}>
        <ul className="space-y-px">
          {group.sections.map((item) => {
            const active = section === item.id
            return <li key={item.id}>
              {/* System Settings: every row has its colored tile; selection is a neutral pill. */}
              <button type="button" data-context-panel-nav-id={item.id} aria-current={active ? 'page' : undefined} aria-label={t(item.labelKey)} onClick={() => onSelect(item.id)} className={cn('flex h-[30px] w-full items-center gap-2 rounded-[10px] px-1.5 text-left outline-none focus-visible:focus-ring', active ? 'bg-source-list-selected font-medium text-foreground' : 'text-foreground/85 hover:bg-fill')}>
                <SettingsIconTile section={item} />
                <span className="min-w-0 flex-1 truncate text-app">{t(item.labelKey)}</span>
              </button>
            </li>
          })}
        </ul>
      </nav>
    </section>)}
  </div>
}
