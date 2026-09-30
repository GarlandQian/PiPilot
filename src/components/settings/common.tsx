import * as React from 'react'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { SettingsSectionMeta } from './settings-navigation'

/** Rounded, tinted glyph tile used by System Settings panes. */
export function SettingsIconTile({ section, className }: {
  section: Pick<SettingsSectionMeta, 'icon' | 'tint'>
  className?: string
}) {
  const Icon = section.icon
  return (
    <span
      aria-hidden
      style={{ backgroundColor: section.tint }}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-[5px] bg-[linear-gradient(to_bottom,rgb(255_255_255/0.18),transparent)] text-white shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.08),0_0.5px_1px_rgb(0_0_0/0.15)]',
        className,
      )}
    >
      <Icon className="size-[70%] stroke-[2.2]" />
    </span>
  )
}

/**
 * System Settings grouped box: a small bold heading above an inset,
 * rounded group whose rows are separated by hairlines.
 */
export function SettingSection({
  title,
  desc,
  children,
}: {
  title: string
  desc?: string
  children: React.ReactNode
}) {
  return (
    <section className="min-w-0 pb-6 last:pb-0" aria-label={title}>
      <header className="mb-2 min-w-0 px-1">
        <h2 className="text-app font-semibold text-foreground">{title}</h2>
        {desc && <p className="mt-0.5 max-w-[72ch] text-caption leading-snug text-muted-foreground">{desc}</p>}
      </header>
      <div className="mac-group flex min-w-0 flex-col">{children}</div>
    </section>
  )
}

export function SettingRow({
  label,
  desc,
  children,
  className,
}: {
  label: string
  desc?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-setting-row
      className={cn(
        '@container/setting-row flex min-h-11 min-w-0 flex-col items-stretch gap-2.5 py-2.5 @min-[580px]/settings-workspace:flex-row @min-[580px]/settings-workspace:items-center @min-[580px]/settings-workspace:gap-6',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-app text-foreground">{label}</p>
        {desc && <p className="mt-0.5 max-w-[64ch] text-caption leading-snug text-muted-foreground">{desc}</p>}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 @min-[580px]/settings-workspace:max-w-[55%] @min-[580px]/settings-workspace:shrink-0 @min-[580px]/settings-workspace:justify-end">{children}</div>
    </div>
  )
}

export function ComingSoon({ id }: { id: string }) {
  const t = useT()
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-caption text-muted-foreground">
        {id} — {t('settings.title')}
      </p>
    </div>
  )
}
