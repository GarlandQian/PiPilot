import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'
import { closeFixtureApplication } from './close-fixture-application'

const menuLabels = (app: ElectronApplication) => app.evaluate(({ Menu }) => {
  const menu = Menu.getApplicationMenu()
  return (menu?.items ?? []).map((item) => ({ label: item.label, items: item.submenu?.items.map((child) => child.label) ?? [] }))
})

test('menus follow the app language and full screen always has a way out', async ({}, testInfo) => {
  test.skip(process.platform !== 'darwin', 'Native full screen and the app menu are macOS behaviour.')
  test.setTimeout(90_000)
  const userDataPath = testInfo.outputPath('user-data')
  await mkdir(userDataPath, { recursive: true })
  await writeFile(resolve(userDataPath, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'zh-CN', appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true } },
  }))
  const fixture = await startPiSdkFixture({ agentDir: testInfo.outputPath('pi-agent') })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: {
    ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userDataPath, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1',
  } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    // The native menu bar speaks the app's language, not Electron's English default.
    await expect.poll(async () => (await menuLabels(app)).map((menu) => menu.label))
      .toEqual(['PiPilot', '文件', '编辑', '显示', '窗口', '帮助'])
    const view = async () => (await menuLabels(app)).find((menu) => menu.label === '显示' || menu.label === 'View')?.items ?? []
    expect(await view()).toContain('进入全屏幕')
    await page.evaluate(() => window.pipilot!.settings.update({ locale: 'en-US' }))
    await expect.poll(async () => (await menuLabels(app)).map((menu) => menu.label))
      .toEqual(['PiPilot', 'File', 'Edit', 'View', 'Window', 'Help'])

    // Full screen hides the window buttons; the title bar offers an exit and
    // drops the traffic-light inset, and the menu item now reads "Exit".
    // macOS ignores full-screen requests from a background app; bring it forward first.
    await app.evaluate(({ app, BrowserWindow }) => {
      app.focus({ steal: true })
      const window = BrowserWindow.getAllWindows()[0]
      window?.focus()
      window?.setFullScreen(true)
    })
    await expect(page.locator('html')).toHaveAttribute('data-fullscreen', 'true', { timeout: 15_000 })
    await expect.poll(view).toContain('Exit Full Screen')
    const exit = page.getByRole('button', { name: 'Exit Full Screen', exact: true })
    await expect(exit).toBeVisible()
    await exit.click()
    await expect(page.locator('html')).toHaveAttribute('data-fullscreen', 'false', { timeout: 15_000 })
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isFullScreen())).toBe(false)
    await expect(exit).toHaveCount(0)
    await expect.poll(view).toContain('Enter Full Screen')

    // Menu items whose action lives in the page reach it.
    await app.evaluate(({ Menu }) => {
      const app = Menu.getApplicationMenu()?.items[0]
      app?.submenu?.items.find((item) => item.label === 'Settings…')?.click()
    })
    await expect(page.getByRole('region', { name: 'Settings', exact: true })).toBeVisible()
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
