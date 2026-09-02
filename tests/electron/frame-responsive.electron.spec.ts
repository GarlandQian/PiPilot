import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'

test('keeps the compact conversation usable until Inspector is explicitly opened', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const userDataPath = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  await mkdir(userDataPath, { recursive: true })
  await writeFile(
    resolve(userDataPath, 'settings.json'),
    `${JSON.stringify({
      version: SETTINGS_SCHEMA_VERSION,
      settings: {
        ...DEFAULT_SETTINGS,
        locale: 'en-US',
      },
    }, null, 2)}\n`,
  )
  const piFixture = await startPiSdkFixture({ agentDir })
  const electronApp = await electron.launch({
    args: [resolve(process.cwd())],
    env: {
      ...process.env,
      ...piFixture.env,
      PIPILOT_E2E_DISABLE_AUTO_RESTART: '1',
      PIPILOT_E2E_USER_DATA: userDataPath,
    },
  })

  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.setViewportSize({ width: 1_440, height: 900 })
    await expect.poll(async () => {
      const status = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
      if (status.state === 'error' || status.state === 'crashed') {
        throw new Error(`Pi Runtime startup failed: ${JSON.stringify(status)}`)
      }
      return status.state
    }).toBe('ready')

    await expect(page.getByRole('button', { name: 'Collapse panel', exact: true }))
      .toBeVisible()
    await expect(page.getByRole('complementary', { name: 'Inspector', exact: true }))
      .toBeVisible()

    await expect(page.getByRole('button', { name: 'Activity', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Sessions', exact: true }))
      .toHaveAttribute('aria-current', 'page')

    await page.setViewportSize({ width: 640, height: 760 })
    const composer = page.getByRole('textbox', { name: 'Message input', exact: true })
    const openInspector = page.getByRole('button', { name: 'Expand panel', exact: true })
    await expect(page.getByRole('dialog', { name: 'Inspector', exact: true })).toHaveCount(0)
    await expect(composer).toBeVisible()
    await expect(openInspector).toBeVisible()

    await openInspector.focus()
    await openInspector.click()
    const inspectorDialog = page.getByRole('dialog', { name: 'Inspector', exact: true })
    await expect(inspectorDialog).toBeVisible()
    await inspectorDialog.getByRole('button', { name: 'Close panel', exact: true }).click()
    await expect(inspectorDialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Expand panel', exact: true }))
      .toBeFocused()
    await expect(composer).toBeVisible()

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settingsNavigation = page.getByRole('region', { name: 'Settings', exact: true })
    await expect(settingsNavigation).toBeVisible()
    await settingsNavigation.getByRole('button', { name: 'Models', exact: true }).click()
    await expect(page.getByRole('main', { name: 'Models', exact: true })).toBeVisible()
    await expect(settingsNavigation).toHaveCount(0)
    const settingsBack = page.getByRole('button', { name: 'Back', exact: true })
    await expect(settingsBack).toBeFocused()
    await settingsBack.click()
    await expect(settingsNavigation).toBeVisible()
    await expect(settingsNavigation.getByRole('button', { name: 'Models', exact: true }))
      .toBeFocused()

    await page.getByRole('button', { name: 'Sessions', exact: true }).click()
    await expect(composer).toBeVisible()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(settingsNavigation).toBeVisible()
    await expect(page.getByRole('main', { name: 'Models', exact: true })).toHaveCount(0)
  } finally {
    await electronApp.close()
    await piFixture.close()
  }
})
