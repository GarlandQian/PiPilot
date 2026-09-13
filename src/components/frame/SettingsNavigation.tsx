import * as React from 'react'
import { TbSearch, TbX } from 'react-icons/tb'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SETTINGS_GROUPS, type SettingsSectionId } from '@/components/settings/settings-navigation'

export function SettingsNavigation({ section, onSelect }: {
  section: SettingsSectionId
  onSelect(section: SettingsSectionId): void
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
  return <div className="space-y-5 px-3 pb-6 pt-2" ref={navRef} onKeyDown={(event) => {
    if (!(event.target instanceof HTMLButtonElement) || !event.target.hasAttribute('data-context-panel-nav-id')) return
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(navRef.current?.querySelectorAll<HTMLButtonElement>('[data-context-panel-nav-id]') ?? [])
    const index = buttons.indexOf(event.target)
    if (index < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)))
    buttons[next]?.focus()
  }}>
    <h2 className="px-2 text-app font-semibold text-foreground">{t('rail.settings')}</h2>
    <div className="relative">
      <TbSearch className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" aria-hidden />
      <Input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} className="h-9 bg-background/60 pl-8 pr-8 text-caption" aria-label={t('settings.redesign.search')} placeholder={t('settings.redesign.search')} onKeyDown={(event) => {
        if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery('') }
        if (event.key === 'ArrowDown') { event.preventDefault(); navRef.current?.querySelector<HTMLButtonElement>('[data-context-panel-nav-id]')?.focus() }
        if (event.key === 'Enter' && groups[0]?.sections[0]) { event.preventDefault(); onSelect(groups[0].sections[0].id) }
      }} />
      {query ? <Button variant="ghost" size="icon-xs" className="absolute right-1 top-1" aria-label={t('settings.redesign.clearSearch')} onClick={() => { setQuery(''); inputRef.current?.focus() }}><TbX aria-hidden /></Button> : null}
    </div>
    {groups.length === 0 ? <p className="px-2 text-caption text-muted-foreground" role="status">{t('settings.redesign.noResults')}</p> : groups.map((group) => <section key={group.id}>
      <h3 className="px-2 pb-2 text-micro font-medium text-muted-foreground">{t(group.labelKey)}</h3>
      <nav aria-label={t(group.labelKey)}>
        <ul className="space-y-1">
          {group.sections.map((item) => <li key={item.id}>
            <button type="button" data-context-panel-nav-id={item.id} aria-current={section === item.id ? 'page' : undefined} aria-label={t(item.labelKey)} onClick={() => onSelect(item.id)} className={cn('flex w-full items-center gap-2.5 rounded-md border-l-2 px-2.5 py-2.5 text-left outline-none transition-colors focus-visible:focus-ring motion-reduce:transition-none', section === item.id ? 'border-sage bg-selected text-foreground' : 'border-transparent text-muted-foreground hover:bg-accent/45 hover:text-foreground')}>
              <item.icon className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 text-caption font-medium">{t(item.labelKey)}</span>
            </button>
          </li>)}
        </ul>
      </nav>
    </section>)}
  </div>
}
