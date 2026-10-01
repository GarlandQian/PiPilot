import type * as React from 'react'
import { TbArrowsMaximize, TbArrowsMinimize, TbChevronLeft, TbFiles, TbGitCompare, TbX, TbMessages, TbLayoutDashboard } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useT } from '@/i18n'

export const INSPECTOR_TABS = ['context', 'files', 'diff'] as const
export type InspectorTab = (typeof INSPECTOR_TABS)[number] | 'subagent' | 'command' | 'sidechat'

export function isInspectorTab(value: string): value is InspectorTab {
  return value === 'sidechat' || value === 'subagent' || value === 'command' || (INSPECTOR_TABS as readonly string[]).includes(value)
}

const viewIcons = { context: TbLayoutDashboard, files: TbFiles, diff: TbGitCompare }

export function InspectorToolbar({ activeView, onViewChange, onClose, onBack, workspaceName, onExpand, expanded, hasSideChat }: {
  activeView: InspectorTab
  onViewChange: (view: InspectorTab) => void
  onClose?: () => void
  visible?: boolean
  onBack?: () => void
  workspaceName?: string
  onExpand?: () => void
  expanded?: boolean
  hasSideChat?: boolean
}) {
  const t = useT()
  const detail = activeView === 'command' || activeView === 'subagent' || activeView === 'sidechat'
  // Inspector column: a toolbar-height title row, then a full-width
  // segmented control (Xcode / Finder inspector layout).
  return <header className="shrink-0 border-b border-border bg-toolbar">
    <div className="app-drag flex h-(--frame-header-h) min-w-0 items-center gap-0.5 pr-2.5 pl-3.5 [&_[data-slot=button]]:rounded-full [&_[data-slot=button]]:text-foreground/70 [&_[data-slot=button]:hover]:text-foreground">
      {detail && onBack ? <Button variant="ghost" size="icon-sm" className="-ml-1.5" onClick={onBack} aria-label={t('inspector.resource.back')} title={t('inspector.resource.back')}><TbChevronLeft className="size-[18px] stroke-[2.4]" aria-hidden /></Button> : null}
      <div className="min-w-0 flex-1 pr-1">
        <p className="truncate text-app leading-tight font-semibold" title={workspaceName}>{workspaceName || t('inspector.resource.workspace')}</p>
        {detail && activeView !== 'sidechat' ? <p className="text-micro leading-tight text-muted-foreground">{t(`inspector.tab.${activeView}`)}</p> : null}
      </div>
      {hasSideChat && activeView !== 'sidechat' ? <Button variant="ghost" size="icon-sm" onClick={() => onViewChange('sidechat')} aria-label={t('inspector.tab.sidechat')} title={t('inspector.tab.sidechat')}><TbMessages aria-hidden /></Button> : null}
      {onExpand ? <Button variant="ghost" size="icon-sm" onClick={onExpand} aria-label={t(expanded ? 'inspector.resource.restore' : 'inspector.resource.expand')} title={t(expanded ? 'inspector.resource.restore' : 'inspector.resource.expand')}>
        {expanded ? <TbArrowsMinimize className="size-4" aria-hidden /> : <TbArrowsMaximize className="size-4" aria-hidden />}
      </Button> : null}
      {onClose ? <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('inspector.close')} title={t('inspector.close')}><TbX className="size-4" aria-hidden /></Button> : null}
    </div>
    <Tabs hidden={detail} value={detail ? '' : activeView} onValueChange={(value) => { if (isInspectorTab(value)) onViewChange(value) }} className="min-w-0 px-3 pb-2.5">
      <TabsList aria-label={t('inspector.switchView')} className="w-full">
        {INSPECTOR_TABS.map((view) => {
          const Icon = viewIcons[view]
          return <TabsTrigger key={view} value={view} id={`resource-tab-${view}`} aria-controls={`resource-view-${view}`} className="min-w-0 gap-1.5" title={t(`inspector.tab.${view}`)}>
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
    role={view === 'files' || view === 'diff' || view === 'context' ? 'tabpanel' : 'region'}
    aria-label={t(`inspector.tab.${view}`)}
    aria-labelledby={view === 'files' || view === 'diff' || view === 'context' ? `resource-tab-${view}` : undefined}
    data-inspector-view={view}
    hidden={view !== activeView}
    className="min-h-0 flex-1 overflow-hidden"
  >{children}</section>
}
