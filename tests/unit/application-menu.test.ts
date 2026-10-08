import { describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { buildApplicationMenuTemplate } from '../../src/main/windows/application-menu'
import zhCN from '../../src/i18n/locales/zh-CN.json'
import enUS from '../../src/i18n/locales/en-US.json'

const labels = (items: readonly MenuItemConstructorOptions[]) => items.map((item) => item.label)
const submenu = (item: MenuItemConstructorOptions | undefined) => (item?.submenu ?? []) as MenuItemConstructorOptions[]

function build(overrides: Partial<Parameters<typeof buildApplicationMenuTemplate>[0]> = {}) {
  return buildApplicationMenuTemplate({
    messages: zhCN, appName: 'PiPilot', platform: 'darwin', fullScreen: false, development: false,
    issuesUrl: 'https://example.com/issues', onCommand: vi.fn(), onOpenExternal: vi.fn(), ...overrides,
  })
}

describe('application menu', () => {
  it('is fully in the app language, with the app menu first on macOS', () => {
    const menu = build()
    expect(labels(menu)).toEqual(['PiPilot', '文件', '编辑', '显示', '窗口', '帮助'])
    expect(labels(submenu(menu[0]))).toContain('退出 PiPilot')
    expect(labels(submenu(menu[2]))).toEqual(['撤销', '重做', undefined, '剪切', '拷贝', '粘贴', '粘贴并匹配样式', '删除', '全选'])
    expect(labels(build({ messages: enUS }))).toEqual(['PiPilot', 'File', 'Edit', 'View', 'Window', 'Help'])
    // Without an app menu elsewhere, Quit lives in File.
    expect(labels(build({ platform: 'win32' }))[0]).toBe('文件')
  })

  it('names the full-screen item by what it will do', () => {
    const fullScreenItem = (fullScreen: boolean) => submenu(build({ fullScreen })[3]).find((item) => item.role === 'togglefullscreen')
    expect(fullScreenItem(false)?.label).toBe('进入全屏幕')
    expect(fullScreenItem(true)?.label).toBe('退出全屏幕')
  })

  it('routes renderer actions and keeps developer items out of release builds', () => {
    const onCommand = vi.fn()
    const menu = build({ onCommand })
    const settings = submenu(menu[0]).find((item) => item.label === '设置…')
    settings?.click?.({} as never, undefined, {} as never)
    for (const label of ['新建任务', '新建聊天', '导入对话…']) {
      submenu(menu[1]).find((item) => item.label === label)?.click?.({} as never, undefined, {} as never)
    }
    expect(onCommand.mock.calls).toEqual([['open-settings'], ['new-task'], ['new-chat'], ['import-conversation']])
    expect(submenu(menu[1]).find((item) => item.label === '新建聊天')?.accelerator).toBe('Alt+CmdOrCtrl+N')
    expect(settings?.accelerator).toBe('CmdOrCtrl+,')
    expect(submenu(menu[3]).some((item) => item.role === 'toggleDevTools')).toBe(false)
    expect(submenu(build({ development: true })[3]).some((item) => item.role === 'toggleDevTools')).toBe(true)
  })
})
