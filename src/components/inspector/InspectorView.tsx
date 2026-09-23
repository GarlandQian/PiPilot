import type * as React from 'react'
import { TbArrowLeft, TbArrowsMaximize, TbArrowsMinimize, TbFiles, TbGitCompare, TbX } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useT } from '@/i18n'

export const INSPECTOR_TABS = ['files', 'diff'] as const
export type InspectorTab = (typeof INSPECTOR_TABS)[number] | 'subagent' | 'command'

export function isInspectorTab(value: string): value is InspectorTab {
  return value === 'subagent' || value === 'command' || (INSPECTOR_TABS as readonly string[]).includes(value)
}

const viewIcons = { files: TbFiles, diff: TbGitCompare }

export function InspectorToolbar({ activeView, onViewChange, onClose, onBack, workspaceName, onExpand, expanded }: {
  activeView: InspectorTab
  onViewChange: (view: InspectorTab) => void
  onClose?: () => void
  visible?: boolean
  onBack?: () => void
  workspaceName?: string
  onExpand?: () => void
  expanded?: boolean
}) {
  const t = useT()
  const detail = activeView === 'command' || activeView === 'subagent'
  return <header className="shrink-0 border-b border-border/60 bg-surface px-3 pt-3">
    <div className="flex min-w-0 items-center gap-1 pb-2">
      {detail && onBack ? <Button variant="ghost" size="icon-xs" onClick={onBack} aria-label={t('inspector.resource.back')} title={t('inspector.resource.back')}><TbArrowLeft aria-hidden /></Button> : null}
      <div className="min-w-0 flex-1 px-1">
        <p className="truncate text-caption font-medium" title={workspaceName}>{workspaceName || t('inspector.resource.workspace')}</p>
        {detail ? <p className="text-micro text-muted-foreground">{t(`inspector.tab.${activeView}`)}</p> : null}
      </div>
      {onExpand ? <Button variant="ghost" size="icon-xs" onClick={onExpand} aria-label={t(expanded ? 'inspector.resource.restore' : 'inspector.resource.expand')} title={t(expanded ? 'inspector.resource.restore' : 'inspector.resource.expand')}>
        {expanded ? <TbArrowsMinimize aria-hidden /> : <TbArrowsMaximize aria-hidden />}
      </Button> : null}
      {onClose ? <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label={t('inspector.close')} title={t('inspector.close')}><TbX aria-hidden /></Button> : null}
    </div>
    <Tabs hidden={detail} value={detail ? '' : activeView} onValueChange={(value) => { if (isInspectorTab(value)) onViewChange(value) }} className="min-w-0">
      <TabsList aria-label={t('inspector.switchView')} variant="line" className="h-10 w-full justify-start gap-4">
        {INSPECTOR_TABS.map((view) => {
          const Icon = viewIcons[view]
          return <TabsTrigger key={view} value={view} id={`resource-tab-${view}`} aria-controls={`resource-view-${view}`} className="min-w-0 gap-2 px-1 text-caption" title={t(`inspector.tab.${view}`)}>
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{t(`inspector.tab.${view}`)}</span>
          </TabsTrigger>
        })}
      </TabsList>
    </Tabs>
  </header>
}

/** Details are destinations, not extra categories. Retain inactive reading state. */
export function InspectorView({ view, activeView, children }: {
  view: InspectorTab
  activeView: InspectorTab
  children: React.ReactNode
}) {
  const t = useT()
  return <section
    id={`resource-view-${view}`}
    role={view === 'files' || view === 'diff' ? 'tabpanel' : 'region'}
    aria-label={t(`inspector.tab.${view}`)}
    aria-labelledby={view === 'files' || view === 'diff' ? `resource-tab-${view}` : undefined}
    data-inspector-view={view}
    hidden={view !== activeView}
    className="min-h-0 flex-1 overflow-hidden"
  >{children}</section>
}
