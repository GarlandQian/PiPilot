import * as React from 'react'
import { TbSearch, TbX } from 'react-icons/tb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/i18n'
import type { PiCompatibilityLabel, PiPackageSummary, PiResourceSummary } from '@/shared/pi-integrations'

export function totalResources(pkg: PiPackageSummary) {
  return Object.values(pkg.resourceCounts).reduce((total, count) => total + count, 0)
}

export function CompatibilityBadge({ value }: { value: PiCompatibilityLabel }) {
  const t = useT()
  return (
    <Badge variant={value === 'rich-adapter' ? 'secondary' : 'outline'}>
      {t(`settings.integrations.compatibility.${value}`)}
    </Badge>
  )
}

export function ResourceStateBadge({ value }: { value: PiResourceSummary['effectiveState'] }) {
  const t = useT()
  return (
    <Badge variant={value === 'enabled' ? 'soft-success' : 'outline'}>
      {t(`settings.integrations.resource.state.${value}`)}
    </Badge>
  )
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-40 place-items-center px-4 py-8 text-center text-caption leading-relaxed text-muted-foreground">
      {children}
    </div>
  )
}

export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  onBrowse,
}: {
  value: string
  onChange(value: string): void
  label?: string
  placeholder?: string
  onBrowse?(): void
}) {
  const t = useT()
  const inputRef = React.useRef<HTMLInputElement>(null)
  return (
    <div className="relative min-w-0 flex-1">
      <TbSearch className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        ref={inputRef}
        type="search"
        className="pl-8 pr-9 [&::-webkit-search-cancel-button]:appearance-none"
        value={value}
        aria-label={label ?? t('settings.integrations.search')}
        placeholder={placeholder ?? label ?? t('settings.integrations.search')}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
          if (event.key === 'Escape' && value) {
            event.preventDefault()
            event.stopPropagation()
            onChange('')
          } else if (event.key === 'ArrowDown' && onBrowse) {
            event.preventDefault()
            onBrowse()
          }
        }}
      />
      {value ? <Button
        variant="ghost"
        size="icon-xs"
        className="absolute right-1.5 top-1/2 -translate-y-1/2"
        aria-label={t('settings.integrations.catalog.clearSearch')}
        title={t('settings.integrations.catalog.clearSearch')}
        onClick={() => { onChange(''); inputRef.current?.focus() }}
      ><TbX aria-hidden /></Button> : null}
    </div>
  )
}

export function focusCatalogRow(collection: HTMLElement | null, id?: string) {
  const rows = [...(collection?.querySelectorAll<HTMLButtonElement>('[data-integration-row]') ?? [])]
  const row = rows.find((candidate) => candidate.dataset.integrationRow === id) ?? rows[0]
  row?.focus()
}

/** Arrow keys browse only the primary row controls, not their inline actions. */
export function handleCatalogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return
  const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-integration-row]')]
  const index = rows.indexOf(event.target as HTMLButtonElement)
  if (index < 0) return
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? rows.length - 1
      : event.key === 'ArrowDown' ? Math.min(rows.length - 1, index + 1)
        : event.key === 'ArrowUp' ? Math.max(0, index - 1) : null
  if (next === null) return
  event.preventDefault()
  rows[next]?.focus()
}

export function CatalogCollection({ label, children, ref }: {
  label: string
  children: React.ReactNode
  ref?: React.Ref<HTMLElement>
}) {
  return <nav
    ref={ref}
    aria-label={label}
    className="scroll-slim max-h-[min(38rem,64vh)] space-y-1 overflow-y-auto py-2 pr-1"
    onKeyDown={handleCatalogKeyDown}
  >{children}</nav>
}
