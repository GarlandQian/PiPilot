import { describe, expect, it, vi } from 'vitest'
import {
  RuntimeExtensionUiBridge,
  createHeadlessPiTheme,
} from '../../src/main/pi-host/runtime-extension-ui-bridge'
import { preparePiHostChildProcessEnvironment } from '../../src/main/pi-host/pi-package-adapters'
import type { LocalPiExtensionUiRequest } from '../../src/shared/local-pi'

describe('RuntimeExtensionUiBridge', () => {
  it('settles cancelled and replaced dialogs with their official defaults', async () => {
    const requests: Array<{ id: string; method: string; reason?: string }> = []
    const bridge = new RuntimeExtensionUiBridge((request) => {
      requests.push({
        id: request.id,
        method: request.method,
        ...('reason' in request ? { reason: request.reason } : {}),
      })
    })

    const confirm = bridge.uiContext.confirm('Confirm', 'Continue?')
    const select = bridge.uiContext.select('Choose', ['one', 'two'])
    expect(bridge.pendingCount).toBe(2)

    bridge.respond({
      type: 'extension_ui_response',
      id: requests[0]!.id,
      cancelled: true,
    })
    expect(await confirm).toBe(false)

    expect(bridge.cancelAll()).toEqual([requests[1]!.id])
    expect(await select).toBeUndefined()
    expect(bridge.pendingCount).toBe(0)
    expect(requests).toContainEqual({
      id: requests[1]!.id,
      method: 'dismiss',
      reason: 'replaced',
    })
  })

  it('bounds pending dialogs and reports overflow without blocking the extension', async () => {
    const onFatal = vi.fn()
    const bridge = new RuntimeExtensionUiBridge(() => undefined, {
      maxPendingDialogs: 1,
      onFatal,
    })

    const first = bridge.uiContext.confirm('First', 'Wait')
    const overflow = bridge.uiContext.confirm('Second', 'Overflow')

    await expect(overflow).resolves.toBe(false)
    expect(onFatal).toHaveBeenCalledOnce()
    expect(bridge.pendingCount).toBe(1)
    bridge.cancelAll()
    await expect(first).resolves.toBe(false)
  })

  it('provides a plain-text Theme and projects working/TUI-only observations', () => {
    const requests: LocalPiExtensionUiRequest[] = []
    const bridge = new RuntimeExtensionUiBridge((request) => requests.push(request))
    const theme = createHeadlessPiTheme()

    expect(theme.fg('accent', 'MCP')).toBe('MCP')
    expect(theme.bold('Ready')).toBe('Ready')
    expect(bridge.uiContext.theme.fg('success', 'Connected')).toBe('Connected')

    bridge.uiContext.setWorkingMessage('Loading tools')
    bridge.uiContext.setWorkingVisible(true)
    const footerFactory = (() => ({ render: () => [] })) as never
    bridge.uiContext.setFooter(footerFactory)
    bridge.uiContext.setFooter(footerFactory)

    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'setWorkingMessage', message: 'Loading tools' }),
      expect.objectContaining({ method: 'setWorkingVisible', visible: true }),
      expect.objectContaining({ method: 'unsupported', unsupportedMethod: 'setFooter' }),
    ]))
    expect(requests.filter((request) =>
      request.method === 'unsupported' && request.unsupportedMethod === 'setFooter'))
      .toHaveLength(1)

    bridge.reload()
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'setWorkingMessage' }),
      expect.objectContaining({ method: 'setWorkingVisible', visible: false }),
    ]))
  })

  it('prepares Electron-as-Node only for an already-running Electron utility', () => {
    const environment: NodeJS.ProcessEnv = {}
    expect(preparePiHostChildProcessEnvironment(environment, undefined)).toBe(false)
    expect(environment.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(preparePiHostChildProcessEnvironment(environment, '43.4.1')).toBe(true)
    expect(environment.ELECTRON_RUN_AS_NODE).toBe('1')
  })
})
