import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { macBinaryArchitectures, resolvePackagedExecutable } from '../packaged/resolve-packaged-executable'

describe('packaged smoke target', () => {
  it('selects each macOS architecture explicitly even when both bundles exist', () => {
    const options = { platform: 'darwin' as const, root: '.', exists: () => true }
    expect(resolvePackagedExecutable({ ...options, architecture: 'arm64' }))
      .toBe(resolve('release/mac-arm64/PiPilot.app/Contents/MacOS/PiPilot'))
    expect(resolvePackagedExecutable({ ...options, architecture: 'x64' }))
      .toBe(resolve('release/mac/PiPilot.app/Contents/MacOS/PiPilot'))
  })
  it('does not silently fall back to ARM64 when the Intel bundle is missing', () => {
    expect(() => resolvePackagedExecutable({
      platform: 'darwin', architecture: 'x64', exists: (path) => path.includes('mac-arm64'),
    })).toThrow('darwin/x64')
  })
  it('accepts explicit bundles but reports missing targets', () => {
    expect(resolvePackagedExecutable({
      platform: 'darwin', architecture: 'arm64', explicitPath: 'custom.app', exists: () => true,
    })).toBe(resolve('custom.app/Contents/MacOS/PiPilot'))
    expect(() => resolvePackagedExecutable({
      platform: 'win32', architecture: 'x64', exists: () => false,
    })).toThrow('win32/x64')
  })
  it('checks Mach-O CPU fields instead of trusting folder names', () => {
    const thin = Buffer.alloc(32)
    thin.writeUInt32LE(0xfeedfacf, 0)
    thin.writeUInt32LE(0x0100000c, 4)
    expect(macBinaryArchitectures(thin)).toEqual(['arm64'])
    const universal = Buffer.alloc(48)
    universal.writeUInt32BE(0xcafebabe, 0)
    universal.writeUInt32BE(2, 4)
    universal.writeUInt32BE(0x01000007, 8)
    universal.writeUInt32BE(0x0100000c, 28)
    expect(macBinaryArchitectures(universal)).toEqual(['x64', 'arm64'])
    expect(macBinaryArchitectures(Buffer.from('not an executable'))).toEqual([])
  })
})
