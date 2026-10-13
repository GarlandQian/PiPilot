import * as React from 'react'
import { TbExternalLink } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useT } from '@/i18n'
import { SettingsGroup, SettingsSheet } from '../kit'
import { CREDITS } from './credits'
import { LicenseBrowser } from './LicenseBrowser'

/** Curated acknowledgements and the complete build manifest, without growing the About page. */
export function OpenSourceSheet({ open, onOpenChange, onCloseAutoFocus }: {
  open: boolean
  onOpenChange(open: boolean): void
  onCloseAutoFocus?: (event: Event) => void
}) {
  const t = useT()
  const [tab, setTab] = React.useState('credits')
  return <SettingsSheet open={open} onOpenChange={onOpenChange} title={t('settings.about.notices')}
    description={t('settings.about.notices.summary')} bodyLayout="contained" data-about-notices
    className="h-[640px] sm:max-w-[920px]"
    onCloseAutoFocus={onCloseAutoFocus}
    onEscapeKeyDown={(event) => {
      // Radix sees Escape in the capture phase, before the search field can clear it.
      if (event.target instanceof HTMLInputElement && event.target.hasAttribute('data-notices-search') && event.target.value) event.preventDefault()
    }}
    footer={<div className="flex justify-end"><Button variant="accent" className="min-w-[76px]" onClick={() => onOpenChange(false)}>{t('common.done')}</Button></div>}>
    <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1 gap-3">
      <TabsList className="shrink-0" aria-label={t('settings.about.notices')}>
        <TabsTrigger value="credits">{t('settings.about.notices.highlights')}</TabsTrigger>
        <TabsTrigger value="licenses">{t('settings.about.notices.allLicenses')}</TabsTrigger>
      </TabsList>
      <TabsContent value="credits" forceMount className="scroll-slim min-h-0 overflow-y-auto overscroll-contain data-[state=inactive]:hidden">
        <SettingsGroup boxRole="list" data-about-credits>
          {CREDITS.map((credit) => <div key={credit.name} role="listitem" data-settings-row data-pressable
            className="flex min-h-12 min-w-0 items-center gap-3 px-3 py-2">
            <button type="button" data-settings-row-action aria-label={credit.name}
              onClick={() => window.open(credit.url, '_blank', 'noopener')}
              className="absolute inset-0 rounded-[inherit] outline-none focus-visible:focus-ring" />
            <span className="pointer-events-none relative min-w-0 flex-1">
              <span className="block text-app font-medium">{credit.name}</span>
              <span className="mt-0.5 block text-caption leading-snug text-muted-foreground">{t(credit.role)}</span>
            </span>
            <span className="pointer-events-none relative max-w-[30%] text-right text-micro text-muted-foreground">{credit.license}</span>
            <TbExternalLink className="pointer-events-none relative size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </div>)}
        </SettingsGroup>
      </TabsContent>
      <TabsContent value="licenses" forceMount className="min-h-0 overflow-hidden data-[state=inactive]:hidden">
        <LicenseBrowser active={open && tab === 'licenses'} />
      </TabsContent>
    </Tabs>
  </SettingsSheet>
}
