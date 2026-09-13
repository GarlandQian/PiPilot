import * as React from 'react'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

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
    <section className="min-w-0 border-b border-border/70 py-6 first:pt-0 last:border-b-0" aria-label={title}>
      <header className="mb-4 min-w-0">
        <h2 className="text-app font-semibold text-foreground">{title}</h2>
        {desc && <p className="mt-1 max-w-[72ch] text-caption leading-relaxed text-muted-foreground">{desc}</p>}
      </header>
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
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
      className={cn(
        '@container/setting-row flex min-w-0 flex-col items-stretch gap-3 rounded-md py-3 @min-[580px]/settings-workspace:flex-row @min-[580px]/settings-workspace:items-center @min-[580px]/settings-workspace:gap-8',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-app text-foreground">{label}</p>
        {desc && <p className="mt-1 max-w-[64ch] text-caption text-muted-foreground">{desc}</p>}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2 @min-[580px]/settings-workspace:max-w-[52%] @min-[580px]/settings-workspace:shrink-0">{children}</div>
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
