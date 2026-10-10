import * as React from 'react'
import { TbBook2, TbCheck, TbCopy, TbPalette, TbPuzzle, TbSearch, TbSparkles, TbX } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'
import { useT, type MessageKey } from '@/i18n'
import type { PiResourceKind, PiResourceSummary } from '@/shared/pi-integrations'
import { usePiIntegrations } from '@/store/pi-integrations'
import { FormActions, SettingsBadge, SettingsField, SettingsGroup, SettingsListRow, SettingsPage, SettingsRow, SettingsSheet, StatusText } from '../kit'
import { filterIntegrationResources } from './catalog-model'
import { IntegrationNotices, IntegrationsUnavailable, useRefreshWhenShown } from './integration-notices'
import { subscribeResourceFocus, takeResourceFocus, type ResourceFocus } from './resource-focus'

const KINDS: readonly PiResourceKind[] = ['skill', 'prompt', 'extension', 'theme']
const KIND_STYLE: Record<PiResourceKind, { icon: React.ComponentType<{ className?: string }>; tint: string }> = {
  skill: { icon: TbSparkles, tint: '#af52de' },
  prompt: { icon: TbBook2, tint: '#ff9500' },
  extension: { icon: TbPuzzle, tint: '#007aff' },
  theme: { icon: TbPalette, tint: '#ff2d55' },
}

function KindIcon({ kind }: { kind: PiResourceKind }) {
  const { icon: Icon, tint } = KIND_STYLE[kind]
  return <span aria-hidden style={{ backgroundColor: tint }} className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-[linear-gradient(to_bottom,rgb(255_255_255/0.2),transparent)] text-white shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.08)]">
    <Icon className="size-[56%]" />
  </span>
}

/** Skills, prompts, extensions and themes Pi resolved for the open project (global ones included). Read-only. */
export function ResourcesSettings({ active = true }: { active?: boolean }) {
  const t = useT()
  const integrations = usePiIntegrations()
  const resources = React.useMemo(() => integrations.snapshot?.resources ?? [], [integrations.snapshot?.resources])
  useRefreshWhenShown(active)
  const [query, setQuery] = React.useState('')
  const [focus, setFocus] = React.useState<ResourceFocus | null>(null)
  const [open, setOpen] = React.useState<PiResourceSummary | null>(null)
  React.useEffect(() => {
    if (!active) return
    const take = () => {
      const next = takeResourceFocus()
      if (next) { setFocus(next); setQuery('') }
    }
    take()
    return subscribeResourceFocus(take)
  }, [active])
  React.useEffect(() => { if (!active) setOpen(null) }, [active])
  const searching = query.trim() !== ''
  const visible = filterIntegrationResources(resources, { query, kind: focus?.kind ?? 'all', packageId: focus?.packageId })
  const ready = integrations.snapshot?.state === 'ready'

  return <SettingsPage data-resources-settings data-integration-catalog="resources">
    <IntegrationNotices />
    <IntegrationsUnavailable />
    {ready ? <>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <TbSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('settings.resources.search')} aria-label={t('settings.resources.search')}
            className="h-7 rounded-full bg-fill pl-8 shadow-none focus-visible:bg-control" />
        </div>
        {focus ? <span className="flex min-w-0 items-center gap-1 rounded-full bg-primary/12 py-0.5 pr-1 pl-2.5 text-caption text-primary">
          <span className="truncate">{t('settings.integrations.catalog.packageResources', { name: focus.packageName })}</span>
          <Button variant="ghost" size="icon-xs" className="text-primary" aria-label={t('settings.integrations.catalog.clearPackage')} onClick={() => setFocus(null)}><TbX aria-hidden /></Button>
        </span> : null}
      </div>
      {KINDS.map((kind) => {
        const items = visible.filter((resource) => resource.kind === kind)
        if (!items.length && (searching || focus || !resources.some((resource) => resource.kind === kind))) return null
        return <SettingsGroup key={kind} title={t(`settings.integrations.resource.${kind}` as MessageKey)} boxRole="list" data-resource-kind={kind}
          info={kind === 'theme' ? t('settings.integrations.resources.themeBoundary') : undefined}>
          {items.map((resource) => <SettingsListRow key={resource.id} data-integration-row={resource.id} icon={<KindIcon kind={kind} />} title={resource.label}
            dimmed={resource.effectiveState === 'disabled'}
            badges={<>
              {resource.scope === 'project' ? <SettingsBadge tone="accent">{t('settings.packages.project')}</SettingsBadge> : null}
              {resource.effectiveState === 'disabled' ? <SettingsBadge>{t('settings.integrations.resource.state.disabled')}</SettingsBadge> : null}
            </>}
            subtitle={resource.invocation ?? resource.description ?? resource.source}
            status={resource.diagnostic ? <StatusText tone="warning">{t('settings.resources.hasNotice')}</StatusText> : undefined}
            onOpen={() => setOpen(resource)} openLabel={resource.label} />)}
        </SettingsGroup>
      })}
      {visible.length === 0 ? <div className="settings-group px-3 py-10 text-center text-caption text-muted-foreground" role="status">
        <p>{t(resources.length ? 'settings.integrations.resources.empty' : 'settings.resources.none')}</p>
        {searching || focus ? <Button variant="ghost" size="sm" className="mt-2" onClick={() => { setQuery(''); setFocus(null) }}>{t('settings.integrations.catalog.clearSearch')}</Button> : null}
      </div> : null}
      <p className="px-2.5 text-caption leading-snug text-muted-foreground">{t('settings.integrations.resources.readOnly')}</p>
    </> : null}
    <ResourceSheet resource={open} onOpenChange={(next) => { if (!next) setOpen(null) }} />
  </SettingsPage>
}

