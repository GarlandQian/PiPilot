import * as React from 'react'
import { TbAlertTriangle, TbInfoCircle, TbX } from 'react-icons/tb'
import { usePiExtensionUi, usePiRpcActions } from '@/store/pi-rpc'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { MarkdownContent } from './markdown/MarkdownContent'

/**
 * Plugin command feedback without a reply owner remains local to this
 * conversation. It is a row of the composer tray: the newest notice shows, and
 * older ones wait behind a count instead of stacking up above the input.
 */
export function ConversationNotices() {
  const t = useT()
  const { notifications } = usePiExtensionUi()
  const { dismissNotification } = usePiRpcActions()
  const [expanded, setExpanded] = React.useState(false)
  React.useEffect(() => { if (notifications.length < 2) setExpanded(false) }, [notifications.length])
  if (!notifications.length) return null
  const newestFirst = [...notifications].reverse()
  const visible = expanded ? newestFirst : newestFirst.slice(0, 1)
  const older = newestFirst.length - 1
  return <div data-conversation-notices className="min-w-0">
    <ul className={cn('min-w-0 divide-y divide-border', expanded && 'scroll-slim max-h-40 overflow-y-auto')}>
      {visible.map((notice, index) => {
        const Icon = notice.type === 'error' ? TbAlertTriangle : TbInfoCircle
        return <li key={notice.id} className="flex min-h-11 min-w-0 items-start gap-2 py-1.5 pr-3 pl-4">
          <Icon className={cn('mt-[7px] size-3.5 shrink-0', notice.type === 'error' ? 'text-destructive' : 'text-muted-foreground')} aria-hidden />
          <div role={notice.type === 'error' ? 'alert' : 'status'} className={cn('min-w-0 flex-1 break-words py-1 text-caption [&_.md-body]:text-caption', notice.type === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
            <MarkdownContent markdown={notice.message} />
          </div>
          {index === 0 && older > 0 ? <button
            type="button"
            aria-expanded={expanded}
            aria-label={t(expanded ? 'composer.notices.collapse' : 'composer.notices.showAll', { count: newestFirst.length })}
            title={t(expanded ? 'composer.notices.collapse' : 'composer.notices.showAll', { count: newestFirst.length })}
            onClick={() => setExpanded((value) => !value)}
            className="mt-[3px] h-[22px] shrink-0 rounded-full bg-fill-strong px-2 text-micro font-medium tabular-nums text-muted-foreground outline-none transition-colors duration-(--duration-fast) hover:text-foreground focus-visible:focus-ring motion-reduce:transition-none"
          >
            {expanded ? '−' : `+${older}`}
          </button> : null}
          <Button variant="ghost" size="icon-xs" className="mt-px rounded-full" aria-label={t('notifications.localDismiss')} onClick={() => dismissNotification(notice.id)}><TbX aria-hidden /></Button>
        </li>
      })}
    </ul>
  </div>
}
