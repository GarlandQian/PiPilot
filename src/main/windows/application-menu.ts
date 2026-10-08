import type { MenuItemConstructorOptions } from 'electron'
import type { AppCommand } from '../../shared/ipc/contracts'

export interface ApplicationMenuOptions {
  /** UI messages for the current locale (the renderer's locale files). */
  messages: Readonly<Record<string, string>>
  appName: string
  platform: NodeJS.Platform
  fullScreen: boolean
  development: boolean
  issuesUrl: string
  onCommand(command: AppCommand): void
  onOpenExternal(url: string): void
}

/**
 * The native menu bar, in the app's language. macOS only localizes standard
 * menus for apps that ship .lproj resources, so every label is set here, and
 * the full-screen item names what it will do (Enter / Exit), like native apps.
 */
export function buildApplicationMenuTemplate(options: ApplicationMenuOptions): MenuItemConstructorOptions[] {
  const t = (key: string, name = options.appName) => (options.messages[key] ?? key).replace('{app}', name)
  const mac = options.platform === 'darwin'
  const separator: MenuItemConstructorOptions = { type: 'separator' }

  const appMenu: MenuItemConstructorOptions = {
    label: options.appName,
    submenu: [
      { role: 'about', label: t('menu.app.about') },
      separator,
      { label: t('menu.app.settings'), accelerator: 'CmdOrCtrl+,', click: () => options.onCommand('open-settings') },
      separator,
      { role: 'services', label: t('menu.app.services') },
      separator,
      { role: 'hide', label: t('menu.app.hide') },
      { role: 'hideOthers', label: t('menu.app.hideOthers') },
      { role: 'unhide', label: t('menu.app.showAll') },
      separator,
      { role: 'quit', label: t('menu.app.quit') },
    ],
  }
  const fileMenu: MenuItemConstructorOptions = {
    label: t('menu.file'),
    submenu: [
      { label: t('menu.file.newTask'), accelerator: 'CmdOrCtrl+N', click: () => options.onCommand('new-task') },
      { label: t('menu.file.newChat'), accelerator: 'Alt+CmdOrCtrl+N', click: () => options.onCommand('new-chat') },
      separator,
      { label: t('menu.file.import'), click: () => options.onCommand('import-conversation') },
      separator,
      // Codex: ⌘W closes the tab in front, and the window once no tab is left.
      { label: t('menu.file.closeTab'), accelerator: 'CmdOrCtrl+W', click: () => options.onCommand('close-tab') },
      ...(mac ? [{ role: 'close', label: t('menu.file.closeWindow'), accelerator: 'Shift+Cmd+W' }] satisfies MenuItemConstructorOptions[] : []),
      ...(mac ? [] : [separator, { role: 'quit', label: t('menu.app.quit') }] satisfies MenuItemConstructorOptions[]),
    ],
  }
  const editMenu: MenuItemConstructorOptions = {
    label: t('menu.edit'),
    submenu: [
      { role: 'undo', label: t('menu.edit.undo') },
      { role: 'redo', label: t('menu.edit.redo') },
      separator,
      { role: 'cut', label: t('menu.edit.cut') },
      { role: 'copy', label: t('menu.edit.copy') },
      { role: 'paste', label: t('menu.edit.paste') },
      { role: 'pasteAndMatchStyle', label: t('menu.edit.pasteAndMatchStyle') },
      { role: 'delete', label: t('menu.edit.delete') },
      { role: 'selectAll', label: t('menu.edit.selectAll') },
    ],
  }
  const viewMenu: MenuItemConstructorOptions = {
    label: t('menu.view'),
    submenu: [
      ...(options.development ? [
        { role: 'reload', label: t('menu.view.reload') },
        { role: 'toggleDevTools', label: t('menu.view.developerTools') },
        separator,
      ] satisfies MenuItemConstructorOptions[] : []),
      { role: 'resetZoom', label: t('menu.view.actualSize') },
      { role: 'zoomIn', label: t('menu.view.zoomIn') },
      { role: 'zoomOut', label: t('menu.view.zoomOut') },
      separator,
      { role: 'togglefullscreen', label: t(options.fullScreen ? 'menu.view.exitFullScreen' : 'menu.view.enterFullScreen') },
    ],
  }
  const windowMenu: MenuItemConstructorOptions = {
    label: t('menu.window'),
    role: 'windowMenu',
    submenu: [
      { role: 'minimize', label: t('menu.window.minimize') },
      { role: 'zoom', label: t('menu.window.zoom') },
      ...(mac ? [separator, { role: 'front', label: t('menu.window.front') }] satisfies MenuItemConstructorOptions[] : []),
    ],
  }
  const helpMenu: MenuItemConstructorOptions = {
    label: t('menu.help'),
    role: 'help',
    submenu: [
      { label: t('menu.help.reportIssue'), click: () => options.onOpenExternal(options.issuesUrl) },
    ],
  }
  return [...(mac ? [appMenu] : []), fileMenu, editMenu, viewMenu, windowMenu, helpMenu]
}
