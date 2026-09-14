import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'
import type { IpcMainInvokeEvent } from 'electron'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { ipcChannels } from '../../src/shared/ipc/contracts'
import { startPiSdkFixture } from './pi-sdk-fixture'

async function setup(testInfo: TestInfo) {
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  await mkdir(userData, { recursive: true })
  await writeFile(join(userData, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US', appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true } },
  }))
  await writeFile(join(userData, 'pi-managed-packages.json'), JSON.stringify({ version: 1, mcpOptedOut: true }))
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
  await main.getByRole('button', { name: 'JSON', exact: true }).click()
  const editor = main.getByRole('textbox', { name: 'JSON', exact: true })
  await expect(editor).not.toHaveValue('')
  return editor
}

async function requestQuit(app: ElectronApplication) {
  await app.evaluate(({ app }) => { app.quit() })
}

async function modelsWorkspace(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.locator('[data-context-panel-nav-id="models"]').click()
  return page.getByRole('main', { name: 'Models', exact: true })
}

test('protects an unsubmitted provider form and keeps invalid fields after cancelled Quit', async ({}, testInfo) => {
  const { app, page, fixture, modelPath } = await setup(testInfo)
  try {
    const before = await readFile(modelPath, 'utf8')
    const workspace = await modelsWorkspace(page)
    await workspace.getByRole('button', { name: 'Add provider', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'Add provider', exact: true })
    await form.getByRole('textbox', { name: 'Name', exact: true }).fill('Unsubmitted provider')
    await requestQuit(app)
    const quit = page.getByRole('alertdialog', { name: 'Save configuration before quitting?', exact: true })
    await expect(quit).toBeVisible()
    await quit.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(quit.getByRole('alert')).toBeVisible()
    expect(await readFile(modelPath, 'utf8')).toBe(before)
    await quit.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(form.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Unsubmitted provider')
    await expect(form.getByText('Enter an ID', { exact: true })).toBeVisible()
    await requestQuit(app)
    const closed = app.waitForEvent('close')
    await quit.getByRole('button', { name: 'Discard', exact: true }).click()
    await closed
    expect(await readFile(modelPath, 'utf8')).toBe(before)
  } finally {
    await cleanup(app)
    await fixture.close()
  }
})

test('saves an unsubmitted model form as part of the explicit Quit transaction', async ({}, testInfo) => {
  const { app, page, fixture, modelPath } = await setup(testInfo)
  try {
    const workspace = await modelsWorkspace(page)
    const row = workspace.locator('[data-model-id="fake-chat"]')
    await row.getByRole('button', { name: 'Actions for Fake Chat', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Edit model', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'Edit model', exact: true })
    await form.getByRole('textbox', { name: 'Name', exact: true }).fill('Saved from open form')
    await requestQuit(app)
    const quit = page.getByRole('alertdialog', { name: 'Save configuration before quitting?', exact: true })
    await expect(quit).toBeVisible()
    const closed = app.waitForEvent('close')
    await quit.getByRole('button', { name: 'Save', exact: true }).click()
    await closed
    const saved = JSON.parse(await readFile(modelPath, 'utf8'))
    expect(saved.providers.fixture.models.find((model: { id: string }) => model.id === 'fake-chat').name).toBe('Saved from open form')
  } finally {
    await cleanup(app)
    await fixture.close()
  }
})

test('saves an unsubmitted MCP server form without starting its command on Quit', async ({}, testInfo) => {
  const { app, page, fixture, mcpPath } = await setup(testInfo)
  try {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('[data-context-panel-nav-id="integrations"]').click()
    const workspace = page.getByRole('main', { name: 'Integrations', exact: true })
    await workspace.getByRole('tab', { name: 'MCP', exact: true }).click()
    await workspace.getByRole('button', { name: 'Add server', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'Add MCP server', exact: true })
    await form.getByRole('textbox', { name: 'Server name', exact: true }).fill('quit-fixture')
    await form.getByRole('textbox', { name: 'Command', exact: true }).fill('pipilot-test-command-must-not-run')
    await requestQuit(app)
    const quit = page.getByRole('alertdialog', { name: 'Save configuration before quitting?', exact: true })
    await expect(quit).toBeVisible()
    const closed = app.waitForEvent('close')
    await quit.getByRole('button', { name: 'Save', exact: true }).click()
    await closed
    expect(JSON.parse(await readFile(mcpPath, 'utf8')).mcpServers['quit-fixture'].command).toBe('pipilot-test-command-must-not-run')
  } finally {
    await cleanup(app)
    await fixture.close()
  }
})

async function holdNextModelsSaveAcknowledgement(app: ElectronApplication) {
  return app.evaluateHandle(({ ipcMain }, channel) => {
    // Keep the actual validation and disk write. Only the final acknowledgement
    // is gated, reproducing Quit between a durable write and Renderer hydration.
    type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
    const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers
    const original = handlers.get(channel)
    if (!original) throw new Error('The models save IPC handler is not registered')
    let release!: () => void
    const acknowledgement = new Promise<void>((resolve) => { release = resolve })
    const gate = { persisted: false, release, restore: () => {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, original)
    } }
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      // One shot: subsequent saves immediately use the original handler.
      gate.restore()
      const result = await original(event, ...args)
      if (!(result && typeof result === 'object' && 'ok' in result && result.ok === true)) {
        throw new Error('The isolated models save did not succeed')
      }
      gate.persisted = true
      await acknowledgement
      return result
    })
    return gate
  }, ipcChannels.modelsConfigSave)
}

