import type { RailDestination } from '@/components/frame/ActivityRail'
import type { SidebarConversationItem } from '@/components/layout/SessionList'
import {
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from '@/components/settings/settings-navigation'
import type { IntegrationsTabId } from '@/components/settings/IntegrationsSettings'
import type { MessageKey } from '@/i18n'
import { APP_SHORTCUTS } from './app-shortcuts'
import type { ShortcutSpec } from './keyboard-shortcuts'

/**
 * Handlers the command palette needs from the app frame. `App` satisfies
 * this with its existing navigation/session callbacks; every command here
 * stays reachable by pointer through the rail, panels, or headers.
 */
export interface CommandContext {
  /** True while the agent is streaming; gates the stop-generation command. */
  generating: boolean
  setRail(rail: RailDestination): void
  toggleContextPanel(): void
  toggleInspector(): void
  newSession(): void
  openSettingsSection(section: SettingsSectionId): void
  openIntegrationsTab(tab: IntegrationsTabId): void
  stopGeneration(): void
  selectSession(item: SidebarConversationItem): void
  /** A project is open, so review and files are available. */
  projectOpen: boolean
  toggleBottomPanel(): void
  toggleTerminal(): void
  openReview(): void
  searchFiles(): void
  toggleFileTree(): void
  cycleLayout(): void
  toggleFullView(): void
  toggleSummary(): void
}

export interface AppCommand {
  id: string
  titleKey: MessageKey
  hintKey?: MessageKey
  /** A primary-modifier key ("B" is ⌘B / Ctrl+B), or a full shortcut. */
  shortcut?: string | ShortcutSpec
  /** Extra search terms matched by cmdk in addition to the localized title. */
  keywords?: string
  /** Commands without an enabled predicate are always available. */
  enabled?(ctx: CommandContext): boolean
  run(ctx: CommandContext): void
}

/**
 * The palette intercepts this command id and swaps to its model-picker
 * sub-page instead of closing, so `run` is never invoked for this entry.
 */
export const CHANGE_MODEL_COMMAND_ID = 'action:change-model'

export const ACTION_COMMANDS: readonly AppCommand[] = [
  {
    id: 'action:new-session',
    titleKey: 'palette.command.newSession',
    keywords: 'create chat',
    run: (ctx) => ctx.newSession(),
  },
  {
    id: CHANGE_MODEL_COMMAND_ID,
    titleKey: 'palette.changeModel',
    hintKey: 'palette.changeModel.hint',
    keywords: 'model provider switch',
    run: () => undefined,
  },
  {
    id: 'action:toggle-context-panel',
    titleKey: 'palette.command.toggleContextPanel',
    shortcut: 'B',
    keywords: 'sidebar panel',
    run: (ctx) => ctx.toggleContextPanel(),
  },
  {
    id: 'action:toggle-inspector',
    titleKey: 'palette.command.toggleInspector',
    shortcut: APP_SHORTCUTS.switchChatAndTabs,
    keywords: 'panel tabs right side',
    run: (ctx) => ctx.toggleInspector(),
  },
  {
    id: 'action:toggle-bottom-panel',
    titleKey: 'palette.command.toggleBottomPanel',
    shortcut: APP_SHORTCUTS.toggleBottomPanel,
    keywords: 'panel bottom dock',
    run: (ctx) => ctx.toggleBottomPanel(),
  },
  {
    id: 'action:toggle-terminal',
    titleKey: 'palette.command.toggleTerminal',
    shortcut: APP_SHORTCUTS.toggleTerminal,
    keywords: 'shell console',
    run: (ctx) => ctx.toggleTerminal(),
  },
  {
    id: 'action:open-review',
    titleKey: 'palette.command.openReview',
    shortcut: APP_SHORTCUTS.openReview,
    keywords: 'diff changes git review stage',
    enabled: (ctx) => ctx.projectOpen,
    run: (ctx) => ctx.openReview(),
  },
  {
    id: 'action:search-files',
    titleKey: 'palette.command.searchFiles',
    shortcut: APP_SHORTCUTS.searchFiles,
    keywords: 'open file find',
    enabled: (ctx) => ctx.projectOpen,
    run: (ctx) => ctx.searchFiles(),
  },
  {
    id: 'action:toggle-file-tree',
    titleKey: 'palette.command.toggleFileTree',
    shortcut: APP_SHORTCUTS.toggleFileTree,
    keywords: 'files explorer tree',
    enabled: (ctx) => ctx.projectOpen,
    run: (ctx) => ctx.toggleFileTree(),
  },
  {
    id: 'action:cycle-layout',
    titleKey: 'palette.command.cycleLayout',
    shortcut: APP_SHORTCUTS.cycleLayout,
    keywords: 'layout split full view hide tabs',
    run: (ctx) => ctx.cycleLayout(),
  },
  {
    id: 'action:toggle-full-view',
    titleKey: 'palette.command.toggleFullView',
    shortcut: APP_SHORTCUTS.toggleFullView,
    keywords: 'maximize expand tabs',
    run: (ctx) => ctx.toggleFullView(),
  },
  {
    id: 'action:toggle-summary',
    titleKey: 'palette.command.toggleSummary',
    keywords: 'overview plan sources branch',
    run: (ctx) => ctx.toggleSummary(),
  },
  {
    id: 'action:stop-generation',
    titleKey: 'palette.command.stopGeneration',
    keywords: 'abort cancel',
    enabled: (ctx) => ctx.generating,
    run: (ctx) => ctx.stopGeneration(),
  },
]

export const NAVIGATION_COMMANDS: readonly AppCommand[] = [
  {
    id: 'nav:sessions',
    titleKey: 'palette.command.goSessions',
    shortcut: '1',
    keywords: 'chat conversations',
    run: (ctx) => ctx.setRail('sessions'),
  },
  {
    id: 'nav:settings',
    titleKey: 'palette.command.goSettings',
    shortcut: '2',
    keywords: 'preferences options',
    run: (ctx) => ctx.setRail('settings'),
  },
  {
    id: 'nav:integrations-mcp',
    titleKey: 'palette.command.openMcp',
    keywords: 'mcp servers json',
    run: (ctx) => ctx.openIntegrationsTab('mcp'),
  },
]

/** One command per settings section, reusing the section nav metadata. */
export function buildSettingsCommands(): readonly AppCommand[] {
  return SETTINGS_SECTIONS.map((meta) => ({
    id: `settings:${meta.id}`,
    titleKey: meta.labelKey,
    keywords: meta.searchTerms,
    run: (ctx) => ctx.openSettingsSection(meta.id),
  }))
}

/** Pre-projected session row for palette entries (title + project group). */
export interface SessionCommandEntry {
  item: SidebarConversationItem
  title: string
  groupLabel: string
}

export interface SessionCommand {
  id: string
  title: string
  subtitle: string
  run(): void
}

/** One jump-to-session command per catalog row. */
export function buildSessionCommands(
  sessions: readonly SessionCommandEntry[],
  ctx: CommandContext,
): readonly SessionCommand[] {
  return sessions.map((entry) => ({
    id: `session:${entry.item.summary.selectionToken}`,
    title: entry.title,
    subtitle: entry.groupLabel,
    run: () => ctx.selectSession(entry.item),
  }))
}
