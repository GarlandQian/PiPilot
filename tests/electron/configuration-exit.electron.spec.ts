import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'

async function setup(testInfo: TestInfo) {
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  await mkdir(userData, { recursive: true })
  await writeFile(join(userData, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US', appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true } },
  }))
  const fixture = await startPiSdkFixture({ agentDir, completionDelays: { 'Continue during cancelled quit': 500 } })
  const mcpPath = join(agentDir, 'mcp.json')
  const modelPath = join(agentDir, 'models.json')
  await writeFile(mcpPath, '{"mcpServers":{}}\n')
  const app = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' },
  })
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1100, height: 680 })
  await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat')
  return { app, page, fixture, agentDir, mcpPath, modelPath }
}

async function modelsEditor(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.locator('[data-context-panel-nav-id="models"]').click()
  const main = page.getByRole('main', { name: 'Models', exact: true })
  await main.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Edit models.json…', exact: true }).click()
  const editor = main.getByRole('textbox', { name: 'models.json', exact: true })
  await expect(editor).not.toHaveValue('')
  return editor
}

async function requestQuit(app: ElectronApplication) {
  await app.evaluate(({ app }) => { app.quit() })
}

async function cleanup(app: ElectronApplication) {
  // Teardown is not a user Quit: a failed assertion must not leave an isolated
  // application's intentional dirty-draft confirmation blocking the test runner.
  await app.evaluate(({ app }) => { app.exit(0) }).catch(() => undefined)
  await app.close().catch(() => undefined)
}

test('preserves work on cancelled Quit and saves all configuration only after explicit approval', { tag: '@core' }, async ({}, testInfo) => {
  test.setTimeout(60_000)
  const { app, page, fixture, mcpPath, modelPath } = await setup(testInfo)
  try {
    const editor = await modelsEditor(page)
    const initial = await editor.inputValue()
    const before = await readFile(modelPath, 'utf8')
    await editor.fill('{ invalid')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close())
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(false)
    await requestQuit(app)
    const dialog = page.getByRole('alertdialog', { name: 'Save configuration before quitting?', exact: true })
    await expect(dialog).toBeVisible()
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isVisible())).toBe(true)
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    expect(await readFile(modelPath, 'utf8')).toBe(before)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(editor).toHaveValue('{ invalid')
    const savedModels = `${initial.trim()}\n// Explicitly saved at Quit\n`
    await editor.fill(savedModels)
    await page.getByRole('button', { name: 'Back to app', exact: true }).click()
    await page.getByRole('textbox', { name: 'Message input', exact: true }).fill('Continue during cancelled quit')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await requestQuit(app)
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('Fixture response: Continue during cancelled quit')
    const runtime = await page.evaluate(() => window.pipilot!.localPi.runtime.status())

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('[data-context-panel-nav-id="mcp"]').click()
    const mcpPanel = page.getByRole('main', { name: 'MCP Servers', exact: true })
    await mcpPanel.locator('[data-mcp-server-list] header').getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Edit global mcp.json…', exact: true }).click()
    const mcpEditor = mcpPanel.getByRole('textbox', { name: 'mcp.json', exact: true })
    await expect(mcpEditor).toHaveValue('{"mcpServers":{}}\n')
    const savedMcp = '{"mcpServers":{},"note":"Explicitly saved at Quit"}\n'
    await mcpEditor.fill(savedMcp)
    await requestQuit(app)
    await requestQuit(app)
    await expect(dialog).toHaveCount(1)
    await page.screenshot({ path: testInfo.outputPath('configuration-quit-light.png'), animations: 'disabled' })
    expect((await page.evaluate(() => window.pipilot!.localPi.runtime.status())).generation).toBe(runtime.generation)
    const closed = app.waitForEvent('close')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await closed
    expect((await readFile(modelPath, 'utf8')).trim()).toBe(savedModels.trim())
    expect(await readFile(mcpPath, 'utf8')).toBe(savedMcp)
    expect(fixture.prompts).toEqual(['Continue during cancelled quit'])
  } finally {
    await cleanup(app)
    await fixture.close()
  }
})

test('quits a clean conversation without first visiting Settings', async ({}, testInfo) => {
  const { app, page, fixture } = await setup(testInfo)
  try {
    let fallbackDialogs = 0
    await app.evaluate(({ dialog }) => {
      Object.defineProperty(dialog, 'showMessageBox', {
        configurable: true,
        value: async () => { throw new Error('Clean Quit must not use a native confirmation') },
      })
    })
    page.on('dialog', () => { fallbackDialogs += 1 })
    const closed = app.waitForEvent('close', { timeout: 4_000 })
    await requestQuit(app)
    await closed
    expect(fallbackDialogs).toBe(0)
  } finally {
    await cleanup(app)
    await fixture.close()
  }
})
