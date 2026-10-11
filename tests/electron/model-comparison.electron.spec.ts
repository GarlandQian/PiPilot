import { execFile } from 'node:child_process'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { closeFixtureApplication } from './close-fixture-application'
import { startPiSdkFixture } from './pi-sdk-fixture'

const git = promisify(execFile)

test('compares two models in their own working copies, judges them, and applies the chosen changes', async ({}, testInfo) => {
  test.setTimeout(150_000)
  const userData = testInfo.outputPath('user-data'), agentDir = testInfo.outputPath('pi-agent'), projectPath = testInfo.outputPath('Answer project')
  await Promise.all([userData, projectPath].map((path) => mkdir(path, { recursive: true })))
  const run = (...args: string[]) => git('git', args, { cwd: projectPath })
  await run('init', '-b', 'main')
  await run('config', 'user.email', 'pipilot@example.invalid')
  await run('config', 'user.name', 'PiPilot fixture')
  await writeFile(join(projectPath, 'README.md'), '# Answer\n')
  await run('add', '.')
  await run('commit', '-m', 'start')
  const project = await realpath(projectPath)
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, settings: {
    ...DEFAULT_SETTINGS, locale: 'en-US', notifications: { desktop: false, sound: false } } }))
  const fixture = await startPiSdkFixture({
    agentDir,
    // Each model writes its own answer once, then replies.
    providerToolCall: ({ prompt, body }) => {
      const request = body as { model?: string; messages?: Array<{ role?: string }> }
      const messages = request.messages ?? []
      return prompt === 'Write the answer' && messages[messages.length - 1]?.role !== 'tool'
        ? { id: `write-${request.model}`, name: 'write', arguments: { path: 'answer.txt', content: `answer from ${request.model}\n` } } : null
    },
  })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' } })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await app.evaluate(({ dialog }, directory) => { Object.defineProperty(dialog, 'showOpenDialog', { configurable: true, value: async () => ({ canceled: false, filePaths: [directory] }) }) }, project)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).first().click()
    const composer = page.getByRole('textbox', { name: 'Message input', exact: true })
    await expect(composer).toBeEditable({ timeout: 20_000 })
    await composer.fill('Write the answer')

    await page.locator('[data-composer-root]').getByRole('button', { name: 'Add', exact: true }).click()
    await page.locator('[data-compare-models]').click()
    const sheet = page.locator('[data-compare-sheet]')
    await expect(sheet.getByRole('textbox', { name: 'Task' })).toHaveValue('Write the answer')
    await sheet.locator('[data-compare-model="fake-fast"]').getByRole('checkbox').click()
    await sheet.getByRole('switch', { name: 'Judge the results' }).click()
    await sheet.getByRole('button', { name: 'Start Comparison', exact: true }).click()

    const compare = page.locator('[data-comparison]')
    await expect(compare.locator('[data-comparison-run]')).toHaveCount(2, { timeout: 20_000 })
    for (const index of [0, 1]) {
      await expect(compare.locator(`[data-comparison-run="${index}"]`)).toHaveAttribute('data-comparison-status', 'done', { timeout: 60_000 })
      await expect(compare.locator(`[data-comparison-run="${index}"]`)).toContainText('1 files, +1 −0')
    }
    await expect(compare.locator('[data-comparison-judge="done"]')).toContainText('Fixture response', { timeout: 60_000 })
    // The project itself is untouched until a result is applied.
    await expect(readFile(join(project, 'answer.txt'), 'utf8')).rejects.toThrow()

    await compare.locator('[data-comparison-run="1"] [data-comparison-diff]').click()
    await expect(page.getByRole('dialog')).toContainText('+answer from fake-fast')
    await page.keyboard.press('Escape')
    await compare.locator('[data-comparison-run="1"] [data-comparison-apply]').click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Apply', exact: true }).click()
    await expect.poll(() => readFile(join(project, 'answer.txt'), 'utf8').catch(() => '')).toBe('answer from fake-fast\n')
    await expect(compare.locator('[data-comparison-run="1"]')).toContainText('Applied')
    await expect(page.locator('[data-sidebar-comparisons]')).toContainText('Write the answer')
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
