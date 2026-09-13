import * as React from 'react'
import { TbChevronDown, TbFiles, TbGitCompare, TbTerminal2, TbX } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useT } from '@/i18n'

export const INSPECTOR_TABS = ['files', 'diff', 'terminal'] as const
export type InspectorTab = (typeof INSPECTOR_TABS)[number]

export function isInspectorTab(value: string): value is InspectorTab {
  return (INSPECTOR_TABS as readonly string[]).includes(value)
}

const viewIcons = { files: TbFiles, diff: TbGitCompare, terminal: TbTerminal2 }

export function InspectorToolbar({ activeView, onViewChange, onClose, visible = true }: {
  activeView: InspectorTab
  onViewChange: (view: InspectorTab) => void
  onClose?: () => void
  visible?: boolean
}) {
  const t = useT()
  const Icon = viewIcons[activeView]
  const [menuOpen, setMenuOpen] = React.useState(false)
  React.useEffect(() => {
    if (!visible) setMenuOpen(false)
  }, [visible])
  return (
    <header className="flex h-(--frame-header-h) shrink-0 items-center gap-1 border-b border-border px-2">
      <DropdownMenu open={visible && menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="min-w-0 justify-start gap-2 px-2" aria-label={t('inspector.switchView')}>
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="truncate text-caption font-medium">{t(`inspector.tab.${activeView}`)}</span>
            <TbChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuRadioGroup value={activeView} onValueChange={(value) => {
            if (isInspectorTab(value)) onViewChange(value)
          }}>
            {INSPECTOR_TABS.map((view) => {
              const ViewIcon = viewIcons[view]
              return <DropdownMenuRadioItem key={view} value={view} className="gap-2 text-caption">
                <ViewIcon aria-hidden />{t(`inspector.tab.${view}`)}
              </DropdownMenuRadioItem>
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="flex-1" />
      {onClose ? <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('inspector.close')} title={t('inspector.close')}>
        <TbX aria-hidden />
      </Button> : null}
    </header>
  )
}

/** A menu selects these views; they are labelled regions, not ARIA tab panels. */
export function InspectorView({ view, activeView, children }: {
  view: InspectorTab
  activeView: InspectorTab
  children: React.ReactNode
}) {
  const t = useT()
  return <section
    aria-label={t(`inspector.tab.${view}`)}
    data-inspector-view={view}
    hidden={view !== activeView}
    className="min-h-0 flex-1 overflow-hidden"
  >{children}</section>
}
