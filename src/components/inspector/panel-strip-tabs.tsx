import * as React from 'react'
import { TbFileSearch, TbFolder, TbGitCompare, TbMessages, TbRobot, TbTerminal, TbTerminal2 } from 'react-icons/tb'
import { useT } from '@/i18n'
import { APP_SHORTCUTS } from '@/lib/app-shortcuts'
import { formatShortcut } from '@/lib/keyboard-shortcuts'
import { MaterialFileIcon } from './MaterialFileIcon'
import type { PanelDock, PanelTab, PanelTabsState } from './panel-tabs'
import type { PanelNewTabItem, PanelStripTab } from './PanelTabStrip'

function baseName(path: string) {
  return path.split('/').pop() ?? path
}

/** The strip's labels and icons, and what "+" (and an empty dock) can open. */
export function usePanelStrip({ state, projectAvailable, onOpenReview, onOpenFiles, onSearchFiles, onOpenTerminal, terminalSlot }: {
  state: PanelTabsState
  projectAvailable: boolean
  /** Where the terminal draws one tab per session. */
  terminalSlot?: React.RefCallback<HTMLDivElement>
  onOpenReview(): void
  onOpenFiles(): void
  onSearchFiles(): void
  onOpenTerminal(): void
}) {
  const t = useT()
  const describe = React.useCallback((tab: PanelTab, duplicateNames: ReadonlySet<string>): PanelStripTab => {
    if (tab.kind === 'file') {
      const name = baseName(tab.path)
      const parent = tab.path.includes('/') ? tab.path.slice(0, tab.path.lastIndexOf('/')) : ''
      // Two open files with one name read as "index.ts · src/a".
      return { id: tab.id, label: duplicateNames.has(name) && parent ? `${name} · ${baseName(parent)}` : name, title: tab.path,
        icon: <MaterialFileIcon name={name} path={tab.path} type="file" className="size-3.5" /> }
    }
    const labels = {
      review: [t('panel.tab.review'), <TbGitCompare key="icon" />],
      files: [t('inspector.tab.files'), <TbFolder key="icon" />],
      terminal: [t('inspector.tab.terminal'), <TbTerminal2 key="icon" />],
      sidechat: [t('inspector.tab.sidechat'), <TbMessages key="icon" />],
      subagent: [t('inspector.tab.subagent'), <TbRobot key="icon" />],
      command: [t('inspector.tab.command'), <TbTerminal key="icon" />],
    } as const
    const [label, icon] = labels[tab.kind]
    return { id: tab.id, label, icon, ...(tab.kind === 'terminal' && terminalSlot ? { slot: terminalSlot } : {}) }
  }, [t, terminalSlot])

  const tabs = React.useCallback((dock: PanelDock) => {
    const files = Object.values(state.tabs).flatMap((tab) => tab.kind === 'file' ? [baseName(tab.path)] : [])
    const duplicates = new Set(files.filter((name, index) => files.indexOf(name) !== index))
    return state[dock].tabIds.flatMap((id) => state.tabs[id] ? [describe(state.tabs[id]!, duplicates)] : [])
  }, [describe, state])

  const newTabItems = React.useMemo<PanelNewTabItem[]>(() => [
    ...(projectAvailable ? [
      { id: 'review', label: t('panel.tab.review'), icon: <TbGitCompare aria-hidden />, shortcut: formatShortcut(APP_SHORTCUTS.openReview), onSelect: onOpenReview },
      { id: 'files', label: t('inspector.tab.files'), icon: <TbFolder aria-hidden />, shortcut: formatShortcut(APP_SHORTCUTS.toggleFileTree), onSelect: onOpenFiles },
      { id: 'search', label: t('panel.tab.searchFiles'), icon: <TbFileSearch aria-hidden />, shortcut: formatShortcut(APP_SHORTCUTS.searchFiles), onSelect: onSearchFiles },
    ] : []),
    { id: 'terminal', label: t('inspector.tab.terminal'), icon: <TbTerminal2 aria-hidden />, shortcut: formatShortcut(APP_SHORTCUTS.toggleTerminal), onSelect: onOpenTerminal },
  ], [onOpenFiles, onOpenReview, onOpenTerminal, onSearchFiles, projectAvailable, t])

  return { tabs, newTabItems }
}
