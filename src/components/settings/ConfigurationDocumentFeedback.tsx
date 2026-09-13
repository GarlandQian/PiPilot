import { TbRefresh } from 'react-icons/tb'
import { useT } from '@/i18n'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export function ConfigurationDocumentUnavailable({ retry, capacity }: { retry(): void; capacity: boolean }) {
  const t = useT()
  return (
    <div className="flex items-start gap-3 px-6 py-6" role="alert">
      <p className="min-w-0 flex-1 text-caption text-muted-foreground">{t(capacity ? 'settings.document.capacity' : 'settings.document.unavailable')}</p>
      <Button variant="outline" size="sm" onClick={retry}><TbRefresh aria-hidden />{t('common.retry')}</Button>
    </div>
  )
}

export function ConfigurationReloadConfirmation({
  open, onOpenChange, onReload,
}: { open: boolean; onOpenChange(open: boolean): void; onReload(): void }) {
  const t = useT()
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('settings.document.discardTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('settings.document.discardDescription')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={onReload}>{t('settings.document.discardReload')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function ConfigurationDocumentError({ error }: {
  error: { code: string; message: string } | null
}) {
  const t = useT()
  if (!error) return null
  const message = error.code === 'CONFIG_DOCUMENT_TOO_LARGE'
    ? t('settings.document.tooLarge')
    : error.code.includes('CONFLICT')
      ? t('settings.document.conflict')
      : error.message || t(error.code === 'CONFIG_DOCUMENT_LOAD_FAILED'
          ? 'settings.document.loadFailed' : 'settings.document.saveFailed')
  return <p className="py-2 text-caption text-destructive" role="alert">{message}</p>
}
