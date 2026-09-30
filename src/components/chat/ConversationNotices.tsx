import { TbX } from 'react-icons/tb'
import { usePiExtensionUi, usePiRpcActions } from '@/store/pi-rpc'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { MarkdownContent } from './markdown/MarkdownContent'

/** Plugin command feedback without a reply owner remains local to this conversation. */
export function ConversationNotices() {
  const t = useT()
  const { notifications } = usePiExtensionUi()
  const { dismissNotification } = usePiRpcActions()
  if (!notifications.length) return null
  return <div data-conversation-notices className="scroll-slim mx-auto max-h-32 w-full max-w-(--conversation-width) shrink-0 space-y-1.5 overflow-y-auto px-6 py-1.5">
    {notifications.map((notice) => <div key={notice.id} className={cn('glass flex min-w-0 items-start gap-2 rounded-[14px] py-1.5 pr-1.5 pl-3.5', notice.type === 'error' && 'bg-destructive/10')}>
      <div role={notice.type === 'error' ? 'alert' : 'status'} className={cn('min-w-0 flex-1 break-words text-caption [&_.md-body]:text-caption', notice.type === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
        <MarkdownContent markdown={notice.message} />
      </div>
      <Button variant="ghost" size="icon-xs" aria-label={t('notifications.localDismiss')} onClick={() => dismissNotification(notice.id)}><TbX aria-hidden /></Button>
    </div>)}
  </div>
}
