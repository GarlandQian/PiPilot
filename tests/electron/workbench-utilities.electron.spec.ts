import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'
import { closeFixtureApplication } from './close-fixture-application'
import { selectInspectorView } from './select-inspector-view'

const run = promisify(execFile)

test('preserves file reading and PTY identity while navigating and refreshing workbench tools', async ({}, testInfo) => {
  test.skip(process.platform === 'win32', 'The deterministic terminal command uses the fixture POSIX shell.')
  test.setTimeout(75_000)
  const userData = testInfo.outputPath('user-data')
  const project = testInfo.outputPath('Workbench')
  const nested = join(project, 'src', 'nested')
  await mkdir(userData, { recursive: true })
  await mkdir(nested, { recursive: true })
  await writeFile(join(project, 'README.md'), '# Workbench\n\nStable reading.\n')
  await writeFile(join(nested, 'entry.ts'), 'export const ready = false\n')
  await run('git', ['init'], { cwd: project })
  await run('git', ['add', 'README.md', 'src/nested/entry.ts'], { cwd: project })
  await run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture'], { cwd: project })
  await writeFile(join(nested, 'entry.ts'), 'export const ready = true\n')
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, settings: {
    ...DEFAULT_SETTINGS, locale: 'en-US', appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true },
  } }))
  await writeFile(join(userData, 'pi-managed-packages.json'), JSON.stringify({ version: 1, mcpOptedOut: true }))
  const fixture = await startPiSdkFixture({ agentDir: testInfo.outputPath('pi-agent') })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: {
    ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1', PIPILOT_E2E_TERMINAL_SHELL: '/bin/sh',
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
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.localPi.runtime.status()).cwd)).toBe(project)
    const input = page.getByRole('textbox', { name: 'Message input', exact: true })
    await input.fill('Inspect this workspace')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('Fixture response: Inspect this workspace')
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)

    await selectInspectorView(page, 'Files')
    const tree = page.locator('[data-workspace-tree]')
    await tree.locator('[data-workspace-tree-row="src"]').click()
    await tree.locator('[data-workspace-tree-row="src/nested"]').click()
    const fileRow = tree.locator('[data-workspace-tree-row="src/nested/entry.ts"]')
    await expect(fileRow).toBeVisible()
    await tree.getByRole('button', { name: 'Refresh view', exact: true }).click()
    await expect(fileRow).toBeVisible()
    await expect(tree.locator('[data-workspace-tree-row="src/nested"]')).toHaveAttribute('aria-expanded', 'true')
    await fileRow.click()
    const fileSelector = page.locator('[data-workspace-file-viewer]:visible').getByRole('combobox', { name: 'Open files', exact: true })
    await expect(fileSelector).toHaveValue('src/nested/entry.ts')
    await fileSelector.selectOption('.')
    const search = tree.getByRole('textbox', { name: 'Search workspace files', exact: true })
    await search.fill('entry.ts')
    const searchRow = tree.locator('[data-workspace-search-row="src/nested/entry.ts"]')
    await expect(searchRow).toHaveAttribute('aria-current', 'true')
    await search.press('ArrowDown')
    await expect(searchRow).toBeFocused()
    await searchRow.press('Escape')
    await expect(search).toBeFocused()
    await tree.getByRole('button', { name: 'Clear file search', exact: true }).click()
    await expect(search).toBeFocused()
    await expect(fileRow).toBeVisible()

    await selectInspectorView(page, 'Changes')
    await page.getByRole('button', { name: 'Find a changed file', exact: true }).click()
    await page.getByRole('combobox', { name: 'Search changed files…', exact: true }).fill('entry.ts')
    await page.getByRole('option').filter({ hasText: 'src/nested/entry.ts' }).click()
    await expect(page.locator('[data-diff-path="src/nested/entry.ts"]')).toBeFocused()
    await expect(page.locator('[data-diff-path="src/nested/entry.ts"]')).not.toHaveAttribute('aria-busy', 'true')

    await selectInspectorView(page, 'Terminal')
    const drawer = page.locator('[data-terminal-drawer]')
    const terminal = page.locator('[data-terminal-id][data-terminal-status]:visible')
    await expect(terminal).toHaveAttribute('data-terminal-status', 'running')
    const before = await page.evaluate(async () => {
      const navigation = await window.pipilot!.conversation.get()
      const terminals = await window.pipilot!.terminal.list(navigation.activeScope)
      const terminal = terminals[0]
      if (!terminal || terminals.length !== 1) throw new Error('Expected one active terminal')
      return window.pipilot!.terminal.attach(navigation.activeScope, terminal.terminalId, terminal.cols, terminal.rows)
    })
    await page.locator('[data-terminal-workspace]:visible').getByRole('button', { name: 'Clear terminal display', exact: true }).click()
    const afterClear = await page.evaluate(async ({ scope, terminalId }) => {
      const terminal = (await window.pipilot!.terminal.list(scope)).find((candidate) => candidate.terminalId === terminalId)
      if (!terminal) throw new Error('Clearing removed the terminal')
      return window.pipilot!.terminal.attach(scope, terminalId, terminal.cols, terminal.rows)
    }, before)
    expect(afterClear.terminalId).toBe(before.terminalId)
    expect(afterClear.reused).toBe(true)
    const command = terminal.getByRole('textbox', { name: 'Interactive terminal input', exact: true })
    await command.focus()
    await command.pressSequentially('exit 0')
    await command.press('Enter')
    await expect(terminal).toHaveAttribute('data-terminal-status', 'exited')
    await drawer.getByRole('button', { name: 'More terminal actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Restart terminal', exact: true }).click()
    await expect(terminal).toHaveAttribute('data-terminal-status', 'running')
    const afterExit = await page.evaluate(async (scope) => {
      const terminals = await window.pipilot!.terminal.list(scope)
      const terminal = terminals.find((candidate) => candidate.status === 'running')
      if (!terminal || terminals.length !== 1) throw new Error('Restart must replace the exited terminal with one new shell')
      return window.pipilot!.terminal.attach(scope, terminal.terminalId, terminal.cols, terminal.rows)
    }, before.scope)
    expect(afterExit.terminalId).not.toBe(before.terminalId)
    await expect(page.locator(`[data-terminal-id="${before.terminalId}"][data-terminal-status]`))
      .toHaveCount(0)
    await expect(drawer.getByRole('tab')).toHaveCount(1)
    await page.setViewportSize({ width: 1100, height: 680 })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('workbench-utilities-light.png'), animations: 'disabled' })
    expect(errors).toEqual([])
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
