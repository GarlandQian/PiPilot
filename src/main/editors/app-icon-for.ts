import { app } from 'electron'
import { macAppIcon } from './app-icons'

const icons = new Map<string, Promise<string | undefined>>()

/** An app's own icon (bundle or executable) as a small PNG data URL, cached per path. */
export function appIconFor(path: string) {
  let icon = icons.get(path)
  if (!icon) {
    icon = (async () => {
      if (process.platform === 'darwin') return macAppIcon(path)
      const image = await app.getFileIcon(path, { size: 'normal' })
      return image.isEmpty() ? undefined : image.toDataURL()
    })().catch(() => undefined)
    icons.set(path, icon)
  }
  return icon
}
