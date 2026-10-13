import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { ipcChannels } from '../../src/shared/ipc/contracts'
import { closeFixtureApplication } from './close-fixture-application'
import { startPiSdkFixture } from './pi-sdk-fixture'

test('starting an empty project task keeps the sidebar and conversation stable during background refreshes', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const projectPath = testInfo.outputPath('Empty project')
  await Promise.all([mkdir(userData, { recursive: true }), mkdir(projectPath, { recursive: true })])
  const project = await realpath(projectPath)
  await writeFile(join(userData, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US' },
  }))
  const fixture = await startPiSdkFixture({ agentDir })
  const app = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' },
  })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 900 })
    const composer = page.getByRole('textbox', { name: 'Message input', exact: true })
    await expect(composer).toBeEditable({ timeout: 20_000 })
    await app.evaluate(({ dialog }, directory) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [directory] }),
      })
    }, project)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.localPi.runtime.status()).cwd)).toBe(project)
    await expect(composer).toBeEditable()
    await expect(page.getByRole('alertdialog', { name: 'Operation failed', exact: true })).toHaveCount(0)
    await composer.fill('Keep this draft while the new task settles')
    const before = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    await page.getByRole('button', { name: 'Start task', exact: true }).click()
    await expect(composer).toBeEditable()
    await expect(composer).toHaveText('Keep this draft while the new task settles')
    await expect(composer).toBeFocused()
    const stable = await composer.evaluate(async (element) => {
      let changed = false
      const observer = new MutationObserver(() => {
        if (!element.isConnected || element.getAttribute('contenteditable') !== 'true') changed = true
      })
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable'] })
      await new Promise((resolve) => setTimeout(resolve, 2_500))
      observer.disconnect()
      return !changed && element.isConnected && element.getAttribute('contenteditable') === 'true'
    })
    expect(stable).toBe(true)
    await expect(composer).toHaveText('Keep this draft while the new task settles')
    expect((await page.evaluate(() => window.pipilot!.localPi.runtime.status())).sessionState?.sessionId)
      .toBe(before.sessionState?.sessionId)

    // The explicit menu remains a real New task command, even while the
    // project has only an unsent draft and the catalog is still empty.
    await page.getByRole('button', { name: 'Project actions for Empty project', exact: true }).click()
    await page.getByRole('menuitem', { name: 'New task', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(() => window.pipilot!.localPi.runtime.status())).sessionState?.sessionId)
      .not.toBe(before.sessionState?.sessionId)
    await expect(composer).toBeEditable()
    await expect(composer).toHaveText('')
    await composer.fill('Keep this draft while the new task settles')

    const emptyProject = await page.evaluate(async () => {
      const api = window.pipilot!
      const scope = (await api.conversation.get()).activeScope
      return { scope, snapshot: await api.localPi.runtime.status(), catalog: await api.sessionCatalog.list(scope) }
    })
    expect(emptyProject.catalog.rows).toEqual([])
    // Real catalog invalidations carry the selected Runtime snapshot. A slow
    // metadata read must not replace a settled empty catalog with a spinner.
    await app.evaluate(({ ipcMain, BrowserWindow }, { channels, emptyProject }) => {
      const probes = globalThis as typeof globalThis & { emptyCatalogRefreshes: number }
      probes.emptyCatalogRefreshes = 0
      ipcMain.removeHandler(channels.sessionCatalogList)
      ipcMain.handle(channels.sessionCatalogList, async (_event, request: { context: { requestId: string } }) => {
        probes.emptyCatalogRefreshes += 1
        await new Promise((resolve) => setTimeout(resolve, 1_000))
        return { ok: true, requestId: request.context.requestId, value: emptyProject.catalog }
      })
      BrowserWindow.getAllWindows()[0]!.webContents.send(channels.localPiRuntimeChanged, {
        eventId: 'b346d6d9-f2b8-490d-93ad-346a35dbf0b1',
        snapshot: emptyProject.snapshot,
        catalogInvalidation: { scope: emptyProject.scope, revision: 1_000_000 },
      })
    }, { channels: ipcChannels, emptyProject })
    await expect.poll(() => app.evaluate(() => (globalThis as typeof globalThis & { emptyCatalogRefreshes: number }).emptyCatalogRefreshes)).toBe(1)
    await expect(page.getByText('Loading tasks…', { exact: true })).toHaveCount(0, { timeout: 250 })
    await expect(page.getByRole('button', { name: 'Start task', exact: true })).toBeVisible()

    const transcript = page.getByRole('log', { name: 'Conversation', exact: true })
    const recovery = transcript.evaluate(async (element) => {
      let loading = false
      const observer = new MutationObserver((records) => {
        if (element.getAttribute('aria-busy') === 'true' || records.some((record) => record.oldValue === 'true')) loading = true
      })
      observer.observe(element, { attributes: true, attributeOldValue: true, attributeFilter: ['aria-busy'] })
      element.setAttribute('data-stability-watch', 'true')
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      observer.disconnect()
      element.removeAttribute('data-stability-watch')
      return loading
    })
    await expect(transcript).toHaveAttribute('data-stability-watch', 'true')
    // A protocol-recovery snapshot refresh is a background read of this same
    // hydrated conversation; it must not show the initial loading overlay.
    await app.evaluate(({ BrowserWindow }, { channel, snapshot }) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send(channel, {
        eventId: 'fed29264-a987-4829-8493-60dc23f23502',
        snapshot: { ...snapshot, diagnostics: [...snapshot.diagnostics, {
          code: 'UNKNOWN_RPC_ENVELOPE', message: 'Fixture protocol recovery', timestamp: Date.now(),
        }] },
      })
    }, { channel: ipcChannels.localPiRuntimeChanged, snapshot: emptyProject.snapshot })
    expect(await recovery).toBe(false)
    await expect(composer).toHaveText('Keep this draft while the new task settles')
    expect(errors).toEqual([])
    expect(fixture.prompts).toEqual([])
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})

