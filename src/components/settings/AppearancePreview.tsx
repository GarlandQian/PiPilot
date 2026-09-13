import { TbCheck, TbTerminal2 } from 'react-icons/tb'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { resolveMonoFontStack, resolveUiFontStack, type AppearanceSettings, type ThemeMode } from '@/types/settings'

export function ThemePreview({ mode }: { mode: ThemeMode }) {
  const panels = mode === 'system' ? ['light', 'dark'] : [mode]
  return <div className="flex h-20 w-full overflow-hidden rounded-sm border border-border" aria-hidden>
    {panels.map((theme) => <div key={theme} className={cn(theme, 'flex min-w-0 flex-1 gap-2 bg-background p-2')}>
      <div className="w-1/5 rounded-sm bg-sidebar" />
      <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
        <div className="ml-auto h-3 w-3/5 rounded-sm bg-selected" />
        <div className="space-y-1"><div className="h-1 w-4/5 rounded-sm bg-muted-foreground/40" /><div className="h-1 w-3/5 rounded-sm bg-muted-foreground/25" /></div>
        <div className="h-3 rounded-sm border border-border bg-composer" />
      </div>
    </div>)}
  </div>
}

export function AppearancePreview({ appearance }: { appearance: AppearanceSettings }) {
  const t = useT()
  const lines = ['const message = {', '  role: "assistant",', '  content: "A clearer view of the work, from the first question to the final result."', '}']
  return <figure className="min-w-0 overflow-hidden rounded-md border border-border bg-surface" aria-label={t('settings.appearance.preview')} data-appearance-preview>
    <figcaption className="border-b border-border/60 bg-surface-inset/40 px-4 py-2 text-micro text-muted-foreground">{t('settings.appearance.preview')}</figcaption>
    <div className={cn('min-w-0 px-5 py-5', appearance.density === 'compact' ? 'space-y-3' : 'space-y-5')} style={{ fontFamily: resolveUiFontStack(appearance.uiFontFamily), fontSize: appearance.uiFontSize }}>
      <div className="ml-auto w-fit max-w-[88%] rounded-md bg-selected/70 px-3 py-2">{t('settings.redesign.previewQuestion')}</div>
      <p className="leading-relaxed">{t('settings.redesign.previewAnswer')}</p>
      <div className="flex items-center gap-2 text-muted-foreground" style={{ fontSize: Math.max(11, appearance.uiFontSize - 1), paddingBlock: appearance.compactToolCards ? 0 : 4 }}>
        <TbTerminal2 className="size-4 shrink-0" aria-hidden /><span className="font-mono">git diff --stat</span><TbCheck className="ml-auto size-4 shrink-0 text-success" aria-hidden />
      </div>
      <div className="min-w-0 overflow-x-auto border-t border-border/60 pt-3" style={{ fontFamily: resolveMonoFontStack(appearance.monoFontFamily), fontSize: appearance.codeFontSize, fontVariantLigatures: appearance.codeLigatures ? 'normal' : 'none' }}>
        {lines.map((line, index) => <div key={index} className="flex min-w-0 gap-4 leading-6">
          {appearance.showLineNumbers ? <span className="w-4 shrink-0 select-none whitespace-nowrap text-right tabular-nums text-muted-foreground/65" aria-hidden>{index + 1}</span> : null}
          <code className={cn('min-w-0 text-foreground', appearance.wordWrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre')}>{line}</code>
        </div>)}
      </div>
    </div>
  </figure>
}
