import { TbLoader2 } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import type { PiDefaultPackage } from '@/shared/pi-integrations'

/** Defaults are global; reinstalling is always an explicit user action. */
export function DefaultPackages({ packages, busy, onInstall }: {
  packages: readonly PiDefaultPackage[]
  busy: boolean
  onInstall(source: string): void
}) {
  const t = useT()
  if (!packages.length) return null
  return (
    <section className="mac-box mb-5 min-w-0 px-4 py-3" aria-label={t('settings.integrations.defaults.title')}>
      <h3 className="text-app font-medium">{t('settings.integrations.defaults.title')}</h3>
      <p className="mt-1 text-caption text-muted-foreground">{t('settings.integrations.defaults.description')}</p>
      <ul className="mt-3 divide-y divide-border">
        {packages.map((pkg) => (
          <li key={pkg.packageName} className="flex min-w-0 items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="break-all text-caption font-medium">{pkg.packageName}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-micro text-muted-foreground">
                {pkg.status === 'installing' && <TbLoader2 className="size-3.5 motion-safe:animate-spin" aria-hidden />}
                {t(`settings.integrations.defaults.${pkg.status}`)}
              </p>
              {pkg.status === 'failed' && pkg.message && <p className="mt-1 break-words text-caption text-destructive" role="alert">{pkg.message}</p>}
            </div>
            {(['pending', 'failed', 'removed'] as const).some((status) => status === pkg.status) && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onInstall(pkg.source)}
                aria-label={`${t(pkg.status === 'failed' ? 'common.retry' : 'settings.integrations.install')} ${pkg.packageName}`}>
                {t(pkg.status === 'failed' ? 'common.retry' : 'settings.integrations.install')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
