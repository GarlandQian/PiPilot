import { EventEmitter } from 'node:events'
import type {
  BrowserWindow,
  ContextMenuParams,
  WebContents,
} from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { buildFromTemplate } = vi.hoisted(() => ({
  buildFromTemplate: vi.fn(),
}))

vi.mock('electron', () => ({
  Menu: { buildFromTemplate },
}))

import {
  buildEditableContextMenuTemplate,
  installEditableContextMenu,
} from '../../src/main/windows/editable-context-menu'

function editFlags(
  overrides: Partial<ContextMenuParams['editFlags']> = {},
): ContextMenuParams['editFlags'] {
  return {
    canCopy: false,
    canCut: false,
    canDelete: false,
    canEditRichly: false,
    canPaste: false,
    canRedo: false,
    canSelectAll: false,
    canUndo: false,
    ...overrides,
  }
}

function contextMenuParams(
  overrides: Partial<ContextMenuParams> = {},
): ContextMenuParams {
  return {
    altText: '',
    dictionarySuggestions: [],
    editFlags: editFlags(),
    frame: null,
    frameCharset: 'UTF-8',
    frameURL: '',
    formControlType: 'none',
    hasImageContents: false,
    isEditable: true,
    linkText: '',
    linkURL: '',
    mediaFlags: {
      canLoop: false,
      canPrint: false,
      canRotate: false,
      canSave: false,
      canShowPictureInPicture: false,
      canToggleControls: false,
      hasAudio: false,
      inError: false,
      isControlsVisible: false,
      isLooping: false,
      isMuted: false,
      isPaused: false,
      isShowingPictureInPicture: false,
    },
    mediaType: 'none',
    menuSourceType: 'mouse',
    misspelledWord: '',
    pageURL: 'pipilot://app/',
    referrerPolicy: { policy: 'default', url: '' },
    selectionRect: { height: 0, width: 0, x: 0, y: 0 },
    selectionStartOffset: 0,
    selectionText: '',
    spellcheckEnabled: true,
    srcURL: '',
    suggestedFilename: '',
    titleText: '',
    x: 10,
    y: 20,
    ...overrides,
  }
}

function createWindow() {
  const webContents = new EventEmitter() as EventEmitter & {
    destroyed: boolean
    isDestroyed(): boolean
  }
  webContents.destroyed = false
  webContents.isDestroyed = () => webContents.destroyed
  type TestWindow = BrowserWindow & { destroyed: boolean }
  const window = {
    destroyed: false,
    isDestroyed: () => window.destroyed,
    webContents: webContents as unknown as WebContents,
  } as unknown as TestWindow
  return { webContents, window }
}

