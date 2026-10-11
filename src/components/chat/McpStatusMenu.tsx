import * as React from 'react'
import { TbChevronDown, TbLoader2, TbPlugConnected, TbRefresh, TbSettings } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useT, type MessageKey } from '@/i18n'
import { cn } from '@/lib/utils'
import type { LocalPiMcpServerStatus } from '@/shared/local-pi'
import { refreshMcpStatus, useMcpStatus } from '@/store/mcp-status'

const LIVE = new Set<LocalPiMcpServerStatus['state']>(['connected'])
const PROBLEM = new Set<LocalPiMcpServerStatus['state']>(['failed', 'needs-auth', 'disconnected'])

export function mcpStateTone(state: LocalPiMcpServerStatus['state']) {
  return LIVE.has(state) ? 'bg-success' : PROBLEM.has(state) ? (state === 'needs-auth' ? 'bg-warning' : 'bg-destructive') : 'bg-muted-foreground/50'
}

export function mcpStateText(t: ReturnType<typeof useT>, server: LocalPiMcpServerStatus) {
  if (server.state === 'connected') return t('mcpStatus.connectedTools', { count: server.tools ?? 0 })
  return t(`mcpStatus.state.${server.state}` as MessageKey)
}

function ServerRow({ server, busy, onAction }: { server: LocalPiMcpServerStatus; busy: boolean; onAction(command: string): void }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const detail = server.error ?? server.stderr
  const canReconnect = server.enabled && server.state !== 'connecting' && server.state !== 'starting'
  return <li data-mcp-status-server={server.name} data-mcp-state={server.state} className="py-2">
    <div className="flex min-w-0 items-center gap-2">
      <span className={cn('size-2 shrink-0 rounded-full', mcpStateTone(server.state))} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-app font-medium">{server.name}</span>
        <span className="block truncate text-caption text-muted-foreground">
          {mcpStateText(t, server)}{server.scope === 'project' ? ` · ${t('mcpStatus.project')}` : server.scope === 'extension' ? ` · ${t('mcpStatus.extension')}` : ''}
        </span>
      </span>
      {server.state === 'connecting' || server.state === 'starting' ? <TbLoader2 className="size-3.5 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden /> : null}
      {server.oauth && server.state === 'needs-auth' ? <Button size="sm" disabled={busy} onClick={() => onAction(`/mcp login ${server.name}`)}>{t('mcpStatus.signIn')}</Button>
        : canReconnect && server.state !== 'connected' ? <Button variant="outline" size="sm" disabled={busy} onClick={() => onAction(`/mcp reconnect ${server.name}`)}>{t('mcpStatus.reconnect')}</Button> : null}
    </div>
    {detail ? <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="mt-1 ml-4 flex items-center gap-1 text-micro text-muted-foreground outline-none hover:text-foreground focus-visible:focus-ring">
        <TbChevronDown className={cn('size-3 transition-transform motion-reduce:transition-none', !open && '-rotate-90')} aria-hidden />
        {t(server.error ? 'mcpStatus.showError' : 'mcpStatus.showOutput')}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="scroll-slim mt-1 ml-4 max-h-32 overflow-auto rounded-[8px] bg-fill px-2 py-1.5 font-mono text-micro whitespace-pre-wrap break-words">{detail}{server.error && server.stderr && !server.error.includes(server.stderr) ? `\n\n${server.stderr}` : ''}</pre>
      </CollapsibleContent>
    </Collapsible> : null}
    {server.oauth && server.state === 'connected' ? <div className="mt-0.5 ml-4">
      <button type="button" disabled={busy} className="text-micro text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-50" onClick={() => onAction(`/mcp logout ${server.name}`)}>{t('mcpStatus.signOut')}</button>
    </div> : null}
  </li>
}

/**
 * "MCP 3/4": which of this conversation's MCP servers are connected. Each
 * conversation connects on its own, so the status belongs to the header.
 */
export function McpStatusMenu({ sessionKey, streaming, onSend, onOpenSettings }: {
  sessionKey: string | null
  streaming: boolean
  onSend(command: string): Promise<void>
  onOpenSettings(): void
}) {
  const t = useT()
  const { snapshot } = useMcpStatus(sessionKey)
  const [busy, setBusy] = React.useState(false)
  const servers = snapshot?.servers ?? []
  if (!servers.length) return null
  const enabled = servers.filter((server) => server.enabled)
  const connected = enabled.filter((server) => server.state === 'connected').length
  const problem = enabled.some((server) => PROBLEM.has(server.state))
  const settling = enabled.some((server) => server.state === 'connecting' || server.state === 'starting')
  const run = (command: string) => {
    setBusy(true)
    void onSend(command).catch(() => undefined).finally(() => { setBusy(false); void refreshMcpStatus() })
  }
  return <Popover onOpenChange={(open) => { if (open) void refreshMcpStatus() }}>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="sm" data-mcp-status-trigger={problem ? 'problem' : settling ? 'connecting' : 'ok'}
        aria-label={t('mcpStatus.label', { connected, total: enabled.length })} title={t('mcpStatus.label', { connected, total: enabled.length })}
        className="h-7 gap-1 rounded-full px-2 text-caption tabular-nums">
        <TbPlugConnected className={cn('size-4', problem ? 'text-destructive' : 'text-muted-foreground')} aria-hidden />
        <span>{connected}/{enabled.length}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-80 p-0" data-mcp-status-panel>
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3.5 py-2.5">
        <span className="text-app font-semibold">{t('mcpStatus.title')}</span>
        <span className="flex items-center gap-1">
          <Button variant="ghost" size="icon-xs" aria-label={t('mcpStatus.refresh')} title={t('mcpStatus.refresh')} onClick={() => void refreshMcpStatus()}><TbRefresh aria-hidden /></Button>
          <Button variant="ghost" size="icon-xs" aria-label={t('mcpStatus.settings')} title={t('mcpStatus.settings')} onClick={onOpenSettings}><TbSettings aria-hidden /></Button>
        </span>
      </div>
      <ul className="scroll-slim max-h-[min(420px,60vh)] divide-y divide-border/60 overflow-y-auto px-3.5">
        {servers.map((server) => <ServerRow key={`${server.scope}:${server.name}`} server={server} busy={busy || streaming} onAction={run} />)}
      </ul>
      {snapshot?.errors.length ? <p role="alert" className="border-t border-border/60 px-3.5 py-2 text-caption text-destructive">{snapshot.errors[0]}</p> : null}
      {streaming ? <p className="border-t border-border/60 px-3.5 py-2 text-caption text-muted-foreground">{t('mcpStatus.busy')}</p> : null}
    </PopoverContent>
  </Popover>
}
