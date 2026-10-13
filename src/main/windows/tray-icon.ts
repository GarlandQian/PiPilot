import type { NativeImage, NativeTheme, Tray, nativeImage } from 'electron'

type TrayTheme = Pick<NativeTheme,
  'shouldUseDarkColorsForSystemIntegratedUI' | 'shouldUseHighContrastColors' | 'on' | 'off'>
type ImageFactory = Pick<typeof nativeImage, 'createEmpty' | 'createFromBuffer' | 'createFromBitmap'>
export type TrayIconVariant = 'dark' | 'light' | 'outlined'
export type TrayIcons = Record<TrayIconVariant, NativeImage>

// PNG fallback for build/tray-icon.png. NativeImage supports PNG/JPEG, not SVG.
const fallbackPng = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAADMklEQVR4nOybO2gVQRSG/0SNovgo4luUiBaChQiKvSj4KFS0ERsJ2gh2KSxUUFvFxkpEQRGs1BgsBEFFFIKR+EI0auFbkBjfgZDcnMPcwLB3N3t2Zufu3p394C9mcjbc/e85s7Mzc5vhOc3wnNIAeE5pADynNACe470BE5GMNtIS0mLSQtJkNA4V0kPSLb1TYsAyUgdpD2kqGp9jpKNjjbgS4MA+0n4U4+aZrXojKgM4ta+SNqF4zNcbUQZcQjFvvoYwA/aSdsITmgLtSaQPpLkoLl9IC8YawQzYjWLfPFPRG0EDNqL4fNYbQQPWofic1RtBA4YQzQCph/SU9Evr53rah3hukB4jGVySywVxJ0l/YmJGSFdIr/TO4CDYTjpFmqH19UOVRg/CWUPqRjz8dLmAZHSRtgji+Nn+FQYEM+BcVWuhyqGF1El6neB/RDGCHBL14bsh+1aZCcI4lwY0wZCkb4NhSF+ph+COCgxJw4AWYdwwckgaBkwRxg3CHZmWgHRR5D9ySD1L4B/ckekYMF0Y5zIDMi0BqQG/4Y5MM2CmMO4n3NEQGfAd7sg0A2YLYuJeVGzJNAMkCyg/kFPSMGCOIOYbckoaBswTxLyHWzIbA3gWKMmAj3BLZmOAZLWGcZ0Bxtga0CaMewe3ZFYCK4Vxz+GWzEpgtSCGF0L6kFPqYcATuEe6LFeDzQkRngEuFcQ9gjnS2l4EQ2wM2CCMuwtzpG+Qq2BIPQy4A3MGhHHHoW14JsFmDNgsiOFdGKMNiypvhXGtUAPtGaidq09Q5cNL8fwE6o+60NSA7ZDNADthR5Lxg4/wdET87TbUmYeajDItgXZh3HnYYTOA6qxHhDkmBvDoLzk+wxuhL2HHX9I1pEPoI9vEgB3C604jHY4gHUIXbkwMkOwD9JIuIh2ekU7AESYGvBHEHEC6HCZdhx2ha5ImBtyE+lai2EV6gPTZRjoENS6Y0BvWaTqHvgy1EqTPwO5BnRTpgjvuQx3g4PkFG8H7kq2C6/gxeBAh+5PGr5FVZpFWQE1CXC57x8GHt3lxdlqgn3ekX2CciZCtAQ1P+YMJeE5pADynNACeUxoAzxkFAAD//2qr94UAAAAGSURBVAMAylt4YoshV9cAAAAASUVORK5CYII='

export function trayIconVariant(platform: NodeJS.Platform, theme: TrayTheme): TrayIconVariant {
  // Linux panels can use an independent theme and have no equivalent system-theme
  // property. A black mark with a white edge stays visible on either background.
  if (platform === 'linux') return 'outlined'
  if (platform !== 'win32') return 'dark'
  if (theme.shouldUseHighContrastColors) return 'outlined'
  return theme.shouldUseDarkColorsForSystemIntegratedUI ? 'light' : 'dark'
}

/** Recolor Electron's premultiplied N32 mask on our little-endian target CPUs. */
export function trayBitmap(
  mask: Buffer,
  width: number,
  height: number,
  variant: TrayIconVariant,
): Buffer {
  if (mask.length !== width * height * 4) throw new Error('Invalid tray bitmap size')
  const result = Buffer.alloc(mask.length)
  const radius = Math.max(1, Math.round(width / 32))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4
      const alpha = mask[offset + 3]!
      let edge = 0
      if (variant === 'outlined') {
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            if (dx * dx + dy * dy > radius * radius) continue
            const xx = x + dx
            const yy = y + dy
            if (xx >= 0 && xx < width && yy >= 0 && yy < height) {
              edge = Math.max(edge, mask[(yy * width + xx) * 4 + 3]!)
            }
          }
        }
      }
      // White edge behind a black mark; keep channels premultiplied by alpha.
      const white = variant === 'light' ? alpha : Math.round(edge * (255 - alpha) / 255)
      result[offset] = result[offset + 1] = result[offset + 2] = white
      result[offset + 3] = alpha + (variant === 'outlined' ? white : 0)
    }
  }
  return result
}

export function createTrayIcons(
  factory: ImageFactory,
  loaded: NativeImage,
  platform: NodeJS.Platform,
): TrayIcons {
  const source = loaded.isEmpty()
    ? factory.createFromBuffer(Buffer.from(fallbackPng, 'base64'))
    : loaded
  if (platform === 'darwin') {
    const template = factory.createEmpty()
    for (const scaleFactor of [1, 2, 3]) {
      const size = 18 * scaleFactor
      template.addRepresentation({
        scaleFactor,
        buffer: source.resize({ width: size, height: size }).toPNG(),
      })
    }
    template.setTemplateImage(true)
    return { dark: template, light: template, outlined: template }
  }
  // Do not discard source resolution by reducing every platform to 18 px.
  // Windows converts NativeImage into HICON; the shell chooses the display size.
  // Linux StatusNotifier hosts similarly rescale to their panel's dimensions.
  const size = 64
  const mask = source.resize({ width: size, height: size }).toBitmap()
  const make = (variant: TrayIconVariant) => factory.createFromBitmap(
    trayBitmap(mask, size, size, variant), { width: size, height: size },
  )
  const dark = make('dark')
  const outlined = make('outlined')
  return { dark, light: platform === 'win32' ? make('light') : dark, outlined }
}

export function followTrayTheme(
  platform: NodeJS.Platform,
  theme: TrayTheme,
  tray: Pick<Tray, 'isDestroyed' | 'setImage'>,
  icons: TrayIcons,
): () => void {
  if (platform !== 'win32') return () => {}
  let current = trayIconVariant(platform, theme)
  const update = () => {
    if (tray.isDestroyed()) return
    const next = trayIconVariant(platform, theme)
    if (next !== current) {
      tray.setImage(icons[next])
      current = next
    }
  }
  theme.on('updated', update)
  return () => { theme.off('updated', update) }
}
