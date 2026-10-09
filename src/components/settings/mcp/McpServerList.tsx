import * as React from 'react'
import { TbChevronRight, TbCopy, TbDots, TbEdit, TbExternalLink, TbSearch, TbServer, TbTrash, TbX } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useLocale, useT, type MessageKey } from '@/i18n'
import { cn } from '@/lib/utils'
import type { McpConfigServer } from '@/shared/mcp-config'
import { templateForServer } from '@/shared/mcp-templates'
import { localizedText } from '@/shared/model-provider-presets'
import { McpServerIcon } from './McpServerEditor'
import { transportOf } from './mcp-editor-model'

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

export function McpServerList({ servers, disabled, busyName, recent, onEdit, onToggle, onCopy, onRemove }: {
  servers: readonly McpConfigServer[]
  disabled: boolean
  /** Saving this server's switch. */
  busyName: string | null
  recent: string | null
  onEdit(server: McpConfigServer): void
  onToggle(server: McpConfigServer, enabled: boolean): void
  onCopy(server: McpConfigServer): void
  onRemove(server: McpConfigServer): void
}) {
  const t = useT()
  const locale = useLocale()
  const [query, setQuery] = React.useState('')
  const searchRef = React.useRef<HTMLInputElement>(null)
  const visible = filterServers(servers, query)
  const clear = () => { setQuery(''); searchRef.current?.focus() }

  return <div className="min-w-0 space-y-2" data-mcp-server-list>
    {servers.length > 5 ? <div className="flex min-w-0 flex-wrap items-center gap-2 px-1">
      <div className="relative min-w-48 max-w-80 flex-1">
        <TbSearch className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Escape' && query) { event.preventDefault(); clear() } }}
          placeholder={t('settings.integrations.mcp.searchPlaceholder')} aria-label={t('settings.integrations.mcp.search')}
          className="h-7 rounded-full bg-fill pl-7.5 pr-8 shadow-none focus-visible:bg-control" />
        {query ? <Button variant="ghost" size="icon-xs" className="absolute right-1 top-1/2 -translate-y-1/2" aria-label={t('settings.models.workspace.clearSearch')} onClick={clear}><TbX aria-hidden /></Button> : null}
      </div>
      <p className="ml-auto text-caption text-muted-foreground" role="status">{t('settings.integrations.mcp.serverCount', { count: visible.length, total: servers.length })}</p>
    </div> : null}
    {visible.length === 0 ? <div className="mac-group"><p className="py-10 text-center text-caption text-muted-foreground">{t('settings.integrations.mcp.noMatches')}</p></div>
      : <div className="mac-group min-w-0" role="list">
        {visible.map((server) => {
          const transport = transportOf(server.definition)
          const enabled = server.definition.enabled !== false
          const template = templateForServer(server.definition)
          const invalid = server.transport === 'invalid' || server.transport === 'socket'
          return <article key={server.name} role="listitem" data-mcp-server={server.name} data-model-recent={recent === server.name || undefined}
            className={cn('min-w-0 py-2 transition-colors duration-700 first:rounded-t-[inherit] last:rounded-b-[inherit] motion-reduce:transition-none', recent === server.name && 'bg-primary/8')}>
            <div className="flex min-w-0 items-center gap-2">
              <button type="button" className={cn('flex min-w-0 flex-1 items-center gap-3 rounded-md py-0.5 text-left outline-none focus-visible:focus-ring disabled:opacity-60', !enabled && 'opacity-60')}
                disabled={disabled} aria-label={t('settings.mcp.page.edit', { name: server.name })} onClick={() => onEdit(server)}>
                <McpServerIcon transport={transport} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-mono text-app font-medium text-foreground">{server.name}</span>
                    {!enabled ? <span className="shrink-0 rounded-full bg-fill-strong px-1.5 text-micro text-muted-foreground">{t('settings.mcp.disabled')}</span> : null}
                    {invalid ? <span className="shrink-0 rounded-full bg-destructive/12 px-1.5 text-micro text-destructive">{t('settings.mcp.page.needsFix')}</span> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-caption text-muted-foreground" title={serverEndpoint(server)}>
                    {t(`settings.mcp.page.transport.${transport}` as MessageKey)} · <span className="font-mono">{serverEndpoint(server) || '—'}</span>
                  </span>
                </span>
              </button>
              <Switch checked={enabled} disabled={disabled || busyName !== null || invalid} aria-label={t('settings.mcp.page.toggle', { name: server.name })}
                onCheckedChange={(checked) => onToggle(server, checked)} />
              <DropdownMenu>
                <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground" disabled={disabled} aria-label={t('settings.mcp.page.actions', { name: server.name })}><TbDots aria-hidden /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onEdit(server)}><TbEdit aria-hidden />{t('settings.mcp.editServer')}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onCopy(server)}><TbCopy aria-hidden />{t('settings.mcp.page.copyJson')}</DropdownMenuItem>
                  {template ? <DropdownMenuItem onSelect={() => window.open(template.docs, '_blank', 'noopener')}><TbExternalLink aria-hidden />{t('settings.mcp.page.openDocs', { name: localizedText(template.title, locale) })}</DropdownMenuItem> : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => onRemove(server)}><TbTrash aria-hidden />{t('settings.mcp.removeServer')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="icon-xs" className="-mr-1 shrink-0 text-muted-foreground" tabIndex={-1} aria-hidden disabled={disabled} onClick={() => onEdit(server)}><TbChevronRight aria-hidden /></Button>
            </div>
          </article>
        })}
      </div>}
  </div>
}

export function McpServersEmpty({ onAdd, onImport, disabled }: { onAdd(): void; onImport(): void; disabled: boolean }) {
  const t = useT()
  return <div className="mac-group min-w-0" data-mcp-empty>
    <div className="flex min-h-48 flex-col items-center justify-center gap-1.5 px-4 py-8 text-center">
      <TbServer className="mb-1 size-8 text-muted-foreground/60" aria-hidden />
      <h3 className="text-app font-semibold">{t('settings.mcp.noServers')}</h3>
      <p className="max-w-sm text-caption leading-relaxed text-muted-foreground">{t('settings.mcp.page.emptyDescription')}</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Button variant="outline" size="sm" disabled={disabled} onClick={onAdd}>{t('settings.mcp.page.add')}</Button>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={onImport}>{t('settings.mcp.page.import')}</Button>
      </div>
    </div>
  </div>
}