async function cleanup(app: ElectronApplication) {
  // Teardown is not a user Quit: a failed assertion must not leave an isolated
  // application's intentional dirty-draft confirmation blocking the test runner.
  await app.evaluate(({ app }) => { app.exit(0) }).catch(() => undefined)
  await app.close().catch(() => undefined)
}

test('preserves work on cancelled Quit and saves all configuration only after explicit approval', async ({}, testInfo) => {
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
    await page.getByRole('button', { name: 'Sessions', exact: true }).click()
    await page.getByRole('textbox', { name: 'Message input', exact: true }).fill('Continue during cancelled quit')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await requestQuit(app)
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('Fixture response: Continue during cancelled quit')
    const runtime = await page.evaluate(() => window.pipilot!.localPi.runtime.status())

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('[data-context-panel-nav-id="integrations"]').click()
    const integrations = page.getByRole('main', { name: 'Integrations', exact: true })
    await integrations.getByRole('tab', { name: 'MCP', exact: true }).click()
    const mcpPanel = integrations.getByRole('tabpanel', { name: 'MCP', exact: true })
    await mcpPanel.getByRole('button', { name: 'JSON', exact: true }).click()
    const mcpEditor = mcpPanel.getByRole('textbox', { name: 'JSON', exact: true })
    await expect(mcpEditor).toHaveValue('{"mcpServers":{}}\n')
    const savedMcp = '// Explicitly saved at Quit\n{"mcpServers":{}}\n'
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

test('discards dirty configuration on explicit Quit without writing it to disk', async ({}, testInfo) => {
  const { app, page, fixture, modelPath } = await setup(testInfo)
  try {
    const editor = await modelsEditor(page)
    const before = await readFile(modelPath, 'utf8')
    await editor.fill('{ invalid but intentionally discarded')
    await requestQuit(app)
    const dialog = page.getByRole('alertdialog', { name: 'Save configuration before quitting?', exact: true })
    await expect(dialog).toBeVisible()
    const closed = app.waitForEvent('close')
    await dialog.getByRole('button', { name: 'Discard', exact: true }).click()
    await closed
    expect(await readFile(modelPath, 'utf8')).toBe(before)
  } finally {
    await cleanup(app)
    await fixture.close()
  }
})

test('waits for an in-flight configuration acknowledgement and then quits automatically', async ({}, testInfo) => {
  const { app, page, fixture, modelPath } = await setup(testInfo)
  let gate: Awaited<ReturnType<typeof holdNextModelsSaveAcknowledgement>> | undefined
  try {
    const acknowledgement = await holdNextModelsSaveAcknowledgement(app)
    gate = acknowledgement
    const editor = await modelsEditor(page)
    const savedModels = `${(await editor.inputValue()).trim()}\n// Saved before Quit acknowledgement\n`
    await editor.fill(savedModels)
    await page.getByRole('main', { name: 'Models', exact: true }).getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => acknowledgement.evaluate((state) => state.persisted)).toBe(true)
    expect((await readFile(modelPath, 'utf8')).trim()).toBe(savedModels.trim())
    await expect(editor).toBeDisabled()

    await requestQuit(app)
    const dialog = page.getByRole('alertdialog', { name: 'Save configuration before quitting?', exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('status')).toHaveText('Finishing configuration changes…')
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Discard', exact: true })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled()

    const closed = app.waitForEvent('close', { timeout: 5_000 })
    await acknowledgement.evaluate((state) => state.release())
    await closed
    expect((await readFile(modelPath, 'utf8')).trim()).toBe(savedModels.trim())
  } finally {
    await gate?.evaluate((state) => { state.release(); state.restore() }).catch(() => undefined)
    await gate?.dispose().catch(() => undefined)
    await cleanup(app)
    await fixture.close()
  }
})

test('cancels Quit during a save and preserves another draft when the acknowledgement arrives', async ({}, testInfo) => {
  const { app, page, fixture, modelPath, mcpPath } = await setup(testInfo)
  let gate: Awaited<ReturnType<typeof holdNextModelsSaveAcknowledgement>> | undefined
  try {
    const acknowledgement = await holdNextModelsSaveAcknowledgement(app)
    gate = acknowledgement
    const editor = await modelsEditor(page)
    const savedModels = `${(await editor.inputValue()).trim()}\n// Save remains valid after cancelled Quit\n`
    await editor.fill(savedModels)
    await page.getByRole('main', { name: 'Models', exact: true }).getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => acknowledgement.evaluate((state) => state.persisted)).toBe(true)
    await requestQuit(app)
    const dialog = page.getByRole('alertdialog', { name: 'Save configuration before quitting?', exact: true })
    await expect(dialog.getByRole('status')).toHaveText('Finishing configuration changes…')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toBeHidden()

    await page.locator('[data-context-panel-nav-id="integrations"]').click()
    const integrations = page.getByRole('main', { name: 'Integrations', exact: true })
    await integrations.getByRole('tab', { name: 'MCP', exact: true }).click()
    const panel = integrations.getByRole('tabpanel', { name: 'MCP', exact: true })
    await panel.getByRole('button', { name: 'JSON', exact: true }).click()
    const mcpEditor = panel.getByRole('textbox', { name: 'JSON', exact: true })
    const initialMcp = await readFile(mcpPath, 'utf8')
    await expect(mcpEditor).toHaveValue(initialMcp)
    const newDraft = `// Draft made after cancelling Quit\n${initialMcp}`
    await mcpEditor.fill(newDraft)

    await acknowledgement.evaluate((state) => state.release())
    await page.locator('[data-context-panel-nav-id="models"]').click()
    await expect(editor).toBeEnabled()
    await expect(editor).toHaveValue(savedModels)
    await expect(dialog).toBeHidden()
    expect((await readFile(modelPath, 'utf8')).trim()).toBe(savedModels.trim())
    await editor.fill(`${savedModels}// Still editable after acknowledgement\n`)
    await expect(page.getByRole('main', { name: 'Models', exact: true }).getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
    await page.locator('[data-context-panel-nav-id="integrations"]').click()
    await expect(mcpEditor).toHaveValue(newDraft)
    expect(await readFile(mcpPath, 'utf8')).toBe(initialMcp)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isDestroyed())).toBe(false)
  } finally {
    await gate?.evaluate((state) => { state.release(); state.restore() }).catch(() => undefined)
    await gate?.dispose().catch(() => undefined)
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
