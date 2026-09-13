import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { closeFixtureApplication } from './close-fixture-application'
import { startPiSdkFixture } from './pi-sdk-fixture'

test('edits and tests models through the provider workspace without losing the authoritative draft', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  await mkdir(userData, { recursive: true })
  await writeFile(join(userData, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US', appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true } },
  }))
  await writeFile(join(userData, 'pi-managed-packages.json'), JSON.stringify({ version: 1, mcpOptedOut: true }))
  const fixture = await startPiSdkFixture({ agentDir, includeReasoningModel: true })
  const modelPath = join(agentDir, 'models.json')
  const initial = JSON.parse(await readFile(modelPath, 'utf8'))
  initial.providers.secondary = { ...initial.providers.fixture, name: 'Secondary Gateway', models: [{ id: 'secondary-model', name: 'Secondary Model' }] }
  await writeFile(modelPath, JSON.stringify(initial, null, 2))
  const app = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' },
  })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('[data-context-panel-nav-id="models"]').click()
    const main = page.getByRole('main', { name: 'Models', exact: true })
    const workspace = main.locator('[data-model-provider-workspace]')
    const search = workspace.getByRole('searchbox', { name: 'Search providers or models', exact: true })
    await expect(workspace.locator('[data-model-provider-detail="fixture"]')).toBeVisible()
    await expect(workspace).not.toContainText('fixture-key')
    await search.fill('secondary')
    await expect(workspace.locator('[data-model-provider]')).toHaveCount(1)
    await expect(workspace.locator('[data-model-provider-detail="secondary"]')).toBeVisible()
    await workspace.getByRole('button', { name: 'Clear search', exact: true }).click()
    await expect(search).toBeFocused()
    await search.press('ArrowDown')
    await expect(workspace.locator('[data-model-provider="fixture"]')).toBeFocused()
    await page.keyboard.press('End')
    await expect(workspace.locator('[data-model-provider-detail="secondary"]')).toBeVisible()
    await page.keyboard.press('Home')
    await expect(workspace.locator('[data-model-provider-detail="fixture"]')).toBeVisible()
    await search.fill('fixture reasoning')
    await expect(workspace.locator('[data-model-id]')).toHaveCount(1)
    await expect(workspace.locator('[data-model-id="fake-reasoning"]')).toBeVisible()
    await search.press('Escape')

    const row = workspace.locator('[data-model-id="fake-chat"]')
    await row.getByRole('button', { name: 'Test', exact: true }).click()
    await expect(row.getByRole('status')).toContainText('Connected', { timeout: 20_000 })
    await row.getByRole('button', { name: 'Actions for Fake Chat', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Edit model', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit model', exact: true })
    await dialog.getByRole('textbox', { name: 'Context window', exact: true }).fill('not a number')
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
    const context = dialog.getByRole('textbox', { name: 'Context window', exact: true })
    await expect(context).toHaveAttribute('aria-invalid', 'true')
    const feedbackId = await context.getAttribute('aria-describedby')
    expect(feedbackId).toBeTruthy()
    await expect(dialog.locator(`[id="${feedbackId}"]`)).toBeVisible()
    await context.fill('1000000')
    await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('Updated Chat')
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(row).toContainText('Updated Chat')
    await expect(row.getByRole('status')).toHaveCount(0)
    expect(JSON.parse(await readFile(modelPath, 'utf8')).providers.fixture.models[0].name).toBe('Fake Chat')

    await main.getByRole('button', { name: 'JSON', exact: true }).click()
    const editor = main.getByRole('textbox', { name: 'JSON', exact: true })
    await expect(editor).toHaveValue(/Updated Chat/u)
    const draftText = await editor.inputValue()
    const draft = JSON.parse(draftText)
    expect(draft.providers.fixture.apiKey).toBe('fixture-key')
    expect(draft.providers.fixture.compat).toEqual(initial.providers.fixture.compat)
    await page.locator('[data-context-panel-nav-id="general"]').click()
    await page.locator('[data-context-panel-nav-id="models"]').click()
    await expect(editor).toHaveValue(draftText)
    await main.getByRole('button', { name: 'Form', exact: true }).click()

    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((theme) => window.pipilot!.settings.update({ appearance: { theme } }), theme)
      await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark'))).toBe(theme === 'dark')
      for (const width of [1440, 1100]) {
        await page.setViewportSize({ width, height: width === 1100 ? 680 : 900 })
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await expect.poll(() => workspace.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
        await page.screenshot({ path: testInfo.outputPath(`models-workspace-${theme}-${width}.png`), animations: 'disabled' })
      }
    }
    await main.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(async () => JSON.parse(await readFile(modelPath, 'utf8')).providers.fixture.models[0].name).toBe('Updated Chat')
    await expect(main.getByRole('status').filter({ hasText: /^Saved$/u })).toBeVisible()
    await expect(main.getByRole('button', { name: 'Apply configuration', exact: true })).toBeEnabled()
    expect(errors).toEqual([])
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
