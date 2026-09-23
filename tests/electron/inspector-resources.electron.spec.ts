import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { closeFixtureApplication } from './close-fixture-application'
import { startPiSdkFixture } from './pi-sdk-fixture'

const run = promisify(execFile)

test('links project files with every uncommitted stage and refreshes without replacing the reader', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userData = testInfo.outputPath('user-data')
  const project = testInfo.outputPath('Resource project')
  await mkdir(userData, { recursive: true })
  await mkdir(join(project, 'src', 'nested'), { recursive: true })
  const fixtureDocument = (value: string) => `# Project notes\n\n${Array.from({ length: 90 }, (_, index) => `Paragraph ${index + 1}. Stable reading context.`).join('\n\n')}\n\n${value}\n`
  await writeFile(join(project, 'README.md'), fixtureDocument('Committed content.'))
  await writeFile(join(project, 'src', 'nested', 'entry.ts'), 'export const value = 1\n')
  await run('git', ['init'], { cwd: project })
  await run('git', ['add', '.'], { cwd: project })
  await run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture'], { cwd: project })
  await writeFile(join(project, 'README.md'), fixtureDocument('Staged content.'))
  await run('git', ['add', 'README.md'], { cwd: project })
  await writeFile(join(project, 'README.md'), fixtureDocument('Working content.'))
  await writeFile(join(project, 'src', 'nested', 'entry.ts'), 'export const value = 2\n')
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, settings: {
    ...DEFAULT_SETTINGS, locale: 'en-US', appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true },
  } }))
  await writeFile(join(userData, 'pi-managed-packages.json'), JSON.stringify({ version: 1, mcpOptedOut: true }))
  const fixture = await startPiSdkFixture({ agentDir: testInfo.outputPath('pi-agent') })
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
    const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true })
    await expect(inspector.getByRole('tab')).toHaveCount(2)
    await expect(inspector.getByText('Resource project', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('log', { name: 'Conversation' }).locator('[data-conversation-question]')).toHaveCount(0)
    const tree = inspector.locator('[data-workspace-tree]')
    await tree.locator('[data-workspace-tree-row="src"]').click()
    await tree.locator('[data-workspace-tree-row="src/nested"]').click()
    await tree.locator('[data-workspace-tree-row="README.md"]').click()
    const reader = inspector.locator('[data-workspace-file-viewer]:visible')
    await expect(reader.getByRole('heading', { name: 'Project notes', exact: true })).toBeVisible()
    await expect(reader).toContainText('Working content.')
    const scroll = reader.locator('.overflow-y-auto:visible').last()
    await scroll.evaluate((element) => { element.scrollTop = 420 })
    const readerNode = await reader.elementHandle()
    const before = await scroll.evaluate((element) => element.scrollTop)
    expect(before).toBeGreaterThan(100)

    // Actual external writes must appear without pressing Refresh or losing position.
    await writeFile(join(project, 'README.md'), fixtureDocument('Updated while reading.'))
    await expect(reader).toContainText('Updated while reading.', { timeout: 12_000 })
    expect(await scroll.evaluate((element) => element.scrollTop)).toBeGreaterThanOrEqual(before - 1)
    expect(await readerNode!.evaluate((element) => element.isConnected)).toBe(true)
    await reader.getByRole('button', { name: 'View changes to this file', exact: true }).click()
    const staged = inspector.locator('[data-diff-id="staged:README.md"]')
    const unstaged = inspector.locator('[data-diff-id="unstaged:README.md"]')
    await expect(staged).toBeVisible()
    await expect(unstaged).toBeVisible()
    await expect(staged).toContainText('Staged')
    await expect(unstaged).toContainText('Unstaged')
    await expect(unstaged).toBeFocused()
    await expect(unstaged).not.toHaveAttribute('aria-busy', 'true')
    await unstaged.getByRole('button', { name: 'Open current file', exact: true }).click()
    await expect(reader.getByRole('combobox', { name: 'Open files', exact: true })).toHaveValue('README.md')
    expect(await scroll.evaluate((element) => element.scrollTop)).toBeGreaterThanOrEqual(before - 1)
    await reader.getByRole('combobox', { name: 'Open files', exact: true }).selectOption('.')
    await expect(tree.locator('[data-workspace-tree-row="src/nested/entry.ts"]')).toBeVisible()
    await expect(tree.locator('[data-workspace-tree-row="src/nested"]')).toHaveAttribute('aria-expanded', 'true')

    await inspector.getByRole('tab', { name: 'Changes', exact: true }).click()
    await writeFile(join(project, 'new-file.txt'), 'A newly created file.\n')
    await expect(inspector.locator('[data-diff-id="unstaged:new-file.txt"]')).toBeVisible({ timeout: 12_000 })
    await page.screenshot({ path: testInfo.outputPath('project-changes-light-wide.png'), animations: 'disabled' })
    await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'dark' } }))
    await page.screenshot({ path: testInfo.outputPath('project-changes-dark-wide.png'), animations: 'disabled' })
    await page.setViewportSize({ width: 1100, height: 680 })
    await page.getByRole('button', { name: 'Expand panel', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Inspector', exact: true })
    await expect(dialog.getByRole('tab', { name: 'Changes', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('project-changes-dark-minimum.png'), animations: 'disabled' })
    await dialog.getByRole('button', { name: 'Close panel', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Expand panel', exact: true })).toBeFocused()
    expect(errors).toEqual([])
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
