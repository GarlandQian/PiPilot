import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'
import { closeFixtureApplication } from './close-fixture-application'

test('runs a saved schedule in the background, preserves history and never replays an uncertain run after restart', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const projectPath = testInfo.outputPath('scheduled-project')
  await Promise.all([userData, projectPath].map((path) => mkdir(path, { recursive: true })))
  const cwd = await realpath(projectPath)
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, settings: {
    ...DEFAULT_SETTINGS, locale: 'en-US', notifications: { desktop: false }, appearance: { ...DEFAULT_SETTINGS.appearance, reducedMotion: true },
  } }))
  const prompt = 'Scheduled background verification'
  const failedPrompt = 'Scheduled provider failure'
  const cancelledPrompt = 'Scheduled user cancellation'
  const interruptedPrompt = 'Scheduled outcome remains unknown'
  let release!: () => void
  const pending = new Promise<void>((resolvePending) => { release = resolvePending })
  const fixture = await startPiSdkFixture({ agentDir, retryEnabled: false,
    responseChunks: { [prompt]: { chunks: [`## Scheduled report\n\n**Fixture response: ${prompt}**\n\n- Kept the foreground conversation.\n`], intervalMs: 0 } },
    providerErrors: { [failedPrompt]: 'Fixture provider rejected this scheduled request.' },
    completionGates: { [cancelledPrompt]: pending, [interruptedPrompt]: pending },
  })
  const errors: string[] = []
  let app: ElectronApplication | undefined
  const launch = async () => {
    app = await electron.launch({ args: [resolve(process.cwd())], env: { ...process.env, ...fixture.env,
      PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' } })
    // Exercise the real notification decision while suppressing OS banners.
    await app.evaluate(({ Notification }) => {
      const state = globalThis as typeof globalThis & { __scheduledNotifications: { title: string; body: string }[] }
      state.__scheduledNotifications = []
      Object.defineProperty(Notification, 'isSupported', { configurable: true, value: () => true })
      Object.defineProperty(Notification.prototype, 'show', { configurable: true, value: function (this: { title: string; body: string }) {
        state.__scheduledNotifications.push({ title: this.title, body: this.body })
      } })
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.evaluate(() => window.pipilot!.settings.update({ notifications: { desktop: true } }))
    return page
  }
  const seed = async (page: Page, name: string) => {
    await page.getByRole('textbox', { name: 'Message input', exact: true }).fill(`Seed ${name}`)
    await page.locator('[data-composer-submit]').click()
    await expect(page.getByRole('log', { name: 'Conversation', exact: true })).toContainText(`Fixture response: Seed ${name}`)
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    expect(await page.evaluate((value) => window.pipilot!.localPi.runtime.command({ type: 'set_session_name', name: value }), name)).toMatchObject({ success: true })
  }
  try {
    let page = await launch()
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await app!.evaluate(({ dialog }, path) => { Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true, value: async () => ({ canceled: false, filePaths: [path] }),
    }) }, cwd)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
    await seed(page, 'Scheduled target')
    await page.getByRole('button', { name: 'New session in scheduled-project', exact: true }).click()
    await seed(page, 'Foreground conversation')
    const foreground = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('region', { name: 'Settings', exact: true }).getByRole('button', { name: 'Scheduled tasks', exact: true }).click()
    const panel = page.locator('[data-scheduled-tasks]')
    await panel.getByRole('button', { name: 'New scheduled task', exact: true }).click()
    await panel.getByLabel('Name', { exact: true }).fill('Scheduled fixture')
    const targetPicker = panel.getByLabel('Existing conversation', { exact: true })
    try { await expect(targetPicker.locator('option').filter({ hasText: 'Scheduled target' })).toHaveCount(1) }
    catch (error) {
      await testInfo.attach('scheduled-target-diagnostics', { contentType: 'application/json', body: JSON.stringify({
        options: await targetPicker.locator('option').allTextContents(), alerts: await panel.getByRole('alert').allTextContents(),
        inventory: await page.evaluate(async () => { try { return await window.pipilot!.scheduledTasks.listTargets() } catch (error) { return error } }),
      }, null, 2) })
      await page.screenshot({ path: testInfo.outputPath('scheduled-target-failure.png') })
      throw error
    }
    await targetPicker.selectOption({ label: (await targetPicker.locator('option').filter({ hasText: 'Scheduled target' }).textContent())! })
    await panel.getByLabel('Prompt', { exact: true }).fill(prompt)
    await panel.getByLabel('Frequency', { exact: true }).selectOption('once')
    const future = new Date(Date.now() + 24 * 3_600_000)
    const localFuture = new Date(future.getTime() - future.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    await panel.getByLabel('Start time (this computer’s local time)', { exact: true }).fill(localFuture)
    await panel.getByRole('button', { name: 'Save task', exact: true }).click()
    await panel.getByRole('button', { name: 'Run now', exact: true }).click()
    try { await expect.poll(() => page.evaluate(async () => (await window.pipilot!.scheduledTasks.get()).runs[0]?.status), { timeout: 20_000 }).toBe('completed') }
    catch (error) {
      const status = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
      await testInfo.attach('scheduled-runtime-diagnostics', { contentType: 'application/json', body: JSON.stringify(status, null, 2) })
      throw error
    }
    expect(fixture.prompts.filter((value) => value === prompt)).toHaveLength(1)
    expect((await page.evaluate(() => window.pipilot!.localPi.runtime.status())).sessionState?.sessionId).toBe(foreground.sessionState?.sessionId)
    await panel.getByText('View response', { exact: true }).click()
    await expect(panel).toContainText(`Fixture response: ${prompt}`)
    await expect(panel.getByRole('heading', { name: 'Scheduled report', exact: true })).toBeVisible()
    await expect(panel.locator('strong').filter({ hasText: `Fixture response: ${prompt}` })).toHaveCount(1)
    await panel.getByRole('heading', { name: 'Scheduled report', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath('scheduled-success.png') })
    await panel.getByRole('button', { name: 'Pause', exact: true }).click()
    const editPrompt = async (value: string) => {
      await panel.getByRole('button', { name: 'Edit task', exact: true }).click()
      await panel.getByLabel('Prompt', { exact: true }).fill(value)
      await panel.getByRole('button', { name: 'Save task', exact: true }).click()
    }
    await editPrompt(failedPrompt)
    await panel.getByRole('button', { name: 'Run now', exact: true }).click()
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.scheduledTasks.get()).runs[1]?.status)).toBe('failed')
    const failed = await page.evaluate(async () => (await window.pipilot!.scheduledTasks.get()).runs[1])
    expect(failed.error).toContain('Fixture provider rejected this scheduled request.')
    expect(failed.finalResponse).toBeUndefined()
    await expect(panel.getByText('[Empty assistant message]', { exact: true })).toHaveCount(0)
    await expect(panel).toContainText('Fixture provider rejected this scheduled request.')
    expect(await app!.evaluate(() => (globalThis as typeof globalThis & { __scheduledNotifications: { title: string; body: string }[] }).__scheduledNotifications.filter((item) => item.title === 'Scheduled fixture').map((item) => item.body))).toEqual([
      'Scheduled task completed. View its response in PiPilot.',
      'Scheduled task needs attention. Check its run history in PiPilot.',
    ])
    await editPrompt(cancelledPrompt)
    await panel.getByRole('button', { name: 'Run now', exact: true }).click()
    await expect.poll(() => fixture.prompts.filter((value) => value === cancelledPrompt).length).toBe(1)
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.scheduledTasks.get()).runs[2]?.status)).toBe('accepted')
    // A user may open the officially selected target and stop its active turn.
    await page.evaluate(async () => {
      const api = window.pipilot!
      const scope = (await api.conversation.get()).activeScope
      const target = (await api.sessionCatalog.refresh(scope)).rows.find((item) => item.name === 'Scheduled target')!
      await api.sessionCatalog.open(scope, target.selectionToken)
      const stopped = await api.localPi.runtime.command({ type: 'abort' })
      if (!stopped.success) throw new Error('The fixture turn could not be stopped.')
    })
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.scheduledTasks.get()).runs[2]?.status)).toBe('aborted')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await editPrompt(interruptedPrompt)
    await panel.getByRole('button', { name: 'Run now', exact: true }).click()
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.scheduledTasks.get()).runs[3]?.status)).toBe('accepted')
    await expect.poll(() => fixture.prompts.filter((value) => value === interruptedPrompt).length).toBe(1)
    const closed = app!.waitForEvent('close')
    // A real crash cannot run Electron's window/Host teardown callbacks. Kill
    // only the exact isolated child process created by this test.
    app!.process().kill('SIGKILL')
    await closed
    app = undefined
    release()
    page = await launch()
    const restored = await page.evaluate(() => window.pipilot!.scheduledTasks.get())
    expect(restored.tasks).toHaveLength(1)
    expect(restored.tasks[0].enabled).toBe(false)
    expect(restored.runs.map((run) => run.status)).toEqual(['completed', 'failed', 'aborted', 'interrupted'])
    expect(fixture.prompts.filter((value) => value === interruptedPrompt)).toHaveLength(1)
    // A hard process crash may precede Chromium flushing its last UI route.
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('region', { name: 'Settings', exact: true }).getByRole('button', { name: 'Scheduled tasks', exact: true }).click()
    await expect(page.locator('[data-scheduled-tasks]')).toContainText('Outcome unknown')
    await page.screenshot({ path: testInfo.outputPath('scheduled-tasks-recovered.png') })
    await page.getByRole('button', { name: 'Delete Scheduled fixture', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete scheduled task', exact: true }).click()
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.scheduledTasks.get()).tasks.length)).toBe(0)
    expect((await page.evaluate(() => window.pipilot!.scheduledTasks.get())).runs).toHaveLength(4)
    expect(errors).toEqual([])
  } catch (error) {
    if (app) {
      const page = await app.firstWindow()
      await page.screenshot({ path: testInfo.outputPath('scheduled-failure.png') }).catch(() => undefined)
      await testInfo.attach('scheduled-failure-state', { contentType: 'application/json', body: JSON.stringify({
        errors,
        body: await page.locator('body').innerText().catch(() => ''),
        fields: await page.locator('textarea').evaluateAll((items) => items.filter((item): item is HTMLTextAreaElement => item instanceof HTMLTextAreaElement).map((item) => ({ value: item.value, label: item.getAttribute('aria-label'), labels: [...item.labels ?? []].map((label) => label.textContent) }))).catch(() => []),
      }, null, 2) })
    }
    throw error
  } finally {
    release()
    if (app) await closeFixtureApplication(app)
    await fixture.close()
  }
})
