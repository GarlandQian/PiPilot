import * as React from 'react'
import { TbArrowLeft, TbArrowRight, TbEdit, TbServer, TbTrash } from 'react-icons/tb'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { McpConfigServer } from '@/shared/mcp-config'
import { structuredSupported } from '../mcp-server-form-model'
import { SearchField, focusCatalogRow, handleCatalogKeyDown } from './CatalogPrimitives'
import { MarkdownContent } from '@/components/chat/markdown/MarkdownContent'

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function endpoint(server: McpConfigServer) {
  return stringValue(server.definition.command) || stringValue(server.definition.url) || stringValue(server.definition.socket)
}

function recordKeys(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : []
}

export function filterMcpServers(servers: readonly McpConfigServer[], query: string) {
  const search = query.trim().toLocaleLowerCase()
  if (!search) return servers
  return servers.filter((server) => [
    server.name,
    server.transport,
    endpoint(server),
    stringValue(server.definition.description),
  ].some((value) => value.toLocaleLowerCase().includes(search)))
}

export function McpServerBrowser({
  servers,
  disabled = false,
  onEdit,
  onRemove,
  onToggleEnabled,
  onOpenJson,
}: {
  servers: readonly McpConfigServer[]
  disabled?: boolean
  onEdit(server: McpConfigServer): void
  onRemove(name: string): void
  onToggleEnabled(server: McpConfigServer, enabled: boolean): void
  onOpenJson(): void
}) {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const [selectedName, setSelectedName] = React.useState<string | null>(null)
  const collectionRef = React.useRef<HTMLUListElement>(null)
  const filtered = React.useMemo(() => filterMcpServers(servers, query), [servers, query])
  const explicitSelection = filtered.find((server) => server.name === selectedName)
  const selected = explicitSelection ?? filtered[0]
  const selectedEditable = selected ? structuredSupported(selected) : false
  const args = selected && Array.isArray(selected.definition.args)
    ? selected.definition.args.filter((value): value is string => typeof value === 'string')
    : []
  const variables = selected ? recordKeys(selected.definition.env) : []
  const headers = selected ? recordKeys(selected.definition.headers) : []
  const detailsId = React.useId()

  return (
    <div className="min-w-0 space-y-4" data-mcp-server-browser>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 sm:max-w-80">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder={t('settings.integrations.mcp.searchPlaceholder')}
            label={t('settings.integrations.mcp.search')}
            onBrowse={() => focusCatalogRow(collectionRef.current)}
          />
        </div>
        <p className="text-caption text-muted-foreground" role="status">
          {t('settings.integrations.mcp.serverCount', { count: filtered.length, total: servers.length })}
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-lg bg-muted/30 p-5 text-center">
          <TbServer className="size-6 text-muted-foreground" aria-hidden />
          <p className="text-app font-medium">{t(query.trim() ? 'settings.integrations.mcp.noMatches' : 'settings.mcp.noServers')}</p>
          <p className="max-w-sm text-caption text-muted-foreground">
            {t(query.trim() ? 'settings.integrations.mcp.searchHint' : 'settings.integrations.mcp.emptyHint')}
          </p>
        </div>
      ) : (
        <div className="grid min-w-0 gap-5 @min-[800px]/mcp:grid-cols-[minmax(260px,0.9fr)_minmax(0,1.1fr)]">
          <ul
            ref={collectionRef}
            className={cn('scroll-slim max-h-[28rem] min-w-0 space-y-1 overflow-y-auto', explicitSelection && 'hidden @min-[800px]/mcp:block')}
            aria-label={t('settings.mcp.servers')}
            onKeyDown={handleCatalogKeyDown}
          >
            {filtered.map((server) => {
              const enabled = server.definition.disabled !== true
              const editable = structuredSupported(server)
              const active = server.name === selected?.name
              return (
                <li
                  key={server.name}
                  data-mcp-server={server.name}
                  className={cn('flex min-w-0 items-center gap-1 rounded-lg px-2 py-1.5', active ? 'bg-muted' : 'hover:bg-muted/45')}
                >
                  <button
                    type="button"
                    data-integration-row={server.name}
                    aria-label={t('settings.integrations.mcp.serverDetails', { name: server.name })}
                    aria-pressed={active}
                    aria-controls={detailsId}
                    onClick={() => setSelectedName(server.name)}
                    className="min-w-0 flex-1 rounded-md px-1 py-1.5 text-left outline-none focus-visible:focus-ring"
                  >
                    <span className="block truncate text-app font-medium">{server.name}</span>
                    <span className="mt-0.5 block truncate text-micro text-muted-foreground" title={endpoint(server)}>
                      {t(`settings.mcp.transport.${server.transport}`)}{endpoint(server) ? ` · ${endpoint(server)}` : ''}
                    </span>
                  </button>
                  <Switch
                    checked={enabled}
                    disabled={disabled}
                    aria-label={`${server.name}: ${enabled ? t('settings.mcp.enabled') : t('settings.mcp.disabled')}`}
                    onCheckedChange={(checked) => onToggleEnabled(server, checked)}
                    className="mx-1 shrink-0"
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex shrink-0">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={disabled || !editable}
                          aria-label={`${t('settings.mcp.editServer')} ${server.name}`}
                          onClick={() => onEdit(server)}
                        >
                          <TbEdit aria-hidden />
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{t(editable ? 'settings.mcp.editServer' : 'settings.mcp.unsupportedStructured')}</TooltipContent>
                  </Tooltip>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    aria-label={`${t('settings.mcp.removeServer')} ${server.name}`}
                    onClick={() => onRemove(server.name)}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <TbTrash aria-hidden />
                  </Button>
                </li>
              )
            })}
          </ul>

          {selected && (
            <section id={detailsId} data-mcp-server-detail={selected.name} className={cn('min-w-0 rounded-lg border border-border/70 p-4', !explicitSelection && 'hidden @min-[800px]/mcp:block')} aria-label={t('settings.integrations.mcp.serverDetails', { name: selected.name })}>
              <div className="flex min-w-0 items-start gap-3">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="@min-[800px]/mcp:hidden"
                  aria-label={t('common.back')}
                  title={t('common.back')}
                  onClick={() => {
                    setSelectedName(null)
                    requestAnimationFrame(() => focusCatalogRow(collectionRef.current, selected.name))
                  }}
                ><TbArrowLeft aria-hidden /></Button>
                <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted"><TbServer className="size-4.5 text-muted-foreground" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <h4 className="break-words text-app font-semibold">{selected.name}</h4>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge variant="secondary">{t(`settings.mcp.transport.${selected.transport}`)}</Badge>
                    <Badge variant={selected.definition.disabled === true ? 'outline' : 'soft-success'}>{t(selected.definition.disabled === true ? 'settings.mcp.disabled' : 'settings.mcp.enabled')}</Badge>
                  </div>
                </div>
              </div>
              {stringValue(selected.definition.description) ? <div className="mt-3 break-words text-caption text-muted-foreground"><MarkdownContent markdown={stringValue(selected.definition.description)} /></div> : null}
              <dl className="mt-4 space-y-4 text-caption">
                <div>
                  <dt className="mb-1 text-muted-foreground">{t(selected.transport === 'stdio' ? 'mcp.form.command' : selected.transport === 'http' ? 'mcp.form.url' : 'settings.integrations.mcp.endpoint')}</dt>
                  <dd className="break-all rounded-md bg-muted/55 px-2.5 py-2 font-mono text-micro">{endpoint(selected) || t('settings.integrations.unknown')}</dd>
                </div>
                {args.length > 0 ? <div><dt className="mb-1 text-muted-foreground">{t('mcp.form.args')}</dt><dd className="flex flex-wrap gap-1.5">{args.map((arg, index) => <code key={index} className="max-w-full break-all rounded bg-muted/55 px-1.5 py-0.5 text-micro">{arg}</code>)}</dd></div> : null}
                {stringValue(selected.definition.cwd) ? <div><dt className="mb-1 text-muted-foreground">{t('mcp.form.cwd')}</dt><dd className="break-all font-mono text-micro">{stringValue(selected.definition.cwd)}</dd></div> : null}
                {variables.length > 0 ? <div><dt className="mb-1 text-muted-foreground">{t('mcp.form.env')}</dt><dd className="break-words font-mono text-micro">{variables.join(', ')}</dd></div> : null}
                {headers.length > 0 ? <div><dt className="mb-1 text-muted-foreground">{t('mcp.form.headers')}</dt><dd className="break-words font-mono text-micro">{headers.join(', ')}</dd></div> : null}
              </dl>
              {!selectedEditable ? <p className="mt-4 text-caption text-muted-foreground">{t('settings.mcp.unsupportedStructured')}</p> : null}
              <div className="mt-5 flex flex-wrap gap-2 border-t border-border/60 pt-3">
                {selectedEditable && <Button variant="outline" size="sm" disabled={disabled} onClick={() => onEdit(selected)}><TbEdit aria-hidden />{t('settings.integrations.mcp.editConfiguration')}</Button>}
                <Button variant="ghost" size="sm" onClick={onOpenJson}>{t('settings.integrations.mcp.openJson')}<TbArrowRight aria-hidden /></Button>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
