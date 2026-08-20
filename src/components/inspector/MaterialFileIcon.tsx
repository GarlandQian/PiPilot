import { cn } from '@/lib/utils'
import {
  materialIconAssetName,
  resolveMaterialFileIconNames,
  type MaterialFileIconRequest,
} from '@/lib/material-file-icon-resolver'

const materialIconAssets = Object.fromEntries(
  Object.entries(import.meta.glob<string>(
    '/node_modules/material-icon-theme/icons/*.svg',
    {
      eager: true,
      import: 'default',
      query: '?url&no-inline',
    },
  )).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]),
) as Readonly<Record<string, string>>

function iconUrl(iconName: string, fallbackIconName: string) {
  const assetName = materialIconAssetName(iconName)
  const fallbackAssetName = materialIconAssetName(fallbackIconName)
  return (assetName ? materialIconAssets[assetName] : undefined)
    ?? (fallbackAssetName ? materialIconAssets[fallbackAssetName] : undefined)
}

interface MaterialFileIconProps extends MaterialFileIconRequest {
  className?: string
}

export function MaterialFileIcon({
  name,
  path,
  type,
  open,
  className,
}: MaterialFileIconProps) {
  const icons = resolveMaterialFileIconNames({ name, path, type, open })
  const fallback = type === 'dir'
    ? open ? 'folder-open' : 'folder'
    : 'file'
  const darkUrl = iconUrl(icons.dark, fallback)
  const lightUrl = iconUrl(icons.light, fallback)

  if (!darkUrl && !lightUrl) return <span className={cn('size-3.5 shrink-0', className)} aria-hidden />

  const sharedUrl = darkUrl === lightUrl ? darkUrl : undefined
  return (
    <span
      className={cn('grid size-3.5 shrink-0 place-items-center', className)}
      aria-hidden
    >
      {sharedUrl ? (
        <img className="col-start-1 row-start-1 size-full object-contain" src={sharedUrl} alt="" draggable={false} />
      ) : (
        <>
          <img
            className="col-start-1 row-start-1 size-full object-contain dark:hidden"
            src={lightUrl ?? darkUrl}
            alt=""
            draggable={false}
          />
          <img
            className="col-start-1 row-start-1 hidden size-full object-contain dark:block"
            src={darkUrl ?? lightUrl}
            alt=""
            draggable={false}
          />
        </>
      )}
    </span>
  )
}