function ResourceSheet({ resource, onOpenChange }: { resource: PiResourceSummary | null; onOpenChange(open: boolean): void }) {
  const t = useT()
  const [copied, setCopied] = React.useState(false)
  React.useEffect(() => setCopied(false), [resource?.id])
  return <SettingsSheet open={resource !== null} onOpenChange={onOpenChange} title={resource?.label ?? ''} data-resource-sheet
    description={resource ? t(`settings.integrations.resource.${resource.kind}` as MessageKey) : undefined}
    footer={<FormActions onSave={() => onOpenChange(false)} saveLabel={t('common.done')} />}>
    {resource ? <div className="space-y-5">
      {resource.description ? <div className="px-2.5 text-caption text-muted-foreground [&_.md-body]:text-caption"><MarkdownContent markdown={resource.description} /></div> : null}
      <SettingsGroup>
        {resource.invocation ? <SettingsRow label={t('settings.integrations.resource.invocation')}>
          <code className="min-w-0 break-all font-mono text-caption">{resource.invocation}</code>
          <Button variant="ghost" size="icon-xs" aria-label={t('settings.integrations.resource.copyInvocation')}
            onClick={() => void navigator.clipboard.writeText(resource.invocation!).then(() => setCopied(true))}>{copied ? <TbCheck aria-hidden /> : <TbCopy aria-hidden />}</Button>
        </SettingsRow> : null}
        <SettingsRow label={t('settings.integrations.resource.state')}><span className="text-app text-muted-foreground">{t(`settings.integrations.resource.state.${resource.effectiveState}` as MessageKey)}</span></SettingsRow>
        <SettingsRow label={t('settings.integrations.package.scope')}><span className="text-app text-muted-foreground">{t(`settings.integrations.scope.${resource.scope}` as MessageKey)}</span></SettingsRow>
        <SettingsField label={t('settings.integrations.package.source')}><p className="break-all py-1 font-mono text-caption text-muted-foreground">{resource.source}</p></SettingsField>
        <SettingsField label={t('settings.integrations.package.path')}><p className="break-all py-1 font-mono text-caption text-muted-foreground">{resource.path}</p></SettingsField>
        <SettingsRow label={t('settings.integrations.compatibility.title')} info={t(`settings.integrations.compatibility.${resource.compatibility}.desc` as MessageKey)}>
          <span className="text-app text-muted-foreground">{t(`settings.integrations.compatibility.${resource.compatibility}` as MessageKey)}</span>
        </SettingsRow>
      </SettingsGroup>
      {resource.diagnostic ? <div className="rounded-[12px] bg-warning/10 px-3.5 py-2.5 text-caption text-warning [&_.md-body]:text-caption"><MarkdownContent markdown={resource.diagnostic} /></div> : null}
    </div> : null}
  </SettingsSheet>
}
