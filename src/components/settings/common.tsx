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
    <section className="border-b border-border/70 px-5 py-5 last:border-b-0">
      <h3 className="text-title text-foreground">{title}</h3>
      {desc && <p className="mt-0.5 text-caption text-muted-foreground">{desc}</p>}
      <div className="mt-3 flex flex-col gap-1.5">{children}</div>
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
        '@container/setting-row density-row -mx-2 flex flex-col items-stretch gap-2 rounded-md px-2 py-1 transition-colors duration-(--duration-fast) hover:bg-accent/30 @min-[520px]/setting-row:flex-row @min-[520px]/setting-row:items-center @min-[520px]/setting-row:gap-4 @min-[520px]/setting-row:py-0',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-app text-foreground">{label}</p>
        {desc && <p className="mt-0.5 text-caption text-muted-foreground">{desc}</p>}
      </div>
      <div className="flex min-w-0 items-center gap-2 @min-[520px]/setting-row:shrink-0">{children}</div>
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
