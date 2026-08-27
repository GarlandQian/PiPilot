import { PassThrough } from 'node:stream'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { bootstrapMain } from '../../src/main/bootstrap'

function createApp(
  events: string[],
  userData = '/Users/test/Library/Application Support/PiPilot',
) {
  let currentUserData = userData
  return {
    exit: vi.fn((code?: number) => { events.push(`app-exit:${code ?? 0}`) }),
    getPath: vi.fn(() => currentUserData),
    getVersion: vi.fn(() => '0.0.1'),
    isPackaged: false,
    setPath: vi.fn((_name: 'userData', path: string) => { currentUserData = path }),
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
    const app = createApp(events, 'C:\\Users\\test\\AppData\\Roaming\\PiPilot')
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

    expect(events).toEqual(['prohibited', 'stdio:0.0.1', 'exit:7', 'app-exit:7'])
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
    expect(events).toEqual(['prohibited', 'quit'])
  })

  it('runs the Windows console launcher through the same Electron headless entry', async () => {
    const events: string[] = []
    const app = createApp(events, 'C:\\Users\\test\\AppData\\Roaming\\PiPilot')
    const runConversationMcpStdio = vi.fn(async (
      _argv: string[],
      options: { serverVersion: string },
    ) => {
      events.push(`stdio:${options.serverVersion}`)
      return 0
    })

    const executablePath = 'C:\\Program Files\\PiPilot\\pipilot-mcp.exe'
    await bootstrapMain([executablePath], {
      executablePath,
      platform: 'win32',
      importElectron: vi.fn(async () => ({ app })),
      importMcpStdio: async () => ({ runConversationMcpStdio }),
    })

    expect(events).toEqual(['stdio:0.0.1', 'app-exit:0'])
    expect(app.setActivationPolicy).not.toHaveBeenCalled()
    expect(runConversationMcpStdio).toHaveBeenCalledWith([], expect.objectContaining({
      descriptorPath: 'C:\\Users\\test\\AppData\\Roaming\\PiPilot\\external-control\\descriptor.json',
      requireNoArguments: true,
    }))
  })

  it('keeps unexpected Windows public launcher arguments on the rejecting path', async () => {
    const events: string[] = []
    const app = createApp(events, 'C:\\Users\\test\\AppData\\Roaming\\PiPilot')
    const executablePath = 'C:\\Program Files\\PiPilot\\pipilot-mcp.exe'
    const runConversationMcpStdio = vi.fn(async () => 1)

    await bootstrapMain([executablePath, 'unexpected'], {
      executablePath,
      platform: 'win32',
      stdin: new PassThrough(),
      importElectron: async () => ({ app }),
      importMcpStdio: async () => ({ runConversationMcpStdio }),
    })

    expect(runConversationMcpStdio).toHaveBeenCalledWith(
      ['unexpected'],
      expect.objectContaining({ requireNoArguments: true }),
    )
    expect(events).toEqual(['app-exit:1'])
  })

  it('uses only the validated packaged-smoke user-data override for the private descriptor', async () => {
    const events: string[] = []
    const app = {
      ...createApp(events, '/Users/test/Library/Application Support/PiPilot'),
      isPackaged: true,
    }
    const runConversationMcpStdio = vi.fn(async () => 0)
    const override = join(tmpdir(), 'pipilot-packaged-smoke-bootstrap')

    await bootstrapMain([
      '/Applications/PiPilot.app/Contents/MacOS/PiPilot',
      '--pipilot-mcp-stdio',
    ], {
      environment: {
        PIPILOT_E2E_USER_DATA: override,
        PIPILOT_PACKAGED_SMOKE: '1',
      },
      platform: 'darwin',
      stdin: new PassThrough(),
      importElectron: async () => ({ app }),
      importMcpStdio: async () => ({ runConversationMcpStdio }),
    })

    expect(app.setPath).toHaveBeenCalledWith('userData', override)
    expect(runConversationMcpStdio).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        descriptorPath: `${override}/external-control/descriptor.json`,
      }),
    )
  })

  it('forwards MCP input through the headless stdio entry', async () => {
    const events: string[] = []
    const app = createApp(events, 'C:\\Users\\test\\AppData\\Roaming\\PiPilot')
    const stdin = new PassThrough()
    let bufferedInput: PassThrough | undefined
    let resolveRun!: (exitCode: number) => void
    const runConversationMcpStdio = vi.fn((
      _argv: string[],
      options: { serverVersion: string; input?: PassThrough },
    ) => new Promise<number>((resolve) => {
      bufferedInput = options.input
      resolveRun = resolve
    }))
    const pending = bootstrapMain([], {
      executablePath: 'C:\\Program Files\\PiPilot\\pipilot-mcp.exe',
      platform: 'win32',
      stdin,
      importElectron: async () => ({ app }),
      importMcpStdio: async () => ({ runConversationMcpStdio }),
    })

    await vi.waitFor(() => expect(runConversationMcpStdio).toHaveBeenCalledOnce())
    const chunks: Buffer[] = []
    bufferedInput?.on('data', (chunk: Buffer) => chunks.push(chunk))
    stdin.write('{"jsonrpc":"2.0","id":1}\n')
    await vi.waitFor(() => expect(Buffer.concat(chunks).toString()).toContain('"id":1'))
    resolveRun(0)
    await pending

    stdin.end()
  })
})
