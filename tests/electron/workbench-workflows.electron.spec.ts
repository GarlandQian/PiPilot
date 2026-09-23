import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'
import { closeFixtureApplication } from './close-fixture-application'
import { selectInspectorView } from './select-inspector-view'

test('connects project actions, conversation navigation and resource views without stopping background work', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const userData = testInfo.outputPath('user-data')
  const project = testInfo.outputPath('Canvas')
  await mkdir(userData, { recursive: true })
  await mkdir(project, { recursive: true })
  await writeFile(join(project, 'README.md'), '# Canvas\n\nA temporary workspace.\n')
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, settings: {
    ...DEFAULT_SETTINGS, locale: 'en-US', appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true },
  } }))
  await writeFile(join(userData, 'pi-managed-packages.json'), JSON.stringify({ version: 1, mcpOptedOut: true }))
  const fixture = await startPiSdkFixture({ agentDir: testInfo.outputPath('pi-agent'), completionDelays: { 'Run background review': 6_000 } })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: {
    ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1',
  } })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    const input = page.getByRole('textbox', { name: 'Message input', exact: true })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await expect(page.locator('[data-conversation-welcome]')).toBeVisible()
    await page.getByRole('button', { name: 'Start writing', exact: true }).click()
    await expect(input).toBeFocused()
    await page.screenshot({ path: testInfo.outputPath('workbench-welcome-light.png'), animations: 'disabled' })
    await app.evaluate(({ dialog }, directory) => {
      Object.defineProperty(dialog, 'showOpenDialog', { configurable: true, value: async () => ({ canceled: false, filePaths: [directory] }) })
    }, project)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.localPi.runtime.status()).cwd)).toBe(project)
    for (const prompt of ['First project inspection', 'Second project inspection', 'Third project inspection']) {
      await input.fill(prompt)
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(page.getByRole('log', { name: 'Conversation' })).toContainText(`Fixture response: ${prompt}`)
      await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    }
    await page.evaluate(() => window.pipilot!.localPi.runtime.command({ type: 'set_session_name', name: 'Workspace review' }))
    const projectTasks = page.getByRole('region', { name: 'Projects', exact: true })
    await expect(projectTasks.getByRole('button', { name: 'Workspace review', exact: true })).toBeVisible()
    await selectInspectorView(page, 'Files')
    await page.getByRole('button', { name: 'README.md', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'README.md', exact: true })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: 'Navigate conversation', exact: true }).click()
    await page.getByRole('combobox', { name: 'Find a turn…', exact: true }).fill('First project')
    await page.getByRole('option').filter({ hasText: 'First project inspection' }).click()
    await expect(page.locator('[data-outline-highlighted="true"]')).toContainText('First project inspection')
    await expect(page.getByRole('tab', { name: 'README.md', exact: true })).toHaveAttribute('aria-selected', 'true')
    await page.screenshot({ path: testInfo.outputPath('workbench-reading-light.png'), animations: 'disabled' })
    await page.getByRole('button', { name: 'View changes', exact: true }).click()
    await expect(page.locator('[data-inspector-view="diff"]')).toBeVisible()
    await selectInspectorView(page, 'Files')
    await expect(page.getByRole('tab', { name: 'README.md', exact: true })).toHaveAttribute('aria-selected', 'true')
    const search = page.getByRole('textbox', { name: 'Search sessions', exact: true })
    await search.fill('absent title')
    await expect(projectTasks.getByRole('button', { name: 'Workspace review', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Clear search', exact: true }).click()
    await expect(projectTasks.getByRole('button', { name: 'Workspace review', exact: true })).toBeVisible()
    await input.fill('Run background review')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'New session in Canvas', exact: true }).click()
    await expect(page.locator('[data-conversation-welcome]')).toBeVisible()
    await page.getByRole('button', { name: 'Running', exact: true }).click()
    await expect(projectTasks.getByRole('button', { name: 'Workspace review', exact: true })).toBeVisible()
    await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'dark' } }))
    await page.setViewportSize({ width: 1100, height: 680 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('workbench-background-dark.png'), animations: 'disabled' })
    await expect(page.getByText('No sessions are running', { exact: true })).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: 'All', exact: true }).click()
    await projectTasks.getByRole('button', { name: 'Workspace review', exact: true }).click()
    await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('Fixture response: Run background review')
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
