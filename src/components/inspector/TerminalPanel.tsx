import { useT } from '@/i18n'

export function TerminalLoadingFallback() {
  const t = useT()
  return (
    <div className="grid h-full place-items-center p-4 text-caption text-muted-foreground">
      {t('inspector.terminal.starting')}
    </div>
  )
}
