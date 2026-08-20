import { describe, expect, it, vi } from 'vitest'
import { bootstrapMain } from '../../src/main/bootstrap'

function createApp(events: string[]) {
  return {
    exit: vi.fn((code?: number) => { events.push(`app-exit:${code ?? 0}`) }),
    getVersion: vi.fn(() => '0.0.1'),
    whenReady: vi.fn(async () => { events.push('ready') }),
    quit: vi.fn(() => { events.push('quit') }),
    setActivationPolicy: vi.fn(() => { events.push('prohibited') }),
  }
}

describe('Main bootstrap', () => {
  it('imports only GUI Main for a normal invocation', async () => {
    const events: string[] = []
    const importElectron = vi.fn(async () => ({ app: createApp(events) }))
    const importGuiMain = vi.fn(async () => { events.push('gui') })
    const importMcpStdio = vi.fn(async () => ({
      runConversationMcpStdio: vi.fn(async () => 0),
    }))

    await bootstrapMain(['/Applications/PiPilot'], {
      importElectron,
      importGuiMain,
      importMcpStdio,
    })

    expect(events).toEqual(['gui'])
    expect(importElectron).not.toHaveBeenCalled()
    expect(importMcpStdio).not.toHaveBeenCalled()
  })

  it('sets prohibited activation before running headless stdio without GUI import', async () => {
    const events: string[] = []
    const app = createApp(events)
    const importGuiMain = vi.fn(async () => { events.push('gui') })
    const runConversationMcpStdio = vi.fn(async (
      _argv: string[],
      options: { serverVersion: string },
    ) => {
      events.push(`stdio:${options.serverVersion}`)
      return 7
    })
    const setExitCode = vi.fn((code: number) => events.push(`exit:${code}`))

    await bootstrapMain([
      '/Applications/PiPilot.app/Contents/MacOS/PiPilot',
      '--pipilot-mcp-stdio',
      '--descriptor',
      '/tmp/pipilot-descriptor.json',
    ], {
      platform: 'darwin',
      importElectron: async () => ({ app }),
      importGuiMain,
      importMcpStdio: async () => ({ runConversationMcpStdio }),
      setExitCode,
    })

    expect(events).toEqual([
      'prohibited',
      'ready',
      'stdio:0.0.1',
      'exit:7',
      'app-exit:7',
    ])
    expect(app.quit).not.toHaveBeenCalled()
    expect(importGuiMain).not.toHaveBeenCalled()
  })

  it('quits the headless Electron process when stdio startup fails', async () => {
    const events: string[] = []
    const app = createApp(events)
    await expect(bootstrapMain([
      '/Applications/PiPilot',
      '--pipilot-mcp-stdio',
    ], {
      platform: 'darwin',
      importElectron: async () => ({ app }),
      importGuiMain: vi.fn(),
      importMcpStdio: async () => ({
        runConversationMcpStdio: async () => {
          throw new Error('stdio failed')
        },
      }),
    })).rejects.toThrow('stdio failed')
    expect(events).toEqual(['prohibited', 'ready', 'quit'])
  })

  it('runs the Windows console launcher in Node mode without importing Electron', async () => {
    const events: string[] = []
    const runConversationMcpStdio = vi.fn(async () => {
      events.push('stdio')
      return 0
    })

    await bootstrapMain([
      'C:\\Program Files\\PiPilot\\PiPilot-mcp.exe',
      '--pipilot-mcp-stdio',
      '--descriptor',
      'C:\\Users\\test\\descriptor.json',
    ], {
      platform: 'win32',
      runAsNode: true,
      importElectron: vi.fn(async () => ({ app: createApp(events) })),
      importMcpStdio: async () => ({ runConversationMcpStdio }),
    })

    expect(events).toEqual(['stdio'])
  })
})
