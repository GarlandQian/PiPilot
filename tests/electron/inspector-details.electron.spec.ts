import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { closeFixtureApplication } from './close-fixture-application'
import { inspectorDetailsSessionEntries } from './inspector-details-fixture'
import { startPiSdkFixture } from './pi-sdk-fixture'

async function sendWithoutChangingResource(page: Page, prompt: string, resource: Locator) {
  await page.getByRole('textbox', { name: 'Message input', exact: true }).fill(prompt)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(resource).toBeVisible()
  await expect(page.getByRole('log', { name: 'Conversation', exact: true }))
    .toContainText(`Fixture response: ${prompt}`)
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  await expect(resource).toBeVisible()
}

test('returns from execution details to the same Markdown reader and keeps compact Back distinct from Close', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userData = testInfo.outputPath('user-data')
  const project = testInfo.outputPath('Detail project')
  const agentDir = testInfo.outputPath('pi-agent')
  await Promise.all([mkdir(userData, { recursive: true }), mkdir(project, { recursive: true })])
  await writeFile(join(project, 'README.md'), '# Reading context\n\n' + Array.from({ length: 90 },
    (_, index) => `Paragraph ${index + 1}. Preserve this project reading position.`).join('\n\n') + '\n')
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, settings: {
    ...DEFAULT_SETTINGS, locale: 'en-US', appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true },
  } }))
  await writeFile(join(userData, 'pi-managed-packages.json'), JSON.stringify({ version: 1, mcpOptedOut: true }))
  const canonicalProject = await realpath(project)
  const sessionDirectory = join(agentDir, 'sessions', `--${canonicalProject.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`)
  await mkdir(sessionDirectory, { recursive: true })
  await writeFile(join(sessionDirectory, 'inspector-details.jsonl'),
    inspectorDetailsSessionEntries(canonicalProject).map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  const fixture = await startPiSdkFixture({ agentDir })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: {
    ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1',
  } })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await app.evaluate(({ dialog }, directory) => {
      Object.defineProperty(dialog, 'showOpenDialog', { configurable: true, value: async () => ({ canceled: false, filePaths: [directory] }) })
    }, project)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
    await page.getByRole('button', { name: 'Existing project session', exact: true }).click()
    const transcript = page.getByRole('log', { name: 'Conversation', exact: true })
    const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true })
    const resourceTabs = inspector.locator('[data-inspector-views] > header').getByRole('tab', { includeHidden: true })
    await expect(resourceTabs).toHaveText(['Files', 'Changes'])
    await inspector.locator('[data-workspace-tree-row="README.md"]').click()
    const reader = inspector.locator('[data-workspace-file-viewer]:visible')
    await expect(reader.getByRole('heading', { name: 'Reading context', exact: true })).toBeVisible()
    const readerHandle = await reader.elementHandle()
    const scroll = reader.locator('.overflow-y-auto:visible').last()
    await scroll.evaluate((element) => { element.scrollTop = 480 })
    const before = await scroll.evaluate((element) => element.scrollTop)
    expect(before).toBeGreaterThan(100)
    const expectReaderRestored = async () => {
      await expect(reader).toBeVisible()
      await expect(reader.getByRole('combobox', { name: 'Open files', exact: true })).toHaveValue('README.md')
      await expect(resourceTabs).toHaveText(['Files', 'Changes'])
      expect(await readerHandle!.evaluate((element) => element.isConnected)).toBe(true)
      expect(await scroll.evaluate((element) => element.scrollTop)).toBeGreaterThanOrEqual(before - 1)
    }

    const subagentEntry = transcript.locator('[data-subagent-call-id="fixture-subagent-call"]')
    await subagentEntry.click()
    const subagent = inspector.locator('[data-subagent-execution-panel="fixture-subagent-call"]')
    await expect(subagent).toBeVisible()
    await expect(inspector.getByRole('tablist', { name: 'Switch inspector view', exact: true })).toHaveCount(0)
    await expect(resourceTabs).toHaveText(['Files', 'Changes'])
    await sendWithoutChangingResource(page, 'Keep the child detail selected', subagent)
    await inspector.getByRole('button', { name: 'Back to project resources', exact: true }).click()
    await expectReaderRestored()
    await expect(inspector.getByRole('tab', { name: 'Files', exact: true })).toBeFocused()

    const shell = transcript.locator('[data-tool-kind="shell"]').filter({ hasText: 'pnpm test' })
    await shell.getByRole('button').first().click()
    const commandEntry = shell.getByRole('button', { name: 'Open output in workspace', exact: true })
    await commandEntry.click()
    const command = inspector.locator('[data-command-execution-panel]')
    await expect(command.getByRole('heading', { name: 'Checks', exact: true })).toBeVisible()
    await expect(resourceTabs).toHaveText(['Files', 'Changes'])
    await sendWithoutChangingResource(page, 'Keep the command detail selected', command)
    await command.focus()
    await command.press('Escape')
    await expectReaderRestored()
    await expect(inspector.getByRole('tab', { name: 'Files', exact: true })).toBeFocused()
    await sendWithoutChangingResource(page, 'Keep the project reader selected', reader)
    await expectReaderRestored()
    await page.screenshot({ path: testInfo.outputPath('details-return-to-markdown-light.png'), animations: 'disabled' })

    await page.setViewportSize({ width: 1100, height: 680 })
    await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'dark' } }))
    const drawer = page.getByRole('dialog', { name: 'Inspector', exact: true })
    await expect(drawer).toHaveCount(0)
    for (const [entry, detail] of [[subagentEntry, subagent], [commandEntry, command]] as const) {
      await entry.click()
      await expect(drawer).toBeVisible()
      await expect(detail).toBeVisible()
      await expect(resourceTabs).toHaveText(['Files', 'Changes'])
      await drawer.getByRole('button', { name: 'Back to project resources', exact: true }).click()
      await expect(drawer).toBeVisible()
      await expectReaderRestored()
      await expect(drawer.getByRole('tab', { name: 'Files', exact: true })).toBeFocused()
      await drawer.getByRole('button', { name: 'Close panel', exact: true }).click()
      await expect(drawer).toHaveCount(0)
      await expect(entry).toBeFocused()
    }
    await commandEntry.click()
    await expect(command).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('command-detail-dark-minimum.png'), animations: 'disabled' })
    await drawer.getByRole('button', { name: 'Close panel', exact: true }).click()
    await expect(drawer).toHaveCount(0)
    await expect(commandEntry).toBeFocused()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
