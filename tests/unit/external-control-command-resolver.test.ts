import { describe, expect, it, vi } from 'vitest'
import {
  resolveExternalControlLauncherSource,
  resolveExternalControlMcpConfiguration,
} from '../../src/main/external-control/command-resolver'

describe('External Control packaged launcher resolution', () => {
  const descriptorPath = '/Users/test/Library/Application Support/PiPilot/external-control.json'
  const isExecutableFile = vi.fn(() => true)

  it('projects one portable public configuration on every supported platform', () => {
    const fixtures = [
      {
        descriptorPath,
        executablePath: '/Applications/PiPilot.app/Contents/MacOS/PiPilot',
        isPackaged: true,
        platform: 'darwin' as const,
      },
      {
        appImagePath: '/home/test/Applications/PiPilot.AppImage',
        descriptorPath: '/home/test/.config/PiPilot/external-control.json',
        executablePath: '/tmp/.mount_PiPilot/usr/bin/pipilot',
        isPackaged: true,
        platform: 'linux' as const,
      },
      {
        descriptorPath: 'C:\\Users\\test\\AppData\\Roaming\\PiPilot\\external-control.json',
        executablePath: 'C:\\Program Files\\PiPilot\\PiPilot.exe',
        mcpExecutablePath: 'C:\\Program Files\\PiPilot\\pipilot-mcp.exe',
        isPackaged: true,
        platform: 'win32' as const,
      },
    ]
    for (const fixture of fixtures) {
      expect(resolveExternalControlMcpConfiguration({
        ...fixture,
        isExecutableFile,
      })).toEqual({ command: 'pipilot-mcp', args: [] })
    }
  })

  it('keeps packaged source selection inside Main', () => {
    expect(resolveExternalControlLauncherSource({
      descriptorPath,
      executablePath: '/Applications/PiPilot.app/Contents/MacOS/PiPilot',
      isPackaged: true,
      platform: 'darwin',
      isExecutableFile,
    })).toBe('/Applications/PiPilot.app/Contents/MacOS/PiPilot')
    expect(resolveExternalControlLauncherSource({
      appImagePath: '/home/test/Applications/PiPilot.AppImage',
      descriptorPath: '/home/test/.config/PiPilot/external-control.json',
      executablePath: '/tmp/.mount_PiPilot/usr/bin/pipilot',
      isPackaged: true,
      platform: 'linux',
      isExecutableFile,
    })).toBe('/home/test/Applications/PiPilot.AppImage')
    expect(resolveExternalControlLauncherSource({
      descriptorPath: 'C:\\Users\\test\\AppData\\Roaming\\PiPilot\\external-control.json',
      executablePath: 'C:\\Program Files\\PiPilot\\PiPilot.exe',
      mcpExecutablePath: 'C:\\Program Files\\PiPilot\\pipilot-mcp.exe',
      isPackaged: true,
      platform: 'win32',
      isExecutableFile,
    })).toBe('C:\\Program Files\\PiPilot\\pipilot-mcp.exe')
  })

  it('fails closed for unpackaged or invalid internal paths', () => {
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
      descriptorPath: `${descriptorPath}\0suffix`,
      executablePath: '/Applications/PiPilot.app/Contents/MacOS/PiPilot',
      isPackaged: true,
      platform: 'darwin',
      isExecutableFile,
    })).toBeNull()
  })

  it('allows an explicit source only for unpackaged tests', () => {
    expect(resolveExternalControlMcpConfiguration({
      descriptorPath,
      executablePath: '/path/to/electron',
      isPackaged: false,
      platform: 'darwin',
      testExecutablePath: '/tmp/PiPilot-test',
      isExecutableFile,
    })).toEqual({ command: 'pipilot-mcp', args: [] })
  })

  it('fails closed when the packaged Windows CUI executable is absent', () => {
    const isWindowsExecutable = vi.fn((path: string) => !path.endsWith('pipilot-mcp.exe'))
    expect(resolveExternalControlMcpConfiguration({
      descriptorPath: 'C:\\Users\\test\\AppData\\Roaming\\PiPilot\\external-control.json',
      executablePath: 'C:\\Program Files\\PiPilot\\PiPilot.exe',
      mcpExecutablePath: 'C:\\Program Files\\PiPilot\\pipilot-mcp.exe',
      isPackaged: true,
      platform: 'win32',
      isExecutableFile: isWindowsExecutable,
    })).toBeNull()
  })
})
