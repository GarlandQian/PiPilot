import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appGetInfoContract,
  conversationNavigationGetContract,
  conversationNewContract,
  localPiCommandContract,
  localPiRendererReadyContract,
  sessionCatalogDeleteContract,
  sessionCatalogListContract,
  sessionCatalogOpenContract,
  sessionCatalogRenameContract,
  settingsChangedEventSchema,
  settingsUpdateContract,
  terminalCreateContract,
  terminalEventSchema,
  terminalInputContract,
  terminalResizeContract,
  workspaceChooseContract,
  workspaceDiffListContract,
  workspaceDiffReadContract,
  workspaceFilePreviewContract,
  workspaceFilesListContract,
  workspaceFilesSearchContract,
  workspaceGetContract,
  workspaceRemoveContract,
} from '../../src/shared/ipc/contracts'
import {
  localPiRendererRpcResponseSchema,
  localPiRpcResponseSchema,
  type LocalPiRpcResponse,
  type LocalPiSessionTreeNode,
} from '../../src/shared/local-pi'
import { projectLocalPiRendererRpcResponse } from '../../src/main/ipc/projection/pi-rpc-response-projection'
import { createApplicationUrlPolicy } from '../../src/main/security/url-policy'
import {
  createTrustedSenderValidator,
  createValidatedInvokeHandler,
  MainProcessError,
} from '../../src/main/ipc/validated-invoke'

const requestId = '7ce0eb26-d89f-4f0b-8b1a-89f3db46d6db'
const validRequest = { context: { requestId } }
const validResponse = {
  name: 'PiPilot' as const,
  version: '0.0.1',
  platform: 'darwin',
  arch: 'arm64',
  electronVersion: '43.4.1',
  mode: 'development' as const,
}
const emptyEvent = {} as IpcMainInvokeEvent

afterEach(() => {
  vi.restoreAllMocks()
})

describe('validated IPC invocation', () => {
  it('correlates and validates a successful result', async () => {
    const invoke = createValidatedInvokeHandler(
      appGetInfoContract,
      () => true,
      () => validResponse,
    )

    await expect(invoke(emptyEvent, validRequest)).resolves.toEqual({
      ok: true,
      requestId,
      value: validResponse,
    })
  })

  it('rejects an untrusted sender before processing payload data', async () => {
    const handler = vi.fn(() => validResponse)
    const invoke = createValidatedInvokeHandler(appGetInfoContract, () => false, handler)
    const result = await invoke(emptyEvent, validRequest)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('IPC_UNTRUSTED_SENDER')
    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects malformed request and response payloads', async () => {
    const validHandler = vi.fn(() => validResponse)
    const invoke = createValidatedInvokeHandler(appGetInfoContract, () => true, validHandler)
    const invalidRequestResult = await invoke(emptyEvent, {
      context: { requestId: 'not-a-uuid' },
    })

    expect(invalidRequestResult.ok).toBe(false)
    if (!invalidRequestResult.ok) {
      expect(invalidRequestResult.error.code).toBe('IPC_INVALID_REQUEST')
    }
    expect(validHandler).not.toHaveBeenCalled()

    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const invalidResponseInvoke = createValidatedInvokeHandler(
      appGetInfoContract,
      () => true,
      () => ({ name: 'NotPiPilot' }) as never,
    )
    const invalidResponseResult = await invalidResponseInvoke(emptyEvent, validRequest)

    expect(invalidResponseResult.ok).toBe(false)
    if (!invalidResponseResult.ok) {
      expect(invalidResponseResult.error.code).toBe('IPC_INVALID_RESPONSE')
      expect(invalidResponseResult.requestId).toBe(requestId)
    }
  })

  it('preserves safe typed main-process failures', async () => {
    const invoke = createValidatedInvokeHandler(appGetInfoContract, () => true, () => {
      throw new MainProcessError('EXPECTED_FAILURE', 'Expected safe failure.', false)
    })
    const result = await invoke(emptyEvent, validRequest)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatchObject({
        code: 'EXPECTED_FAILURE',
        message: 'Expected safe failure.',
        recoverable: false,
        source: 'main',
        requestId,
      })
    }
  })

  it('does not write unexpected error details to production-visible logs', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const invoke = createValidatedInvokeHandler(appGetInfoContract, () => true, () => {
      throw new Error('secret-token at /Users/private/workspace')
    })

    const result = await invoke(emptyEvent, validRequest)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('IPC_INTERNAL_ERROR')
    expect(errorSpy).toHaveBeenCalledWith(
      `[PiPilot] IPC handler failed for ${appGetInfoContract.channel}`,
    )
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('secret-token')
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('/Users/private')
  })
})

