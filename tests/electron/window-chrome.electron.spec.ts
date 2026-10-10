import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'
import { closeFixtureApplication } from './close-fixture-application'

const menuLabels = (app: ElectronApplication) => app.evaluate(({ Menu }) => {
  const menu = Menu.getApplicationMenu()
  return (menu?.items ?? []).map((item) => ({ label: item.label, items: item.submenu?.items.map((child) => child.label) ?? [] }))
})

async function expectCollapsedNavigationOutsideDragRegions(page: Page) {
  const rail = page.locator('[data-navigation-layout="rail"]')
  await expect(rail).toBeVisible()
  await expect(rail.getByRole('button', { name: 'Toggle context panel', exact: true })).toHaveAttribute('aria-expanded', 'false')

  // CDP clicks bypass the native macOS title-bar hit test. Also check the
  // geometry Electron receives: no real drag rectangle may cover the floating
  // controls, and each page must retain a usable drag region beside them.
  await expect.poll(() => page.evaluate(() => {
    const cluster = document.querySelector<HTMLElement>('[data-navigation-layout="rail"]')
    if (!cluster) return { draggablePage: false, conflicts: ['missing navigation'] }
    const clusterRect = cluster.getBoundingClientRect()
    const buttons = [...cluster.querySelectorAll<HTMLButtonElement>('button')]
      .filter((button) => button.checkVisibility())
    const conflicts: string[] = []
    let draggablePage = false
    const overlapsButton = (rect: { left: number; top: number; right: number; bottom: number }) => buttons.some((button) => {
      const target = button.getBoundingClientRect()
      return rect.left < target.right && rect.right > target.left && rect.top < target.bottom && rect.bottom > target.top
    })
    for (const button of buttons) {
      if (getComputedStyle(button).getPropertyValue('app-region') !== 'no-drag') {
        conflicts.push(`interactive drag: ${button.getAttribute('aria-label')}`)
      }
    }
    for (const element of document.querySelectorAll<HTMLElement>('body *')) {
      if (!element.checkVisibility()) continue
      const rect = element.getBoundingClientRect()
      if (!rect.width || !rect.height) continue
      if (getComputedStyle(element).getPropertyValue('app-region') === 'drag' && overlapsButton(rect)) {
        conflicts.push(`overlapping drag: ${element.tagName}.${element.className}`)
      }
      if (!element.classList.contains('titlebar-drag')) continue
      const before = getComputedStyle(element, '::before')
      if (before.getPropertyValue('app-region') !== 'drag') continue
      const left = rect.left + Number.parseFloat(before.left)
      const top = rect.top + Number.parseFloat(before.top)
      const width = Number.parseFloat(before.width)
      const height = Number.parseFloat(before.height)
      if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
        conflicts.push('invalid page drag rectangle')
        continue
      }
      draggablePage = true
      if (left < clusterRect.right - 0.5 || overlapsButton({ left, top, right: left + width, bottom: top + height })) {
        conflicts.push('page drag starts over navigation')
      }
    }
    return { draggablePage, conflicts }
  })).toEqual({ draggablePage: true, conflicts: [] })
}

test('collapsed macOS navigation stays outside native drag regions across pages and reloads', async ({}, testInfo) => {
  test.skip(process.platform !== 'darwin', 'The macOS inset title bar uses native draggable regions.')
  test.setTimeout(90_000)
  const userDataPath = testInfo.outputPath('user-data')
  await mkdir(userDataPath, { recursive: true })
  await writeFile(resolve(userDataPath, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US', appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true } },
  }))
  const fixture = await startPiSdkFixture({ agentDir: testInfo.outputPath('pi-agent') })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: {
    ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userDataPath, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1',
  } })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1_440, height: 900 })
    const toggle = page.getByRole('button', { name: 'Toggle context panel', exact: true })
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await toggle.click()
      await expectCollapsedNavigationOutsideDragRegions(page)
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      await expect(page.locator('[data-navigation-layout="sidebar"]')).toBeVisible()
    }

    await toggle.click()
    await expectCollapsedNavigationOutsideDragRegions(page)
    await page.reload()
    await expectCollapsedNavigationOutsideDragRegions(page)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Settings', exact: true })).toBeVisible()
    await toggle.click()
    await expectCollapsedNavigationOutsideDragRegions(page)
    await toggle.click()
    await expect(page.getByRole('region', { name: 'Settings', exact: true })).toBeVisible()
    await toggle.click()
    await expectCollapsedNavigationOutsideDragRegions(page)
    await page.getByRole('button', { name: 'Back to app', exact: true }).click()
    await expectCollapsedNavigationOutsideDragRegions(page)

    await page.getByRole('button', { name: 'Expand panel', exact: true }).click()
    const inspector = page.locator('[data-panel-dock="right"]')
    await expect(inspector).toBeVisible()
    await inspector.getByRole('button', { name: 'Full view', exact: true }).click()
    await expect(inspector).toHaveAttribute('data-panel-layout', 'full')
    await expectCollapsedNavigationOutsideDragRegions(page)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await toggle.click()
    await expectCollapsedNavigationOutsideDragRegions(page)
    await inspector.getByRole('button', { name: 'Exit full view', exact: true }).click()
    await toggle.click()
    await expect(page.locator('[data-navigation-layout="sidebar"]')).toBeVisible()
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
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
