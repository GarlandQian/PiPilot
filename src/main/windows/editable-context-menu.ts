import {
  Menu,
  type BrowserWindow,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron'

type EditableMenu = Pick<Electron.Menu, 'popup'>
type BuildMenu = (template: MenuItemConstructorOptions[]) => EditableMenu

interface EditableContextMenuDependencies {
  buildMenu?: BuildMenu
}

const installedMenus = new WeakMap<WebContents, () => void>()

export function buildEditableContextMenuTemplate(
  editFlags: ContextMenuParams['editFlags'],
): MenuItemConstructorOptions[] {
  const template: MenuItemConstructorOptions[] = [
    { role: 'undo', enabled: editFlags.canUndo },
    { role: 'redo', enabled: editFlags.canRedo },
    { type: 'separator' },
    { role: 'cut', enabled: editFlags.canCut },
    { role: 'copy', enabled: editFlags.canCopy },
    { role: 'paste', enabled: editFlags.canPaste },
  ]

  if (editFlags.canEditRichly) {
    template.push({
      role: 'pasteAndMatchStyle',
      enabled: editFlags.canPaste,
    })
  }

  template.push(
    { role: 'delete', enabled: editFlags.canDelete },
    { type: 'separator' },
    { role: 'selectAll', enabled: editFlags.canSelectAll },
  )

  return template
}

export function installEditableContextMenu(
  window: BrowserWindow,
  dependencies: EditableContextMenuDependencies = {},
) {
  const webContents = window.webContents
  const existing = installedMenus.get(webContents)
  if (existing) return existing

  const buildMenu = dependencies.buildMenu ?? ((template) => Menu.buildFromTemplate(template))
  let disposed = false

  const handleContextMenu = (
    _event: Electron.Event,
    params: ContextMenuParams,
  ) => {
    if (
      disposed ||
      !params.isEditable ||
      window.isDestroyed() ||
      webContents.isDestroyed()
    ) {
      return
    }

    buildMenu(buildEditableContextMenuTemplate(params.editFlags)).popup({ window })
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    webContents.removeListener('context-menu', handleContextMenu)
    webContents.removeListener('destroyed', dispose)
    if (installedMenus.get(webContents) === dispose) installedMenus.delete(webContents)
  }

  webContents.on('context-menu', handleContextMenu)
  webContents.once('destroyed', dispose)
  installedMenus.set(webContents, dispose)
  return dispose
}