describe('IPC sender validation', () => {
  it('requires the current main window, its main frame, and exact application URL', () => {
    const frame = { url: 'pipilot://app/' }
    const webContents = { mainFrame: frame }
    let window: BrowserWindow | null = {
      isDestroyed: () => false,
      webContents,
    } as unknown as BrowserWindow
    const validator = createTrustedSenderValidator(
      createApplicationUrlPolicy(),
      () => window,
    )

    expect(
      validator({ senderFrame: frame, sender: webContents } as IpcMainInvokeEvent),
    ).toBe(true)
    expect(
      validator({ senderFrame: frame, sender: { mainFrame: frame } } as IpcMainInvokeEvent),
    ).toBe(false)
    expect(
      validator({
        senderFrame: { url: 'https://example.com/' },
        sender: webContents,
      } as IpcMainInvokeEvent),
    ).toBe(false)

    window = null
    expect(
      validator({ senderFrame: frame, sender: webContents } as IpcMainInvokeEvent),
    ).toBe(false)
  })
})

describe('settings IPC schemas', () => {
  it('accepts bounded partial updates and rejects unknown or invalid values', () => {
    expect(
      settingsUpdateContract.requestSchema.safeParse({
        context: { requestId },
        patch: {
          appearance: { uiFontSize: 18, theme: 'dark' },
          composer: { sendShortcut: 'mod-enter' },
          terminal: { fontFamily: 'Maple Mono', fontSize: 16 },
        },
      }).success,
    ).toBe(true)
    expect(
      settingsUpdateContract.requestSchema.safeParse({
        context: { requestId },
        patch: { appearance: { uiFontSize: 99 } },
      }).success,
    ).toBe(false)
    expect(
      settingsUpdateContract.requestSchema.safeParse({
        context: { requestId },
        patch: { terminal: { fontSize: 99 } },
      }).success,
    ).toBe(false)
    expect(
      settingsUpdateContract.requestSchema.safeParse({
        context: { requestId },
        patch: { composer: { sendShortcut: 'space' } },
      }).success,
    ).toBe(false)
    expect(
      settingsUpdateContract.requestSchema.safeParse({
        context: { requestId },
        patch: { secret: 'not-allowed' },
      }).success,
    ).toBe(false)
  })

  it('validates settings events before preload delivery', () => {
    expect(
      settingsChangedEventSchema.safeParse({
        eventId: requestId,
        snapshot: { revision: 2, settings: darkSettingsForEvent() },
      }).success,
    ).toBe(true)
    expect(
      settingsChangedEventSchema.safeParse({
        eventId: requestId,
        snapshot: { revision: -1, settings: darkSettingsForEvent() },
      }).success,
    ).toBe(false)
  })
})

