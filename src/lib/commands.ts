import type { RailDestination } from '@/components/frame/ActivityRail'
import type { SidebarConversationItem } from '@/components/layout/SessionList'
import {
  SETTINGS_SECTIONS,
  type IntegrationsTabId,
  type SettingsSectionId,
} from '@/components/settings/SettingsLayout'
import type { MessageKey } from '@/i18n'

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
}

export interface AppCommand {
  id: string
  titleKey: MessageKey
  hintKey?: MessageKey
  shortcut?: string
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
    shortcut: 'J',
    keywords: 'panel files terminal diff',
    run: (ctx) => ctx.toggleInspector(),
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
