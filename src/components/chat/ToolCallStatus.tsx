import {
  TbAlertTriangle,
  TbCheck,
  TbClock,
  TbX,
} from 'react-icons/tb'
import { useT, type MessageKey } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ToolCall } from '@/types/chat'

export const toolStatusLabelKey = {
  queued: 'tool.status.queued',
  running: 'tool.status.running',
  detached: 'tool.status.detached',
  success: 'tool.status.success',
  failed: 'tool.status.failed',
  cancelled: 'tool.status.cancelled',
} as const satisfies Record<ToolCall['status'], MessageKey>

export const toolStatusIcon = {
  queued: TbClock,
  running: TbClock,
  detached: TbClock,
  success: TbCheck,
  failed: TbAlertTriangle,
  cancelled: TbX,
} as const

export function ToolCallStatus({
  status,
  live = false,
}: {
  status: ToolCall['status']
  live?: boolean
}) {
  const t = useT()
  const StatusIcon = toolStatusIcon[status]
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1 text-micro text-muted-foreground',
        status === 'failed' && 'text-destructive',
        status === 'success' && 'text-sage',
      )}
      role={live ? 'status' : undefined}
      aria-live={live ? 'polite' : undefined}
    >
      <StatusIcon
        className={cn(
          'size-3.5',
          status === 'running' && 'animate-pulse motion-reduce:animate-none',
        )}
        aria-hidden
      />
      {t(toolStatusLabelKey[status])}
    </span>
  )
}