describe('local Pi IPC schemas', () => {
  it('keeps the renderer-ready handshake strict and acknowledgement-only', () => {
    expect(localPiRendererReadyContract.requestSchema.safeParse({
      context: { requestId },
    }).success).toBe(true)
    expect(localPiRendererReadyContract.requestSchema.safeParse({
      context: { requestId },
      subscriptions: ['runtime', 'events', 'extension'],
    }).success).toBe(false)
    expect(localPiRendererReadyContract.responseSchema.safeParse({
      accepted: true,
    }).success).toBe(true)
    expect(localPiRendererReadyContract.responseSchema.safeParse({
      accepted: true,
      runtime: {},
    }).success).toBe(false)
  })

  it('accepts only documented RPC commands without renderer-supplied ids', () => {
    expect(localPiCommandContract.requestSchema.safeParse({
      context: { requestId },
      command: { type: 'steer', message: 'Adjust the current work' },
    }).success).toBe(true)
    expect(localPiCommandContract.requestSchema.safeParse({
      context: { requestId },
      command: { type: 'set_thinking_level', level: 'max' },
    }).success).toBe(true)
    expect(localPiCommandContract.requestSchema.safeParse({
      context: { requestId },
      command: { type: 'steer', message: 'Adjust', id: 'renderer-id' },
    }).success).toBe(false)
    expect(localPiCommandContract.requestSchema.safeParse({
      context: { requestId },
      command: { type: 'private_command' },
    }).success).toBe(false)
    expect(localPiCommandContract.requestSchema.safeParse({
      context: { requestId },
      command: { type: 'switch_session', sessionPath: '/tmp/session.jsonl' },
    }).success).toBe(false)
  })

  it('projects deep official trees to a clone-safe flat renderer response', () => {
    const depth = 2_000
    let tree: LocalPiSessionTreeNode[] = []
    for (let index = depth - 1; index >= 0; index -= 1) {
      tree = [{
        entry: {
          type: 'session_info',
          id: `entry-${index}`,
          parentId: index === 0 ? null : `entry-${index - 1}`,
          timestamp: '2026-08-09T00:00:00.000Z',
          name: `Entry ${index}`,
        },
        children: tree,
        ...(index === depth - 1 ? { label: 'Active leaf' } : {}),
      }]
    }
    const hostResponse = localPiRpcResponseSchema.parse({
      type: 'response',
      command: 'get_tree',
      success: true,
      data: { tree, leafId: `entry-${depth - 1}` },
    })

    expect(localPiRendererRpcResponseSchema.safeParse(hostResponse).success).toBe(false)
    const rendererResponse = projectLocalPiRendererRpcResponse(hostResponse)
    expect(localPiCommandContract.responseSchema.safeParse(rendererResponse).success).toBe(true)
    if (!rendererResponse.success || rendererResponse.command !== 'get_tree') return

    expect(rendererResponse.data.rows).toHaveLength(depth)
    expect(rendererResponse.data.rows[0]).toMatchObject({
      entry: { id: 'entry-0' },
      parentId: null,
      depth: 0,
      order: 0,
    })
    expect(rendererResponse.data.rows[depth - 1]).toMatchObject({
      entry: { id: `entry-${depth - 1}` },
      parentId: `entry-${depth - 2}`,
      depth: depth - 1,
      order: depth - 1,
      label: 'Active leaf',
    })
    expect(rendererResponse.data.leafId).toBe(`entry-${depth - 1}`)
    expect(rendererResponse).toEqual(structuredClone(rendererResponse))
  })

  it('maps non-cloneable renderer projections to a typed protocol error', () => {
    const response = {
      type: 'response',
      command: 'get_tree',
      success: true,
      data: {
        tree: [{
          entry: {
            type: 'custom',
            id: 'non-cloneable',
            parentId: null,
            timestamp: '2026-08-09T00:00:00.000Z',
            customType: 'non-cloneable-fixture',
            data: () => undefined,
          },
          children: [],
        }],
        leafId: 'non-cloneable',
      },
    } as LocalPiRpcResponse

    let thrown: unknown
    try {
      projectLocalPiRendererRpcResponse(response)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toMatchObject({
      code: 'PI_RUNTIME_OPERATION_FAILED',
      recoverable: false,
    })
  })
})

describe('official Pi session catalog IPC schemas', () => {
  const scope = {
    kind: 'project' as const,
    workspaceId: '00000000-0000-4000-8000-000000000001',
  }
  const selectionToken = `sel_${'a'.repeat(32)}`

  it('accepts only typed path-free scopes and opaque selections', () => {
    expect(sessionCatalogListContract.requestSchema.safeParse({
      context: { requestId },
      scope,
    }).success).toBe(true)
    expect(sessionCatalogListContract.requestSchema.safeParse({
      context: { requestId },
      scope: { ...scope, path: '/Users/private/project' },
    }).success).toBe(false)
    expect(sessionCatalogOpenContract.requestSchema.safeParse({
      context: { requestId },
      scope,
      selectionToken,
    }).success).toBe(true)
    expect(sessionCatalogOpenContract.requestSchema.safeParse({
      context: { requestId },
      scope,
      selectionToken: '/tmp/session.jsonl',
    }).success).toBe(false)
    expect(sessionCatalogDeleteContract.requestSchema.safeParse({
      context: { requestId },
      scope,
      selectionToken,
    }).success).toBe(true)
    expect(sessionCatalogDeleteContract.requestSchema.safeParse({
      context: { requestId },
      scope,
      selectionToken,
      sessionFile: '/Users/private/session.jsonl',
    }).success).toBe(false)
    expect(sessionCatalogRenameContract.requestSchema.safeParse({
      context: { requestId },
      scope,
      selectionToken,
      name: 'Renamed session',
    }).success).toBe(true)
    expect(sessionCatalogRenameContract.requestSchema.safeParse({
      context: { requestId },
      scope,
      selectionToken,
      name: '',
    }).success).toBe(false)
  })

  it('rejects paths in catalog rows and activation results', () => {
    const row = {
      scope,
      sessionId: 'session-1',
      preview: 'hello',
      createdAt: '2026-08-08T00:00:00.000Z',
      modifiedAt: '2026-08-08T00:00:01.000Z',
      selectionToken,
    }
    expect(sessionCatalogListContract.responseSchema.safeParse({
      status: 'ready',
      scope,
      rows: [row],
      nextCursor: null,
      diagnostics: [],
    }).success).toBe(true)
    expect(sessionCatalogListContract.responseSchema.safeParse({
      status: 'ready',
      scope,
      rows: [{ ...row, sessionFile: '/Users/private/session.jsonl' }],
      nextCursor: null,
      diagnostics: [],
    }).success).toBe(false)
    expect(sessionCatalogOpenContract.responseSchema.safeParse({
      scope,
      sessionId: 'session-1',
      generation: 1,
      sessionFile: '/Users/private/session.jsonl',
    }).success).toBe(false)
    expect(sessionCatalogRenameContract.responseSchema.safeParse({
      scope,
      sessionId: 'session-1',
      name: 'Renamed session',
    }).success).toBe(true)
    expect(sessionCatalogRenameContract.responseSchema.safeParse({
      scope,
      sessionId: 'session-1',
      name: 'Renamed session',
      sessionFile: '/Users/private/session.jsonl',
    }).success).toBe(false)
    const deletion = {
      scope,
      sessionId: 'session-1',
      activeDeleted: true,
      disposition: 'trash' as const,
    }
    expect(sessionCatalogDeleteContract.responseSchema.safeParse(deletion).success)
      .toBe(true)
    expect(sessionCatalogDeleteContract.responseSchema.safeParse({
      ...deletion,
      sessionFile: '/Users/private/session.jsonl',
    }).success).toBe(false)
    expect(sessionCatalogDeleteContract.responseSchema.safeParse({
      ...deletion,
      disposition: 'unknown',
    }).success).toBe(false)
  })
})

describe('conversation navigation IPC schemas', () => {
  const projectlessScope = { kind: 'projectless' as const }

  it('keeps active scope and new-conversation requests path-free', () => {
    expect(conversationNavigationGetContract.requestSchema.safeParse({
      context: { requestId },
    }).success).toBe(true)
    expect(conversationNavigationGetContract.responseSchema.safeParse({
      revision: 1,
      activeScope: projectlessScope,
    }).success).toBe(true)
    expect(conversationNewContract.requestSchema.safeParse({
      context: { requestId },
      scope: projectlessScope,
    }).success).toBe(true)
    expect(conversationNewContract.requestSchema.safeParse({
      context: { requestId },
      scope: projectlessScope,
      confirmActiveRun: false,
    }).success).toBe(false)
    expect(conversationNewContract.requestSchema.safeParse({
      context: { requestId },
      scope: { ...projectlessScope, cwd: '/private/general-chat' },
    }).success).toBe(false)
  })
})

describe('workspace IPC schemas', () => {
  it('accepts only explicit workspace selection without legacy run-confirmation fields', () => {
    expect(workspaceChooseContract.requestSchema.safeParse({
      context: { requestId },
    }).success).toBe(true)
    expect(workspaceChooseContract.requestSchema.safeParse({
      context: { requestId },
      confirmActiveRun: true,
    }).success).toBe(false)
  })

  it('never accepts absolute paths in renderer-facing workspace snapshots', () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001'
    const snapshot = {
      revision: 1,
      currentId: workspaceId,
      current: {
        id: workspaceId,
        name: 'project',
        lastOpenedAt: '2026-08-07T00:00:00.000Z',
        pinned: false,
        available: true,
      },
      recent: [],
    }
    expect(workspaceGetContract.responseSchema.safeParse(snapshot).success).toBe(true)
    expect(workspaceGetContract.responseSchema.safeParse({
      ...snapshot,
      current: { ...snapshot.current, path: '/Users/private/project' },
    }).success).toBe(false)
  })

  it('requires active workspace removal to return projectless activation', () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001'
    const snapshot = { revision: 2, recent: [] }
    const activation = {
      scope: { kind: 'projectless' as const },
      sessionId: 'projectless-session',
      generation: 2,
    }

    expect(workspaceRemoveContract.requestSchema.safeParse({
      context: { requestId },
      workspaceId,
    }).success).toBe(true)
    expect(workspaceRemoveContract.requestSchema.safeParse({
      context: { requestId },
      workspaceId,
      path: '/Users/private/project',
    }).success).toBe(false)
    expect(workspaceRemoveContract.responseSchema.safeParse({
      activeRemoved: false,
      workspaceId,
      snapshot,
    }).success).toBe(true)
    expect(workspaceRemoveContract.responseSchema.safeParse({
      activeRemoved: true,
      workspaceId,
      snapshot,
      activation,
    }).success).toBe(true)
    expect(workspaceRemoveContract.responseSchema.safeParse({
      activeRemoved: true,
      workspaceId,
      snapshot,
    }).success).toBe(false)
    expect(workspaceRemoveContract.responseSchema.safeParse({
      activeRemoved: false,
      workspaceId,
      snapshot,
      activation,
    }).success).toBe(false)
  })

  it('accepts only canonical workspace-content read paths', () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001'
    expect(workspaceFilesListContract.requestSchema.safeParse({
      context: { requestId },
      workspaceId,
      path: 'src/components',
    }).success).toBe(true)
    for (const path of [
      '../private',
      '/Users/private',
      'src/../private',
      'src\\private',
      'src/bad\nname',
      'src/`bad-name',
    ]) {
      expect(workspaceFilesListContract.requestSchema.safeParse({
        context: { requestId },
        workspaceId,
        path,
      }).success).toBe(false)
    }

    expect(workspaceDiffReadContract.requestSchema.safeParse({
      context: { requestId },
      workspaceId,
      path: 'src/main.ts',
    }).success).toBe(true)
    expect(workspaceDiffReadContract.requestSchema.safeParse({
      context: { requestId },
      workspaceId,
      path: '../private',
    }).success).toBe(false)
  })

  it('keeps file preview and diff responses path-relative and bounded', () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001'
    const preview = {
      workspaceId,
      path: 'src/main.ts',
      kind: 'text' as const,
      size: 4,
      fingerprint: 'b'.repeat(64),
      content: 'text',
    }
    expect(workspaceFilePreviewContract.responseSchema.safeParse(preview).success).toBe(true)
    expect(workspaceFilePreviewContract.responseSchema.safeParse({
      ...preview,
      path: '/Users/private/main.ts',
    }).success).toBe(false)

    expect(workspaceDiffListContract.responseSchema.safeParse({
      workspaceId,
      gitAvailable: true,
      branch: 'main',
      truncated: false,
      files: [{
        path: 'src/main.ts',
        status: 'modified',
        added: 1,
        deleted: 1,
        binary: false,
      }],
    }).success).toBe(true)
    expect(workspaceDiffReadContract.responseSchema.safeParse({
      workspaceId,
      path: 'src/main.ts',
      status: 'modified',
      added: 1,
      deleted: 1,
      binary: false,
      patch: 'diff --git a/src/main.ts b/src/main.ts\n@@ -1 +1 @@\n-before\n+after\n',
      truncated: false,
    }).success).toBe(true)
    expect(workspaceDiffReadContract.responseSchema.safeParse({
      workspaceId,
      path: 'src/main.ts',
      status: 'modified',
      added: 1,
      deleted: 1,
      binary: false,
      patch: '',
      truncated: false,
      fingerprint: 'c'.repeat(64),
    }).success).toBe(false)
  })

  it('keeps workspace path search bounded and path-relative', () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001'
    expect(workspaceFilesSearchContract.requestSchema.safeParse({
      ...validRequest,
      workspaceId,
      query: 'component',
    }).success).toBe(true)
    expect(workspaceFilesSearchContract.responseSchema.safeParse({
      workspaceId,
      query: 'component',
      entries: [{ name: 'components', path: 'src/components', type: 'dir' }],
      truncated: false,
    }).success).toBe(true)
    expect(workspaceFilesSearchContract.responseSchema.safeParse({
      workspaceId,
      query: '',
      entries: [{ name: 'private', path: '/Users/private', type: 'dir' }],
      truncated: false,
    }).success).toBe(false)
  })
})

