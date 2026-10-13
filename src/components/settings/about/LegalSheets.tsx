import * as React from 'react'
import { TbChevronRight, TbExternalLink, TbLoader2, TbSearch } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type MessageKey, useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { SettingsGroup, SettingsSheet } from '../kit'

const DISCLAIMER: readonly { title: MessageKey; body: MessageKey }[] = [
  { title: 'settings.about.disclaimer.independent.title', body: 'settings.about.disclaimer.independent.body' },
  { title: 'settings.about.disclaimer.lawful.title', body: 'settings.about.disclaimer.lawful.body' },
  { title: 'settings.about.disclaimer.output.title', body: 'settings.about.disclaimer.output.body' },
  { title: 'settings.about.disclaimer.costs.title', body: 'settings.about.disclaimer.costs.body' },
  { title: 'settings.about.disclaimer.data.title', body: 'settings.about.disclaimer.data.body' },
  { title: 'settings.about.disclaimer.trademarks.title', body: 'settings.about.disclaimer.trademarks.body' },
  { title: 'settings.about.disclaimer.warranty.title', body: 'settings.about.disclaimer.warranty.body' },
]

/** What PiPilot is and is not responsible for; the same text as the README. */
export function DisclaimerSheet({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const t = useT()
  return <SettingsSheet open={open} onOpenChange={onOpenChange} title={t('settings.about.disclaimer')} description={t('settings.about.disclaimer.description')} data-about-disclaimer
    footer={<div className="flex justify-end"><Button variant="accent" className="min-w-[76px]" onClick={() => onOpenChange(false)}>{t('common.done')}</Button></div>}>
    <ol className="space-y-3.5">
      {DISCLAIMER.map((item, index) => <li key={item.title} className="flex gap-3">
        <span className="mt-px w-4 shrink-0 text-right text-caption tabular-nums text-muted-foreground">{index + 1}</span>
        <div className="min-w-0">
          <h3 className="text-app font-medium text-foreground">{t(item.title)}</h3>
          <p className="mt-0.5 text-caption leading-relaxed text-muted-foreground">{t(item.body)}</p>
        </div>
      </li>)}
    </ol>
  </SettingsSheet>
}

interface Notice { name: string; version: string; license: string; url?: string; textId?: string }
interface Notices { packages: Notice[]; texts: Record<string, string> }

let loaded: Promise<Notices> | null = null
/** Generated at build time next to the renderer (build/third-party-notices.mjs). */
function loadNotices() {
  loaded ??= fetch('/third-party-notices.json').then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json() as Promise<Notices>
  }).catch((error: unknown) => { loaded = null; throw error })
  return loaded
}

/** Every open-source package a PiPilot build ships, with its license text. */
export function ThirdPartyNoticesSheet({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const t = useT()
  const [notices, setNotices] = React.useState<Notices | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [expanded, setExpanded] = React.useState<string | null>(null)
  React.useEffect(() => {
    if (!open || notices) return
    let current = true
    setFailed(false)
    void loadNotices().then((value) => { if (current) setNotices(value) }).catch(() => { if (current) setFailed(true) })
    return () => { current = false }
  }, [open, notices])
  const needle = query.trim().toLowerCase()
  const shown = notices?.packages.filter((entry) => !needle || entry.name.toLowerCase().includes(needle) || entry.license.toLowerCase().includes(needle)) ?? []
  return <SettingsSheet open={open} onOpenChange={onOpenChange} wide title={t('settings.about.notices')}
    description={notices ? t('settings.about.notices.description', { count: notices.packages.length }) : t('settings.about.notices.descriptionLoading')} data-about-notices
    footer={<div className="flex justify-end"><Button variant="accent" className="min-w-[76px]" onClick={() => onOpenChange(false)}>{t('common.done')}</Button></div>}>
    <div className="space-y-3">
      <div className="relative">
        <TbSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('settings.about.notices.search')} aria-label={t('settings.about.notices.search')} className="pl-8" />
      </div>
      <p className="text-micro leading-snug text-muted-foreground">{t('settings.about.notices.bundled')}</p>
      {failed ? <p role="alert" className="text-caption text-destructive">{t('settings.about.notices.unavailable')}</p>
        : !notices ? <p role="status" className="flex items-center gap-2 text-caption text-muted-foreground"><TbLoader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />{t('settings.about.loading')}</p>
          : <SettingsGroup boxRole="list">
            {shown.map((entry) => {
              const key = `${entry.name}@${entry.version}`
              const open = expanded === key
              const text = entry.textId ? notices.texts[entry.textId] : undefined
              return <div key={key} role="listitem" data-settings-row data-notice={entry.name} className="min-w-0">
                <button type="button" aria-expanded={open} onClick={() => setExpanded(open ? null : key)}
                  className="flex min-h-[36px] w-full min-w-0 items-center gap-2 px-3 py-1.5 text-left outline-none focus-visible:focus-ring">
                  <TbChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast)', open && 'rotate-90')} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-app text-foreground">{entry.name}<span className="ml-1.5 text-caption text-muted-foreground">{entry.version}</span></span>
                  <span className="shrink-0 text-caption text-muted-foreground">{entry.license}</span>
                </button>
                {open ? <div className="px-3 pb-3 pl-8">
                  {entry.url ? <button type="button" onClick={() => window.open(entry.url, '_blank', 'noopener')} className="mb-2 inline-flex items-center gap-1 text-caption text-primary hover:underline">
                    {entry.url}<TbExternalLink className="size-3" aria-hidden />
                  </button> : null}
                  {text ? <pre className="scroll-slim max-h-72 overflow-auto rounded-[8px] bg-fill/60 p-2.5 font-mono text-micro leading-relaxed whitespace-pre-wrap text-foreground/85">{text}</pre>
                    : <p className="text-caption text-muted-foreground">{t('settings.about.notices.noText', { license: entry.license })}</p>}
                </div> : null}
              </div>
            })}
            {!shown.length ? <div data-settings-row role="status" className="px-3 py-6 text-center text-caption text-muted-foreground">{t('settings.about.notices.empty')}</div> : null}
          </SettingsGroup>}
    </div>
  </SettingsSheet>
}
