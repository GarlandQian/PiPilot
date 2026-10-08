import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'
import { closeFixtureApplication } from './close-fixture-application'

test('selects and resets the Pi directory while keeping the running session on its original directory', async ({}, testInfo) => {
  const userDataPath = testInfo.outputPath('user-data')
  const selected = testInfo.outputPath('选择的 Pi 配置')
  await mkdir(userDataPath, { recursive: true })
  await mkdir(selected, { recursive: true })
  await writeFile(resolve(userDataPath, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, settings: { ...DEFAULT_SETTINGS, locale: 'en-US' } }))
  const fixture = await startPiSdkFixture({ agentDir: testInfo.outputPath('pi-agent') })
  const app = await electron.launch({ args: [resolve('out/main/index.js')], env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userDataPath } })
  try {
    const page = await app.firstWindow()
    await page.waitForFunction(() => Boolean(window.pipilot))
    const before = await page.evaluate(() => window.pipilot!.settings.getPiDirectory())
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, selected)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settings = page.getByRole('region', { name: 'Settings', exact: true })
    await settings.getByRole('button', { name: 'General', exact: true }).click()
    const general = page.getByRole('main', { name: 'General', exact: true })
    await general.getByRole('button', { name: 'Choose folder…', exact: true }).click()
    await expect(general.getByText('Restart PiPilot to apply.', { exact: false })).toBeVisible()
    expect(await page.evaluate(() => window.pipilot!.settings.getPiDirectory())).toMatchObject({ activeDirectory: before.activeDirectory, selectedDirectory: selected, restartRequired: true })
    expect(JSON.parse(await readFile(resolve(userDataPath, 'pi-directory.json'), 'utf8')).directory).toBe(selected)
    await general.getByRole('button', { name: 'Use default', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.pipilot!.settings.getPiDirectory())).toMatchObject({ activeDirectory: before.activeDirectory, selectedDirectory: null, restartRequired: false })
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }) })
    await general.getByRole('button', { name: 'Choose folder…', exact: true }).click()
    expect((await page.evaluate(() => window.pipilot!.settings.getPiDirectory())).selectedDirectory).toBeNull()
  } finally { await closeFixtureApplication(app); await fixture.close() }
})
