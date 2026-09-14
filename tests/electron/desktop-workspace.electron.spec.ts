import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { closeFixtureApplication } from './close-fixture-application'
import { startPiSdkFixture } from './pi-sdk-fixture'

test('keeps the unified desktop workspace usable with the official Pi configuration', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const project = testInfo.outputPath('Workspace')
  await mkdir(userData, { recursive: true })
  await mkdir(project, { recursive: true })
  await writeFile(join(userData, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US', appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true } },
  }))
  await writeFile(join(userData, 'pi-managed-packages.json'), JSON.stringify({ version: 1, mcpOptedOut: true }))
  await writeFile(join(project, 'README.md'), '# Desktop workspace\n\nAn isolated visual fixture.\n')
  const prompt = 'Review **the workspace**\n\n## Implementation\n\n- Keep Pi configuration in its official directory.\n- Preserve background conversations.\n\n```ts\nconst status = "ready"\n```'
  const runningPrompt = 'Continue checking the workspace'
  const fixture = await startPiSdkFixture({
    agentDir,
    includeReasoningModel: true,
    completionDelays: { [runningPrompt]: 4_000 },
  })
  const app = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' },
  })
  try {
    const page = await app.firstWindow()
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    const paths = await page.evaluate(async () => ({
      models: (await window.pipilot!.modelsConfig.load({ kind: 'global' })).path,
      mcp: (await window.pipilot!.mcpConfig.load({ kind: 'global' })).path,
    }))
    expect(paths).toEqual({ models: join(agentDir, 'models.json'), mcp: join(agentDir, 'mcp.json') })
    await app.evaluate(({ dialog }, directory) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [directory] }),
      })
    }, project)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.localPi.runtime.status()).cwd)).toBe(project)
    const input = page.getByRole('textbox', { name: 'Message input', exact: true })
    await input.fill(prompt)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('Fixture response:')
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await page.evaluate(() => window.pipilot!.localPi.runtime.command({ type: 'set_session_name', name: 'Desktop workspace review' }))
    await expect(page.getByRole('button', { name: 'Desktop workspace review', exact: true })).toBeVisible()

    const question = page.locator('[data-conversation-question]').first()
    const answer = page.locator('.conversation-answer-content').first()
    await question.getByRole('button', { name: 'Read full message', exact: true }).click()
    await expect(question.locator('strong')).toHaveText('the workspace')
    await expect(question.getByRole('heading', { name: 'Implementation', exact: true })).toBeVisible()
    await expect(question.locator('li')).toHaveCount(2)
    await expect(question.locator('pre')).toContainText('const status = "ready"')
    await expect(answer.getByRole('heading', { name: 'Implementation', exact: true })).toBeVisible()
    await expect(page.getByText('YOU', { exact: true })).toHaveCount(0)

    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((theme) => window.pipilot!.settings.update({ appearance: { theme } }), theme)
      await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark'))).toBe(theme === 'dark')
      for (const width of [1440, 1100]) {
        await page.setViewportSize({ width, height: width === 1100 ? 680 : 900 })
        await expect(page.locator('[data-navigation-layout="sidebar"]')).toBeVisible()
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await expect.poll(() => page.locator('[data-composer-surface]').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
        // Resizing also changes Inspector visibility and scrollbar width.
        // Measure both elements in one layout, then await responsive settlement.
        await expect.poll(() => page.evaluate(() => {
          const question = document.querySelector('[data-conversation-question]')?.getBoundingClientRect()
          const answer = document.querySelector('.conversation-answer-content')?.getBoundingClientRect()
          return {
            inset: Boolean(question && answer && question.left > answer.left + 10),
            aligned: Boolean(question && answer && Math.abs(question.right - answer.right) < 0.5),
          }
        })).toEqual({ inset: true, aligned: true })
        await page.mouse.move(width - 10, 10)
        await page.screenshot({ path: testInfo.outputPath(`desktop-${theme}-${width}.png`), animations: 'disabled' })
      }
    }

    await page.getByRole('button', { name: 'Toggle context panel', exact: true }).click()
    await expect(page.locator('[data-navigation-layout="rail"]')).toBeVisible()
    await expect(input).toBeVisible()
    await page.getByRole('button', { name: 'Toggle context panel', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Desktop workspace review', exact: true })).toBeVisible()

    await input.fill('@')
    await expect(page.getByRole('listbox')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('desktop-mentions.png'), animations: 'disabled' })
    await input.press('Escape')
    await input.fill('/')
    await expect(page.getByRole('listbox')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('desktop-commands.png'), animations: 'disabled' })
    await input.press('Escape')
    await input.press('ControlOrMeta+A')
    await input.press('Backspace')
    await expect(input).toHaveText('')
    await page.locator('[data-model-thinking-trigger]').click()
    await expect(page.getByRole('combobox')).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('desktop-models.png'), animations: 'disabled' })
    await page.keyboard.press('Escape')

    await input.fill(runningPrompt)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await input.fill('Check the final result')
    await page.locator('[data-composer-submit="queue"]').click()
    await expect(page.locator('[data-pending-message-rail]')).toContainText('Check the final result')
    await page.screenshot({ path: testInfo.outputPath('desktop-queue.png'), animations: 'disabled' })
    await expect.poll(() => fixture.prompts.includes('Check the final result')).toBe(true)
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    expect(pageErrors).toEqual([])
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