describe('editable context menu', () => {
  beforeEach(() => {
    buildFromTemplate.mockReset()
  })

  it('maps standard edit roles to the renderer edit flags in deterministic order', () => {
    const template = buildEditableContextMenuTemplate(editFlags({
      canCopy: true,
      canDelete: true,
      canPaste: true,
      canRedo: true,
      canSelectAll: true,
    }))

    expect(template).toEqual([
      { role: 'undo', enabled: false },
      { role: 'redo', enabled: true },
      { type: 'separator' },
      { role: 'cut', enabled: false },
      { role: 'copy', enabled: true },
      { role: 'paste', enabled: true },
      { role: 'delete', enabled: true },
      { type: 'separator' },
      { role: 'selectAll', enabled: true },
    ])
  })

  it.each([
    ['canUndo', 'undo'],
    ['canRedo', 'redo'],
    ['canCut', 'cut'],
    ['canCopy', 'copy'],
    ['canPaste', 'paste'],
    ['canDelete', 'delete'],
    ['canSelectAll', 'selectAll'],
  ] as const)('maps %s only to the %s role', (flag, role) => {
    const template = buildEditableContextMenuTemplate(editFlags({ [flag]: true }))
    const roleItems = template.filter((item) => item.type !== 'separator')

    expect(roleItems.find((item) => item.role === role)).toMatchObject({ enabled: true })
    for (const item of roleItems) {
      expect(item.enabled).toBe(item.role === role)
    }
  })

  it('adds Paste and Match Style only for a rich editable target', () => {
    expect(buildEditableContextMenuTemplate(editFlags({
      canEditRichly: true,
      canPaste: true,
    }))).toContainEqual({ role: 'pasteAndMatchStyle', enabled: true })
    expect(buildEditableContextMenuTemplate(editFlags({
      canEditRichly: true,
    }))).toContainEqual({ role: 'pasteAndMatchStyle', enabled: false })
    expect(buildEditableContextMenuTemplate(editFlags()))
      .not.toContainEqual(expect.objectContaining({ role: 'pasteAndMatchStyle' }))
  })

  it('opens for editable targets and leaves non-editable context menus untouched', () => {
    const popup = vi.fn()
    const buildMenu = vi.fn(() => ({ popup }))
    const { webContents, window } = createWindow()
    installEditableContextMenu(window, { buildMenu })

    webContents.emit('context-menu', {}, contextMenuParams({ isEditable: false }))
    expect(buildMenu).not.toHaveBeenCalled()

    const params = contextMenuParams({
      editFlags: editFlags({ canCopy: true, canSelectAll: true }),
    })
    webContents.emit('context-menu', {}, params)

    expect(buildMenu).toHaveBeenCalledWith(buildEditableContextMenuTemplate(params.editFlags))
    expect(popup).toHaveBeenCalledWith({ window })
  })

  it('builds the production menu through Electron', () => {
    const popup = vi.fn()
    buildFromTemplate.mockReturnValue({ popup })
    const { webContents, window } = createWindow()
    installEditableContextMenu(window)
    const params = contextMenuParams({
      editFlags: editFlags({ canPaste: true }),
    })

    webContents.emit('context-menu', {}, params)

    expect(buildFromTemplate).toHaveBeenCalledWith(
      buildEditableContextMenuTemplate(params.editFlags),
    )
    expect(popup).toHaveBeenCalledWith({ window })
  })

  it('installs once, disposes safely, and releases the registration on destruction', () => {
    const firstPopup = vi.fn()
    const firstBuildMenu = vi.fn(() => ({ popup: firstPopup }))
    const { webContents, window } = createWindow()
    const firstDispose = installEditableContextMenu(window, { buildMenu: firstBuildMenu })
    const duplicateDispose = installEditableContextMenu(window, {
      buildMenu: vi.fn(() => ({ popup: vi.fn() })),
    })

    expect(duplicateDispose).toBe(firstDispose)
    expect(webContents.listenerCount('context-menu')).toBe(1)
    firstDispose()
    firstDispose()
    expect(webContents.listenerCount('context-menu')).toBe(0)

    const secondPopup = vi.fn()
    installEditableContextMenu(window, {
      buildMenu: () => ({ popup: secondPopup }),
    })
    expect(webContents.listenerCount('context-menu')).toBe(1)
    webContents.emit('destroyed')
    expect(webContents.listenerCount('context-menu')).toBe(0)
    webContents.emit('context-menu', {}, contextMenuParams())
    expect(secondPopup).not.toHaveBeenCalled()
  })

  it('does not create or show a menu after the window or WebContents is destroyed', () => {
    const popup = vi.fn()
    const buildMenu = vi.fn(() => ({ popup }))
    const first = createWindow()
    installEditableContextMenu(first.window, { buildMenu })
    first.window.destroyed = true
    first.webContents.emit('context-menu', {}, contextMenuParams())

    const second = createWindow()
    installEditableContextMenu(second.window, { buildMenu })
    second.webContents.destroyed = true
    second.webContents.emit('context-menu', {}, contextMenuParams())

    expect(buildMenu).not.toHaveBeenCalled()
    expect(popup).not.toHaveBeenCalled()
  })
})
