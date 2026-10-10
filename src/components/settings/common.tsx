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