describe('terminal IPC schemas', () => {
  const workspaceId = '00000000-0000-4000-8000-000000000001'
  const terminalId = '00000000-0000-4000-8000-000000000002'
  const scope = { kind: 'project' as const, workspaceId }

  it('accepts only a typed scope, bounded dimensions, and input', () => {
    const create = {
      context: { requestId },
      scope,
      cols: 80,
      rows: 24,
    }
    expect(terminalCreateContract.requestSchema.safeParse(create).success).toBe(true)
    expect(terminalCreateContract.requestSchema.safeParse({
      ...create,
      cwd: '/Users/private',
    }).success).toBe(false)
    expect(terminalCreateContract.requestSchema.safeParse({
      ...create,
      cols: 501,
    }).success).toBe(false)
    expect(terminalResizeContract.requestSchema.safeParse({
      context: { requestId },
      scope,
      terminalId,
      cols: 91,
      rows: 17,
    }).success).toBe(true)
    expect(terminalInputContract.requestSchema.safeParse({
      context: { requestId },
      scope,
      terminalId,
      data: 'printf ok\\r',
    }).success).toBe(true)
    expect(terminalInputContract.requestSchema.safeParse({
      context: { requestId },
      scope,
      terminalId,
      data: 'x'.repeat(64 * 1024 + 1),
    }).success).toBe(false)
  })

  it('keeps terminal responses path-free and events correlated', () => {
    const session = {
      scope,
      terminalId,
      shell: 'zsh',
      cols: 80,
      rows: 24,
      replay: '',
      sequence: 0,
      reused: false,
    }
    expect(terminalCreateContract.responseSchema.safeParse(session).success).toBe(true)
    expect(terminalCreateContract.responseSchema.safeParse({
      ...session,
      cwd: '/Users/private/project',
    }).success).toBe(false)
    expect(terminalEventSchema.safeParse({
      type: 'data',
      eventId: requestId,
      scope,
      terminalId,
      sequence: 1,
      stream: 'pty',
      data: 'output',
      truncated: false,
    }).success).toBe(true)
    expect(terminalEventSchema.safeParse({
      type: 'exit',
      eventId: requestId,
      scope,
      terminalId,
      sequence: 2,
      exitCode: 0,
      absoluteCwd: '/Users/private/project',
    }).success).toBe(false)
  })
})

function darkSettingsForEvent() {
  return {
    locale: 'en-US',
    appearance: {
      theme: 'dark',
      uiFontFamily: '',
      monoFontFamily: '',
      uiFontSize: 14,
      codeFontSize: 13,
      density: 'compact',
      reducedMotion: false,
      codeLigatures: false,
      wordWrap: true,
      showLineNumbers: true,
      compactToolCards: true,
    },
    composer: {
      sendShortcut: 'enter',
    },
    terminal: {
      fontFamily: '',
      fontSize: 13,
    },
  }
}
