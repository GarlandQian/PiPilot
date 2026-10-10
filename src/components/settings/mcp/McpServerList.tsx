import * as React from 'react'
import { TbCopy, TbDots, TbEdit, TbExternalLink, TbSearch, TbTrash } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useLocale, useT, type MessageKey } from '@/i18n'
import type { McpConfigServer } from '@/shared/mcp-config'
import { templateForServer } from '@/shared/mcp-templates'
import { localizedText } from '@/shared/model-provider-presets'
import { McpServerIcon } from './McpServerEditor'
import { transportOf } from './mcp-editor-model'
import { SettingsBadge, SettingsGroup, SettingsListRow } from '../kit'

const text = (value: unknown) => typeof value === 'string' ? value : ''

/** "npx -y @playwright/mcp@latest" or the address. */
export function serverEndpoint(server: McpConfigServer) {
  const definition = server.definition
  if (typeof definition.command === 'string') {
    return [definition.command, ...(Array.isArray(definition.args) ? definition.args.filter((arg): arg is string => typeof arg === 'string') : [])].join(' ')
  }
  return text(definition.url) || text(definition.socket)
}

export function filterServers(servers: readonly McpConfigServer[], query: string) {
  const words = query.trim().toLowerCase().split(/\s+/u).filter(Boolean)
  return words.length ? servers.filter((server) => {
    const haystack = [server.name, serverEndpoint(server), text(server.definition.description)].join('\n').toLowerCase()
    return words.every((word) => haystack.includes(word))
  }) : servers
}

export interface McpListEntry {
  server: McpConfigServer
  scope: 'global' | 'project'
  /** A global server the project's entry of the same name replaces. */
  overridden: boolean
  /** Its file cannot be written now (invalid, loading, an extension owns MCP). */
  locked: boolean
}

export const mcpEntryKey = (entry: Pick<McpListEntry, 'scope' | 'server'>) => `${entry.scope}:${entry.server.name}`

/** Every server from the global and the project mcp.json, in one list. */
export function McpServerList({ entries, title, headerActions, empty, busyKey, recent, onEdit, onToggle, onCopy, onRemove }: {
  entries: readonly McpListEntry[]
  title: string
  headerActions: React.ReactNode
  empty: React.ReactNode
  /** The server whose switch is saving. */
  busyKey: string | null
  recent: string | null
  onEdit(entry: McpListEntry): void
  onToggle(entry: McpListEntry, enabled: boolean): void
  onCopy(entry: McpListEntry): void
  onRemove(entry: McpListEntry): void
}) {
  const t = useT()
  const locale = useLocale()
  const [query, setQuery] = React.useState('')
  const visible = query.trim() ? entries.filter((entry) => filterServers([entry.server], query).length > 0) : entries

  return <SettingsGroup title={title} boxRole={visible.length ? 'list' : undefined} data-mcp-server-list
    actions={<>
      {entries.length > 5 ? <div className="relative w-44">
        <TbSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('settings.integrations.mcp.searchPlaceholder')} aria-label={t('settings.integrations.mcp.search')}
          className="h-6 rounded-full bg-fill pl-7.5 text-caption shadow-none" />
      </div> : null}
      {headerActions}
    </>}>
    {entries.length === 0 ? empty : visible.length === 0 ? <div data-settings-row className="px-3 py-8 text-center text-caption text-muted-foreground">{t('settings.integrations.mcp.noMatches')}</div>
      : visible.map((entry) => {
        const { server } = entry
        const key = mcpEntryKey(entry)
        const override = server.transport === 'override'
        const transport = override ? 'override' : transportOf(server.definition)
        const enabled = server.definition.enabled !== false
        const template = templateForServer(server.definition)
        const invalid = server.transport === 'invalid' || server.transport === 'socket'
        return <SettingsListRow key={key} data-mcp-server={server.name} data-mcp-scope={entry.scope} recent={recent === key}
          icon={<McpServerIcon transport={transport} />} title={<span className="font-mono">{server.name}</span>} dimmed={entry.overridden || !enabled}
          badges={<>
            {entry.scope === 'project' ? <SettingsBadge tone="accent">{t('settings.packages.project')}</SettingsBadge> : null}
            {!enabled && !entry.overridden ? <SettingsBadge>{t('settings.mcp.disabled')}</SettingsBadge> : null}
            {invalid ? <SettingsBadge tone="warning">{t('settings.mcp.page.needsFix')}</SettingsBadge> : null}
          </>}
          subtitle={entry.overridden ? t('settings.mcp.page.overriddenByProject')
            : override ? t('settings.mcp.page.overrideDescription')
              : <>{t(`settings.mcp.page.transport.${transport}` as MessageKey)} · <span className="font-mono">{serverEndpoint(server) || '—'}</span></>}
          onOpen={() => onEdit(entry)} openLabel={t('settings.mcp.page.edit', { name: server.name })} disabled={entry.locked}
          accessory={override && server.definition.enabled === undefined ? <span className="text-micro text-muted-foreground" title={t('settings.mcp.page.overrideEnabledInherited')}>{t('settings.mcp.page.inherited')}</span>
            : <Switch checked={enabled} disabled={entry.locked || busyKey !== null || invalid || entry.overridden} aria-label={t('settings.mcp.page.toggle', { name: server.name })}
              onCheckedChange={(checked) => onToggle(entry, checked)} />}
          menu={<DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" className="text-muted-foreground" disabled={entry.locked} aria-label={t('settings.mcp.page.actions', { name: server.name })}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onEdit(entry)}><TbEdit aria-hidden />{t('settings.mcp.editServer')}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onCopy(entry)}><TbCopy aria-hidden />{t('settings.mcp.page.copyJson')}</DropdownMenuItem>
              {template ? <DropdownMenuItem onSelect={() => window.open(template.docs, '_blank', 'noopener')}><TbExternalLink aria-hidden />{t('settings.mcp.page.openDocs', { name: localizedText(template.title, locale) })}</DropdownMenuItem> : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => onRemove(entry)}><TbTrash aria-hidden />{t(override ? 'settings.mcp.page.removeOverride' : 'settings.mcp.removeServer')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>} />
      })}
  </SettingsGroup>
}

export function McpServersEmpty({ onAdd, onImport, disabled }: { onAdd(): void; onImport(): void; disabled: boolean }) {
  const t = useT()
  return <div data-settings-row data-mcp-empty className="flex flex-col items-center gap-1.5 px-4 py-8 text-center">
    <p className="text-app font-medium">{t('settings.mcp.noServers')}</p>
    <p className="max-w-sm text-caption leading-relaxed text-muted-foreground">{t('settings.mcp.page.emptyDescription')}</p>
    <div className="mt-1.5 flex flex-wrap justify-center gap-2">
      <Button variant="outline" size="sm" disabled={disabled} onClick={onAdd}>{t('settings.mcp.page.add')}</Button>
      <Button variant="ghost" size="sm" disabled={disabled} onClick={onImport}>{t('settings.mcp.page.import')}</Button>
    </div>
  </div>
}
