import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'
import { closeFixtureApplication } from './close-fixture-application'

test('settings preferences support search, custom fonts, reset confirmation and compact layouts', async ({}, testInfo) => {
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
    await page.waitForLoadState('domcontentloaded')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const navigation = page.getByRole('region', { name: 'Settings', exact: true })
    const search = navigation.getByRole('textbox', { name: 'Search settings…', exact: true })
    await search.fill('font')
    await expect(navigation.getByRole('button', { name: 'Appearance', exact: true })).toBeVisible()
    await expect(navigation.getByRole('button', { name: 'Terminal', exact: true })).toBeVisible()
    await expect(navigation.getByRole('button', { name: 'Models', exact: true })).toHaveCount(0)
    await search.press('ArrowDown')
    await expect(navigation.getByRole('button', { name: 'Appearance', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    const appearance = page.getByRole('main', { name: 'Appearance', exact: true })
    await expect(appearance.locator('[data-appearance-preview]')).toBeVisible()
    await appearance.getByRole('combobox', { name: 'UI font', exact: true }).click()
    await page.getByRole('option', { name: 'Custom…', exact: true }).click()
    const customUi = appearance.getByRole('textbox', { name: 'Custom UI font name', exact: true })
    await expect(customUi).toBeVisible()
    await customUi.fill('Example Sans')
    await expect.poll(() => page.evaluate(() => window.pipilot!.settings.get().then((result) => result.settings.appearance.uiFontFamily))).toBe('Example Sans')
    await expect(appearance.locator('[data-settings-save-status]')).toHaveAttribute('data-settings-save-status', 'saved')
    await appearance.getByRole('combobox', { name: 'Monospace font', exact: true }).click()
    await page.getByRole('option', { name: 'Custom…', exact: true }).click()
    await expect(appearance.getByRole('textbox', { name: 'Custom monospace font name', exact: true })).toBeVisible()
    await appearance.getByRole('textbox', { name: 'Custom monospace font name', exact: true }).fill('Example Mono')
    await appearance.getByRole('button', { name: 'Reset appearance settings', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(customUi).toHaveValue('Example Sans')
    await appearance.getByRole('button', { name: 'Reset appearance settings', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Reset', exact: true }).click()
    await expect(customUi).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => window.pipilot!.settings.get().then((result) => result.settings.appearance))).toEqual(DEFAULT_SETTINGS.appearance)
    await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'light', reducedMotion: true } }))

    await search.fill('not-a-setting')
    await expect(navigation.getByRole('status')).toHaveText('No matching settings. Try another keyword.')
    await navigation.getByRole('button', { name: 'Clear settings search' }).click()
    await expect(search).toBeFocused()
    await navigation.getByRole('button', { name: 'General', exact: true }).click()
    const general = page.getByRole('main', { name: 'General', exact: true })
    await general.getByRole('radio', { name: 'Ctrl/⌘ + Enter', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.pipilot!.settings.get().then((result) => result.settings.composer.sendShortcut))).toBe('mod-enter')
    await general.getByRole('radio', { name: 'Enter', exact: true }).click()
    await navigation.getByRole('button', { name: 'Terminal', exact: true }).click()
    const terminal = page.getByRole('main', { name: 'Terminal', exact: true })
    await terminal.getByRole('combobox', { name: 'Terminal font', exact: true }).click()
    await page.getByRole('option', { name: 'Fira Code', exact: true }).click()
    await expect(terminal.locator('[data-terminal-font-preview]')).toHaveAttribute('data-terminal-font-family', 'Fira Code')
    await terminal.getByRole('button', { name: 'Reset to defaults', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(terminal.locator('[data-terminal-font-preview]')).toHaveAttribute('data-terminal-font-family', 'Fira Code')
    await page.screenshot({ path: testInfo.outputPath('settings-terminal-light.png') })

    for (const section of ['general', 'language', 'about', 'appearance']) {
      await page.locator(`[data-context-panel-nav-id="${section}"]`).click()
      await page.locator(`[data-settings-section="${section}"]`).evaluate((element) => { element.scrollTop = 0 })
      await page.screenshot({ path: testInfo.outputPath(`settings-${section}-light.png`) })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((theme) => window.pipilot!.settings.update({ appearance: { theme, reducedMotion: true } }), theme)
      for (const size of [{ width: 1440, height: 900 }, { width: 1100, height: 680 }]) {
        await page.setViewportSize(size)
        await page.locator('[data-context-panel-nav-id="appearance"]').click()
        await page.locator('[data-settings-section="appearance"]').evaluate((element) => { element.scrollTop = 0 })
        await page.screenshot({ path: testInfo.outputPath(`settings-appearance-${theme}-${size.width}.png`) })
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      }
    }
    await page.setViewportSize({ width: 640, height: 760 })
    await expect(navigation).toBeVisible()
    await navigation.getByRole('button', { name: 'Appearance', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeFocused()
    await page.locator('[data-settings-section="appearance"]').evaluate((element) => { element.scrollTop = 0 })
    await page.screenshot({ path: testInfo.outputPath('settings-appearance-compact.png') })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