test('reselecting a hydrated running conversation keeps its transcript and draft mounted', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  await mkdir(userData, { recursive: true })
  await writeFile(join(userData, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US' },
  }))
  const prompt = 'Keep this running conversation visible'
  const seedPrompt = 'Persist the conversation before the gated response'
  const title = 'Hydrated running conversation'
  let finishResponse!: () => void
  const gate = new Promise<void>((resolve) => { finishResponse = resolve })
  const fixture = await startPiSdkFixture({ agentDir, reasoningDelays: { [prompt]: 1 }, reasoningGates: { [prompt]: gate } })
  const app = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' },
  })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 900 })
    const composer = page.getByRole('textbox', { name: 'Message input', exact: true })
    await expect(composer).toBeEditable({ timeout: 20_000 })
    // Pi persists a brand-new session after its first response. Establish a
    // real catalog row before holding a later response in its thinking phase.
    await composer.fill(seedPrompt)
    await composer.press('Enter')
    await expect(page.getByText(`Fixture response: ${seedPrompt}`, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    const named = await page.evaluate((name) => window.pipilot!.localPi.runtime.command({ type: 'set_session_name', name }), title)
    expect(named.success).toBe(true)
    const row = page.getByRole('button', { name: title, exact: true })
    await expect(row).toHaveAttribute('aria-current', 'page')
    await composer.fill(prompt)
    await composer.press('Enter')
    await expect(row).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled()
    await composer.fill('Unsent follow-up stays here')
    const before = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    const editor = await composer.elementHandle()
    const transcript = page.getByRole('log', { name: 'Conversation', exact: true })
    await transcript.evaluate((element) => {
      const state = globalThis as typeof globalThis & { reselectWatch?: { removed: boolean; observer: MutationObserver } }
      const content = element.firstElementChild!
      const observer = new MutationObserver(() => {
        if (!content.isConnected) state.reselectWatch!.removed = true
      })
      state.reselectWatch = { removed: false, observer }
      observer.observe(element, { childList: true, subtree: true })
    })
    await row.click({ clickCount: 2 })
    await row.click()
    // Flush the IPC request queue too: the prior implementation used to start
    // activation immediately, even for this exact ready/running selection.
    const after = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    expect(after.state).toBe('ready')
    expect(after.sessionState?.sessionId).toBe(before.sessionState?.sessionId)
    expect(after.sessionStatuses?.find((session) => session.sessionId === before.sessionState?.sessionId)?.status).toBe('running')
    expect(await editor!.evaluate((element) => element.isConnected)).toBe(true)
    await expect(composer).toHaveText('Unsent follow-up stays here')
    expect(await transcript.evaluate(() => {
      const state = globalThis as typeof globalThis & { reselectWatch?: { removed: boolean; observer: MutationObserver } }
      state.reselectWatch!.observer.disconnect()
      return state.reselectWatch!.removed
    })).toBe(false)

    // A different task still performs a genuine selection. Returning to this
    // running task must keep the provider request alive and restore its draft.
    await page.getByRole('button', { name: 'New task', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(() => window.pipilot!.localPi.runtime.status())).sessionState?.sessionId)
      .not.toBe(before.sessionState?.sessionId)
    await expect(composer).toBeEditable()
    await row.click()
    await expect(composer).toHaveText('Unsent follow-up stays here')
    await expect(row).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled()
    const returned = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    expect(returned.sessionStatuses?.find((session) => session.sessionId === before.sessionState?.sessionId)?.status).toBe('running')
    finishResponse()
    await expect(page.getByText(`Fixture response: ${prompt}`, { exact: true })).toBeVisible()
    expect(fixture.prompts).toEqual([seedPrompt, prompt])
    expect(errors).toEqual([])
  } finally {
    finishResponse()
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
