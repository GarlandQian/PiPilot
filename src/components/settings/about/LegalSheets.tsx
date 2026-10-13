import { Button } from '@/components/ui/button'
import { type MessageKey, useT } from '@/i18n'
import { SettingsSheet } from '../kit'

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
