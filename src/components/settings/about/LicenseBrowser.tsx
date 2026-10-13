import * as React from 'react'
import { TbArrowLeft, TbChevronRight, TbExternalLink, TbLoader2, TbRefresh, TbSearch, TbX } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { filterNotices, loadNotices, noticeKey, noticeProjectUrl, type Notices } from './notices'

/** One scroll surface per pane. The directory stays mounted during narrow-screen drill-in. */
export function LicenseBrowser({ active }: { active: boolean }) {
  const t = useT()
  const [notices, setNotices] = React.useState<Notices | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [revision, retry] = React.useReducer((value: number) => value + 1, 0)
  const [query, setQuery] = React.useState('')
  const [license, setLicense] = React.useState('')
  const [selectedKey, setSelectedKey] = React.useState<string | null>(null)
  const [detailOpen, setDetailOpen] = React.useState(false)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLUListElement>(null)
  const backRef = React.useRef<HTMLButtonElement>(null)
  const listScroll = React.useRef(0)
  const returnFocus = React.useRef(false)

  React.useEffect(() => {
    if (!active || notices || failed) return
    let current = true
    void loadNotices().then((value) => { if (current) setNotices(value) }).catch(() => { if (current) setFailed(true) })
    return () => { current = false }
  }, [active, notices, revision, failed])

  const shown = React.useMemo(() => filterNotices(notices?.packages ?? [], query, license), [notices, query, license])
  const licenses = React.useMemo(() => [...new Set(notices?.packages.map((entry) => entry.license) ?? [])].sort(), [notices])
  const selected = shown.find((entry) => noticeKey(entry) === selectedKey) ?? shown[0]
  const selectedId = selected ? noticeKey(selected) : null
  const projectUrl = noticeProjectUrl(selected?.url)
  const text = selected?.textId ? notices?.texts[selected.textId] : undefined

  React.useLayoutEffect(() => {
    if (!active) return
    if (listRef.current?.clientHeight) listRef.current.scrollTop = listScroll.current
    if (detailOpen && window.matchMedia('(max-width: 767px)').matches) backRef.current?.focus({ preventScroll: true })
    if (!detailOpen && returnFocus.current) {
      returnFocus.current = false
      listRef.current?.querySelector<HTMLButtonElement>('[aria-current="true"]')?.focus({ preventScroll: true })
    }
  }, [active, detailOpen])

  function resetDirectory() {
    listScroll.current = 0
    if (listRef.current) listRef.current.scrollTop = 0
    setSelectedKey(null)
    setDetailOpen(false)
  }

  function moveFocus(event: React.KeyboardEvent<HTMLUListElement>) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-notice]'))
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (index < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
    buttons[next]?.focus({ preventScroll: true })
    buttons[next]?.scrollIntoView({ block: 'nearest' })
  }

  return <div className="flex h-full min-h-0 flex-col gap-3">
    <div data-notices-toolbar className="shrink-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-[1_1_200px]">
          <TbSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input ref={searchRef} data-notices-search value={query} onChange={(event) => { setQuery(event.target.value); resetDirectory() }}
            placeholder={t('settings.about.notices.search')} aria-label={t('settings.about.notices.search')} className="pl-8 pr-8"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); resetDirectory() }
              if (event.key === 'ArrowDown' && listRef.current?.clientHeight) {
                event.preventDefault()
                listRef.current?.querySelector<HTMLButtonElement>('[data-notice]')?.focus()
              }
            }} />
          {query ? <button type="button" aria-label={t('settings.about.notices.clearSearch')}
            className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:focus-ring"
            onClick={() => { setQuery(''); resetDirectory(); searchRef.current?.focus() }}><TbX className="size-3.5" aria-hidden /></button> : null}
        </div>
        <select className="mac-select max-w-full" aria-label={t('settings.about.notices.filter')} value={license}
          disabled={!notices} onChange={(event) => { setLicense(event.target.value); resetDirectory() }}>
          <option value="">{t('settings.about.notices.allLicenses')}</option>
          {licenses.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
      {notices ? <p role="status" className="text-caption text-muted-foreground">{t('settings.about.notices.results', { count: shown.length, total: notices.packages.length })}</p> : null}
    </div>

    {failed ? <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
      <p role="alert" className="text-caption text-destructive">{t('settings.about.notices.unavailable')}</p>
      <Button variant="outline" onClick={() => { setFailed(false); retry() }}><TbRefresh aria-hidden />{t('common.retry')}</Button>
    </div> : !notices ? <div role="status" className="flex min-h-0 flex-1 items-center justify-center gap-2 text-caption text-muted-foreground">
      <TbLoader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />{t('settings.about.loading')}
    </div> : !shown.length ? <div role="status" className="flex min-h-0 flex-1 items-center justify-center text-caption text-muted-foreground">{t('settings.about.notices.empty')}</div>
      : <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-border/70 bg-background/40">
        <ul ref={listRef} data-notices-list aria-label={t('settings.about.notices.packages')}
          className={cn('scroll-slim min-h-0 w-full shrink-0 overflow-y-auto overscroll-contain p-1.5 md:block md:w-[32%] md:border-r md:border-border/70', detailOpen && 'hidden')}
          onKeyDown={moveFocus} onScroll={(event) => { if (event.currentTarget.clientHeight) listScroll.current = event.currentTarget.scrollTop }}>
          {shown.map((entry) => {
            const key = noticeKey(entry)
            return <li key={key}>
              <button type="button" data-notice={entry.name} aria-current={key === selectedId ? 'true' : undefined}
                onClick={() => {
                  listScroll.current = listRef.current?.scrollTop ?? 0
                  setSelectedKey(key)
                  setDetailOpen(true)
                }}
                className={cn('flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left outline-none hover:bg-fill focus-visible:focus-ring', key === selectedId && 'bg-fill-strong')}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-app text-foreground" title={entry.name}>{entry.name}</span>
                  <span className="mt-0.5 block truncate text-micro text-muted-foreground">{entry.version} · {entry.license}</span>
                </span>
                <TbChevronRight className="size-3.5 shrink-0 text-muted-foreground md:hidden" aria-hidden />
              </button>
            </li>
          })}
        </ul>
        <section data-notice-detail={selected?.name} aria-label={selected?.name}
          className={cn('min-h-0 min-w-0 flex-1 flex-col md:flex', detailOpen ? 'flex' : 'hidden')}>
          <header className="shrink-0 space-y-2 border-b border-border/60 p-3 md:p-4">
            <Button ref={backRef} variant="ghost" size="sm" className="-ml-1 md:hidden" onClick={() => { returnFocus.current = true; setDetailOpen(false) }}>
              <TbArrowLeft aria-hidden />{t('common.back')}
            </Button>
            <h3 className="break-words text-app font-semibold [overflow-wrap:anywhere]">{selected?.name}</h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
              <span>{selected?.version}</span><span>{selected?.license}</span>
              {projectUrl ? <a href={projectUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-sm text-primary outline-none hover:underline focus-visible:focus-ring">
                {t('settings.about.notices.project')}<TbExternalLink className="size-3" aria-hidden />
              </a> : null}
            </div>
          </header>
          <div key={selectedId} data-notice-document tabIndex={0} role="region" aria-label={t('settings.about.notices.licenseText')}
            className="scroll-slim min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 outline-none focus-visible:focus-ring md:p-4">
            {text ? <pre data-notice-text className="font-sans text-caption leading-relaxed whitespace-pre-wrap text-foreground/85 [overflow-wrap:anywhere]">{text}</pre>
              : <p className="text-caption text-muted-foreground">{t('settings.about.notices.noText', { license: selected?.license ?? '' })}</p>}
          </div>
        </section>
      </div>}
    <p className="shrink-0 text-micro leading-snug text-muted-foreground">{t('settings.about.notices.bundled')}</p>
  </div>
}
