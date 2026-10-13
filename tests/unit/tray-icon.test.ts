import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NativeImage, NativeTheme } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { createTrayIcons, followTrayTheme, trayBitmap, trayIconVariant } from '../../src/main/windows/tray-icon'

class Theme extends EventEmitter {
  shouldUseDarkColorsForSystemIntegratedUI = false
  shouldUseHighContrastColors = false
  shouldUseDarkColors = true
}

describe('tray icon contrast', () => {
  it('follows the Windows taskbar theme independently of app theme and handles high contrast', () => {
    const theme = new Theme() as NativeTheme
    expect(trayIconVariant('win32', theme)).toBe('dark')
    Object.assign(theme, { shouldUseDarkColorsForSystemIntegratedUI: true, shouldUseDarkColors: false })
    expect(trayIconVariant('win32', theme)).toBe('light')
    Object.assign(theme, { shouldUseHighContrastColors: true })
    expect(trayIconVariant('win32', theme)).toBe('outlined')
    expect(trayIconVariant('linux', theme)).toBe('outlined')
    expect(trayIconVariant('darwin', theme)).toBe('dark')
  })

  it('updates only on Windows system contrast changes and removes its listener on disposal', () => {
    const theme = new Theme() as NativeTheme
    const icons = { dark: {} as NativeImage, light: {} as NativeImage, outlined: {} as NativeImage }
    const tray = { isDestroyed: vi.fn(() => false), setImage: vi.fn() }
    const dispose = followTrayTheme('win32', theme, tray, icons)
    theme.emit('updated')
    expect(tray.setImage).not.toHaveBeenCalled()
    Object.assign(theme, { shouldUseDarkColorsForSystemIntegratedUI: true })
    theme.emit('updated')
    expect(tray.setImage).toHaveBeenLastCalledWith(icons.light)
    Object.assign(theme, { shouldUseHighContrastColors: true })
    theme.emit('updated')
    expect(tray.setImage).toHaveBeenLastCalledWith(icons.outlined)
    expect(tray.setImage).toHaveBeenCalledTimes(2)
    tray.isDestroyed.mockReturnValue(true)
    Object.assign(theme, { shouldUseHighContrastColors: false })
    theme.emit('updated')
    expect(tray.setImage).toHaveBeenCalledTimes(2)
    dispose()
    expect(theme.listenerCount('updated')).toBe(0)
    followTrayTheme('darwin', theme, tray, icons)()
    followTrayTheme('linux', theme, tray, icons)()
    expect(theme.listenerCount('updated')).toBe(0)
  })

  it('retains mask opacity and premultiplies antialiased white pixels', () => {
    const mask = Buffer.from([0, 0, 0, 0, 0, 0, 0, 128, 0, 0, 0, 255])
    expect([...trayBitmap(mask, 3, 1, 'light')]).toEqual([
      0, 0, 0, 0, 128, 128, 128, 128, 255, 255, 255, 255,
    ])
    expect(trayBitmap(mask, 3, 1, 'dark')).toEqual(mask)
    expect(mask[4]).toBe(0)
  })

  it('adds a white edge around the unchanged black silhouette for independent panel themes', () => {
    const mask = Buffer.alloc(5 * 5 * 4)
    mask[(2 * 5 + 2) * 4 + 3] = 255
    const pixels = trayBitmap(mask, 5, 5, 'outlined')
    expect([...pixels.subarray((2 * 5 + 2) * 4, (2 * 5 + 3) * 4)]).toEqual([0, 0, 0, 255])
    expect([...pixels.subarray((2 * 5 + 1) * 4, (2 * 5 + 2) * 4)]).toEqual([255, 255, 255, 255])
    expect([...pixels.subarray(0, 4)]).toEqual([0, 0, 0, 0])
    expect(() => trayBitmap(Buffer.alloc(1), 5, 5, 'dark')).toThrow('Invalid tray bitmap size')
  })

  it('keeps macOS template artwork at native and Retina scales and has a valid PNG fallback', () => {
    const template = { addRepresentation: vi.fn(), setTemplateImage: vi.fn() } as unknown as NativeImage
    const source = {
      isEmpty: () => false,
      resize: vi.fn(({ width }) => ({ toPNG: () => Buffer.from([width]) })),
    } as unknown as NativeImage
    const factory = {
      createEmpty: vi.fn(() => template),
      createFromBuffer: vi.fn((_buffer: Buffer) => source),
      createFromBitmap: vi.fn(),
    }
    const result = createTrayIcons(factory, { isEmpty: () => true } as NativeImage, 'darwin')
    expect(factory.createFromBuffer.mock.calls[0]?.[0]).toEqual(
      readFileSync(resolve('build/tray-icon.png')),
    )
    expect(template.addRepresentation).toHaveBeenCalledWith({ scaleFactor: 2, buffer: Buffer.from([36]) })
    expect(template.addRepresentation).toHaveBeenCalledWith({ scaleFactor: 3, buffer: Buffer.from([54]) })
    expect(template.setTemplateImage).toHaveBeenCalledWith(true)
    expect(result.dark).toBe(template)
    expect(result.light).toBe(template)
  })
})
