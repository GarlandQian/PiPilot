import { describe, expect, it, vi } from 'vitest'
import {
  resolveExternalControlMcpConfiguration,
} from '../../src/main/external-control/command-resolver'

describe('External Control packaged command resolution', () => {
  const descriptorPath = '/Users/test/Library/Application Support/PiPilot/external-control.json'
  const isExecutableFile = vi.fn(() => true)

  it('uses the exact packaged macOS executable without LaunchServices or ASAR', () => {
    const command = '/Volumes/Tools/PiPilot.app/Contents/MacOS/PiPilot'
    expect(resolveExternalControlMcpConfiguration({
      descriptorPath,
      executablePath: command,
      isPackaged: true,
      platform: 'darwin',
      isExecutableFile,
    })).toEqual({
      command,
      args: ['--pipilot-mcp-stdio', '--descriptor', descriptorPath],
    })
  })

  it('uses validated APPIMAGE instead of the temporary mount executable', () => {
    expect(resolveExternalControlMcpConfiguration({
      appImagePath: '/home/test/Applications/PiPilot.AppImage',
      descriptorPath: '/home/test/.config/PiPilot/external-control.json',
      executablePath: '/tmp/.mount_PiPilot/usr/bin/pipilot',
      isPackaged: true,
      platform: 'linux',
      isExecutableFile,
    })?.command).toBe('/home/test/Applications/PiPilot.AppImage')
  })

  it('supports installed Windows and deb executables', () => {
    const entryPath = 'C:\\Program Files\\PiPilot\\resources\\app.asar\\out\\main\\index.js'
    expect(resolveExternalControlMcpConfiguration({
      descriptorPath: 'C:\\Users\\test\\AppData\\Roaming\\PiPilot\\external-control.json',
      executablePath: 'C:\\Program Files\\PiPilot\\PiPilot.exe',
      mcpEntryPath: entryPath,
      mcpExecutablePath: 'C:\\Program Files\\PiPilot\\PiPilot-mcp.exe',
      isPackaged: true,
      platform: 'win32',
      isExecutableFile,
      isFile: vi.fn(() => true),
    })).toEqual({
      command: 'C:\\Program Files\\PiPilot\\PiPilot-mcp.exe',
      args: [
        entryPath,
        '--pipilot-mcp-stdio',
        '--descriptor',
        'C:\\Users\\test\\AppData\\Roaming\\PiPilot\\external-control.json',
      ],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
    expect(resolveExternalControlMcpConfiguration({
      descriptorPath: '/home/test/.config/PiPilot/external-control.json',
      executablePath: '/usr/bin/pipilot',
      isPackaged: true,
      platform: 'linux',
      isExecutableFile,
    })?.command).toBe('/usr/bin/pipilot')
  })

  it('fails closed for unpackaged, invalid AppImage, and inner-ASAR commands', () => {
    expect(resolveExternalControlMcpConfiguration({
      descriptorPath,
      executablePath: '/path/to/electron',
      isPackaged: false,
      platform: 'darwin',
      isExecutableFile,
    })).toBeNull()
    expect(resolveExternalControlMcpConfiguration({
      appImagePath: 'relative.AppImage',
      descriptorPath: '/home/test/.config/PiPilot/external-control.json',
      executablePath: '/tmp/.mount_PiPilot/usr/bin/pipilot',
      isPackaged: true,
      platform: 'linux',
      isExecutableFile,
    })).toBeNull()
    expect(resolveExternalControlMcpConfiguration({
      descriptorPath,
      executablePath: '/Applications/PiPilot.app/Contents/Resources/app.asar/main.js',
      isPackaged: true,
      platform: 'darwin',
      isExecutableFile,
    })).toBeNull()
    expect(resolveExternalControlMcpConfiguration({
      descriptorPath: `${descriptorPath}\0suffix`,
      executablePath: '/Applications/PiPilot.app/Contents/MacOS/PiPilot',
      isPackaged: true,
      platform: 'darwin',
      isExecutableFile,
    })).toBeNull()
    expect(resolveExternalControlMcpConfiguration({
      descriptorPath,
      executablePath: '/Applications/PiPilot.app/Contents/MacOS/PiPilot\0suffix',
      isPackaged: true,
      platform: 'darwin',
      isExecutableFile,
    })).toBeNull()
  })

  it('allows an explicit executable only for unpackaged tests', () => {
    expect(resolveExternalControlMcpConfiguration({
      descriptorPath,
      executablePath: '/path/to/electron',
      isPackaged: false,
      platform: 'darwin',
      testExecutablePath: '/tmp/PiPilot-test',
      isExecutableFile,
    })?.command).toBe('/tmp/PiPilot-test')
  })

  it('fails closed when the packaged Windows Node entry is absent', () => {
    expect(resolveExternalControlMcpConfiguration({
      descriptorPath: 'C:\\Users\\test\\AppData\\Roaming\\PiPilot\\external-control.json',
      executablePath: 'C:\\Program Files\\PiPilot\\PiPilot.exe',
      mcpEntryPath: 'C:\\Program Files\\PiPilot\\resources\\app.asar\\out\\main\\index.js',
      mcpExecutablePath: 'C:\\Program Files\\PiPilot\\PiPilot-mcp.exe',
      isPackaged: true,
      platform: 'win32',
      isExecutableFile,
      isFile: vi.fn(() => false),
    })).toBeNull()
  })
})
