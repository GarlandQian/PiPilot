import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function run(executable: string, args: string[]) {
  return new Promise<string>((resolvePromise, rejectPromise) => {
    execFile(executable, args, { timeout: 10_000, encoding: 'utf8' }, (error, stdout) => error ? rejectPromise(error) : resolvePromise(stdout))
  })
}

/**
 * A macOS app's own icon as a PNG data URL. Electron's file icon is a generic
 * placeholder for app bundles here, so read the bundle's .icns and let
 * `sips` (part of macOS) scale it.
 */
export async function macAppIcon(app: string): Promise<string | undefined> {
  if (!app.endsWith('.app')) return undefined
  const name = (await run('/usr/bin/plutil', ['-extract', 'CFBundleIconFile', 'raw', '-o', '-', join(app, 'Contents/Info.plist')]).catch(() => '')).trim()
  if (!name || name.includes('/')) return undefined
  const icns = join(app, 'Contents/Resources', name.endsWith('.icns') ? name : `${name}.icns`)
  const output = join(tmpdir(), `pipilot-icon-${randomUUID()}.png`)
  try {
    await run('/usr/bin/sips', ['-s', 'format', 'png', '-Z', '64', icns, '--out', output])
    const png = await readFile(output)
    return png.length && png.length < 64_000 ? `data:image/png;base64,${png.toString('base64')}` : undefined
  } catch {
    return undefined
  } finally {
    await rm(output, { force: true }).catch(() => undefined)
  }
}
