import { TbAlertCircle, TbCheck, TbClock } from 'react-icons/tb'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ConfigApplyStatus } from '@/shared/config-apply'

export function ConfigApplyNotice({
  status,
  readFailed,
}: {
  status?: ConfigApplyStatus
  readFailed: boolean
}) {
  const t = useT()
  if (!status) return null
  const failed = readFailed || status.state === 'failed' || status.state === 'superseded'
  const Icon = failed ? TbAlertCircle : status.state === 'applied' ? TbCheck : TbClock
  return (
    <p
      className={cn('flex items-start gap-2 py-2 text-caption', failed ? 'text-destructive' : 'text-muted-foreground')}
      role={failed ? 'alert' : 'status'}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {readFailed
          ? t('settings.configApply.readFailed')
          : status.state === 'failed' && status.reason === 'interaction-required'
            ? t('settings.configApply.interactionRequired')
            : t(`settings.configApply.${status.state}`)}
        {status.total > 0 ? ` ${t('settings.configApply.progress', { count: status.applied, total: status.total })}` : ''}
      </span>
    </p>
  )
}
