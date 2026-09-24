import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import type { LocalPiRuntimeSnapshot } from '../../src/shared/local-pi'
import type { TaskNotification } from '../../src/shared/task-notifications'
import { startPiSdkFixture } from './pi-sdk-fixture'
import { closeFixtureApplication } from './close-fixture-application'

function taskButton(page: Page, name: string) {
  return page.locator('[data-session-list="project"]').getByRole('button', { name, exact: true })
}

function taskRow(page: Page, name: string) {
  return page.locator('[data-session-list="project"]').getByRole('listitem')
    .filter({ has: page.getByRole('button', { name, exact: true }) })
}

function notificationPopover(page: Page) {
  return page.getByRole('dialog', { name: 'Notifications', exact: true })
}

async function notificationItems(page: Page) {
  return page.evaluate(() => window.pipilot!.notifications.get().then((snapshot) => snapshot.items))
}

async function exists(path: string) {
  try { await access(path); return true } catch { return false }
}

async function launchFixture(testInfo: TestInfo, options: {
  promptGates?: Readonly<Record<string, Promise<void>>>
  extension?: string
} = {}) {
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const projects = [testInfo.outputPath('Notification-A'), testInfo.outputPath('Notification-B')]
  await Promise.all([userData, ...projects].map((path) => mkdir(path, { recursive: true })))
  const [projectA, projectB] = await Promise.all(projects.map((path) => realpath(path)))
  await writeFile(join(userData, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: {
      ...DEFAULT_SETTINGS,
      locale: 'en-US',
      notifications: { desktop: false },
      appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true },
    },
  }))
  await writeFile(join(userData, 'pi-managed-packages.json'), JSON.stringify({ version: 1, mcpOptedOut: true }))
  const sdk = await startPiSdkFixture({ agentDir, promptGates: options.promptGates })
  let app: ElectronApplication | undefined
  const close = async () => {
    try { if (app) await closeFixtureApplication(app) } finally { await sdk.close() }
  }
  try {
    if (options.extension) await writeFile(join(agentDir, 'extensions', 'task-notification-gate.js'), options.extension)
    app = await electron.launch({ args: [resolve(process.cwd())], env: {
      ...process.env, ...sdk.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1',
    } })
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await app.evaluate(({ app, BrowserWindow }) => {
      app.focus({ steal: true })
      const window = BrowserWindow.getAllWindows()[0]
      window?.focus()
      // The desktop automation client may own macOS focus while Playwright
      // clicks this real window. Model foreground deterministically here;
      // service/native tests independently cover background/hidden delivery.
      if (window) Object.defineProperty(window, 'isFocused', { configurable: true, value: () => true })
    })
    return { app, page, sdk, projectA, projectB, userData, errors, close }
  } catch (error) {
    await close()
    throw error
  }
}

async function addProject(app: ElectronApplication, page: Page, path: string) {
  await app.evaluate(({ dialog }, selectedPath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [selectedPath] }),
    })
  }, path)
  await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
  await expect.poll(async () => {
    const runtime = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    return { cwd: runtime.cwd, state: runtime.state }
  }).toEqual({ cwd: path, state: 'ready' })
}

async function submit(page: Page, prompt: string) {
  await page.getByRole('textbox', { name: 'Message input', exact: true }).fill(prompt)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
}

async function expectResponse(page: Page, prompt: string) {
  await expect(page.getByRole('log', { name: 'Conversation' }).getByText(
    `Fixture response: ${prompt}`, { exact: true },
  )).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
}

async function seedTask(page: Page, name: string) {
  const prompt = `Seed ${name}`
  await submit(page, prompt)
  await expectResponse(page, prompt)
  const result = await page.evaluate((title) => window.pipilot!.localPi.runtime.command({
    type: 'set_session_name', name: title,
  }), name)
  expect(result.success).toBe(true)
  await expect(taskButton(page, name)).toBeVisible()
  return page.evaluate(() => window.pipilot!.localPi.runtime.status())
}

async function expectSelected(page: Page, runtime: LocalPiRuntimeSnapshot) {
  await expect.poll(async () => {
    const selected = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    return { state: selected.state, cwd: selected.cwd, sessionFile: selected.sessionFile, sessionId: selected.sessionState?.sessionId }
  }).toEqual({ state: 'ready', cwd: runtime.cwd, sessionFile: runtime.sessionFile, sessionId: runtime.sessionState!.sessionId })
}

async function waitForNotification(page: Page, sessionId: string, kind: TaskNotification['kind']) {
  await expect.poll(async () => (await notificationItems(page)).filter((item) =>
    item.sessionId === sessionId && item.kind === kind).length).toBe(1)
  return (await notificationItems(page)).find((item) => item.sessionId === sessionId && item.kind === kind)!
}

async function setDarkMinimum(page: Page) {
  await page.setViewportSize({ width: 1100, height: 680 })
  await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'dark' } }))
  await expect(page.locator('html')).toHaveClass(/dark/u)
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
  const dialog = page.getByRole('dialog')
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
}

test('keeps background completion unread until its exact task is opened, while viewed work and plugin notices stay quiet', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const backgroundPrompt = 'Finish the background notification task'
  let release!: () => void
  const gate = new Promise<void>((resolveGate) => { release = resolveGate })
  const fixture = await launchFixture(testInfo, { promptGates: { [backgroundPrompt]: gate } })
  const { app, page, sdk, projectA, projectB, userData, errors } = fixture
  try {
    // Exercise the preference before any task runs, so enabling then disabling
    // it cannot produce a desktop notification on the test machine.
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('region', { name: 'Settings', exact: true }).getByRole('button', { name: 'General', exact: true }).click()
    const desktop = page.getByRole('switch', { name: 'Desktop notifications', exact: true })
    await expect(desktop).not.toBeChecked()
    await desktop.click()
    await expect.poll(() => page.evaluate(() => window.pipilot!.settings.get().then((value) => value.settings.notifications.desktop))).toBe(true)
    await desktop.click()
    await expect.poll(async () => JSON.parse(await readFile(join(userData, 'settings.json'), 'utf8')).settings.notifications.desktop).toBe(false)
    await page.reload()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('region', { name: 'Settings', exact: true }).getByRole('button', { name: 'General', exact: true }).click()
    await expect(desktop).not.toBeChecked()
    await page.getByRole('button', { name: 'Sessions', exact: true }).click()

    await addProject(app, page, projectA)
    const runtimeA = await seedTask(page, 'Background completion task')
    await addProject(app, page, projectB)
    const runtimeB = await seedTask(page, 'Selected reading task')
    await page.evaluate(() => window.pipilot!.notifications.clear())
    await taskButton(page, 'Background completion task').click()
    await expectSelected(page, runtimeA)
    await submit(page, backgroundPrompt)
    await expect.poll(() => sdk.prompts.includes(backgroundPrompt)).toBe(true)
    await taskButton(page, 'Selected reading task').click()
    await expectSelected(page, runtimeB)
    release()

    const completed = await waitForNotification(page, runtimeA.sessionState!.sessionId, 'completed')
    expect(completed.read).toBe(false)
    await expect(page.getByRole('button', { name: 'Notifications (1 unread)', exact: true })).toBeVisible()
    await expect(notificationPopover(page)).toHaveCount(0)
    await expectSelected(page, runtimeB)
    await expect(page.getByRole('log', { name: 'Conversation' })).not.toContainText(backgroundPrompt)

    await page.getByRole('button', { name: 'Notifications (1 unread)', exact: true }).click()
    const row = page.locator(`[data-task-notification-id="${completed.id}"]`)
    await expect(row).toContainText('Background completion task')
    await expect(row).toContainText(basename(projectA))
    await expect(row).toContainText('Unread')
    await page.screenshot({ path: testInfo.outputPath('task-notifications-desktop-light.png') })
    await setDarkMinimum(page)
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath('task-notifications-dark-minimum.png') })
    await row.getByRole('button').click()
    await expectSelected(page, runtimeA)
    await expectResponse(page, backgroundPrompt)
    await expect(notificationPopover(page)).toHaveCount(0)
    await expect.poll(async () => ({
      read: (await notificationItems(page)).find((item) => item.id === completed.id)?.read,
      window: await app.evaluate(({ BrowserWindow }) => ({ focused: BrowserWindow.getAllWindows()[0]?.isFocused(), visible: BrowserWindow.getAllWindows()[0]?.isVisible() })),
    })).toMatchObject({ read: true, window: { focused: true, visible: true } })
    await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible()

    await page.evaluate(() => window.pipilot!.notifications.clear())
    await submit(page, 'Complete while I am reading this task')
    await expectResponse(page, 'Complete while I am reading this task')
    const foreground = await waitForNotification(page, runtimeA.sessionState!.sessionId, 'completed')
    expect(foreground.read).toBe(true)
    await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible()
    await expect(notificationPopover(page)).toHaveCount(0)

    const beforePlugin = await notificationItems(page)
    await submit(page, '/fixture-command')
    await expect(page.locator('[data-conversation-notices]').getByText('Fixture command ran', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    expect(await notificationItems(page)).toEqual(beforePlugin)
    await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    release()
    await fixture.close()
  }
})

test('retains unread completion when the selected task finishes in the tray', async ({}, testInfo) => {
  const prompt = 'Finish while the window is closed to tray'
  let release!: () => void
  const gate = new Promise<void>((resolveGate) => { release = resolveGate })
  const fixture = await launchFixture(testInfo, { promptGates: { [prompt]: gate } })
  const { app, page, sdk, projectA, errors } = fixture
  try {
    await addProject(app, page, projectA)
    const runtime = await seedTask(page, 'Tray task')
    await page.evaluate(() => window.pipilot!.notifications.clear())
    await submit(page, prompt)
    await expect.poll(() => sdk.prompts.includes(prompt)).toBe(true)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())).toBe(false)
    release()
    const completed = await waitForNotification(page, runtime.sessionState!.sessionId, 'completed')
    expect(completed.read).toBe(false)
    // Use the application's Dock activation/reveal path, shared by tray clicks,
    // instead of bypassing its lifecycle with raw BrowserWindow calls.
    await app.evaluate(({ app }) => { app.emit('activate') })
    await expectResponse(page, prompt)
    await expect.poll(async () => ({
      read: (await notificationItems(page)).find((item) => item.id === completed.id)?.read,
      window: await app.evaluate(({ BrowserWindow }) => ({ focused: BrowserWindow.getAllWindows()[0]?.isFocused(), visible: BrowserWindow.getAllWindows()[0]?.isVisible() })),
      selected: (await page.evaluate(() => window.pipilot!.localPi.runtime.status())).sessionStatuses?.filter((item) => item.selected).map((item) => item.sessionId),
    })).toMatchObject({ read: true, window: { focused: true, visible: true }, selected: [runtime.sessionState!.sessionId] })
    await expect(notificationPopover(page)).toHaveCount(0)
    expect(errors).toEqual([])
  } finally { release(); await fixture.close() }
})

test('opens the original background question from its notification and resolves task attention after answering', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const gateDir = testInfo.outputPath('question-gate')
  await mkdir(gateDir, { recursive: true })
  const prompt = 'Ask for approval after I leave this task'
  const questionTitle = 'Approve the background preview?'
  const questionBody = 'Use the reviewed preview from Notification-A without changing Notification-B?'
  const fixture = await launchFixture(testInfo, { extension: `
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export default function backgroundQuestion(pi) {
  let pending = false
  pi.on('before_agent_start', (event) => { pending = event.prompt === ${JSON.stringify(prompt)} })
  pi.on('agent_end', async (_event, ctx) => {
    if (!pending) return
    pending = false
    const gate = ${JSON.stringify(gateDir)}
    writeFileSync(join(gate, 'started'), 'started')
    const deadline = Date.now() + 45000
    while (!existsSync(join(gate, 'release')) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    if (!existsSync(join(gate, 'release'))) throw new Error('Background question fixture release timed out.')
    const approved = await ctx.ui.confirm(${JSON.stringify(questionTitle)}, ${JSON.stringify(questionBody)})
    writeFileSync(join(gate, 'answered'), approved ? 'yes' : 'no')
  })
}
` })
  const { app, page, projectA, projectB, errors } = fixture
  try {
    await addProject(app, page, projectA)
    const runtimeA = await seedTask(page, 'Approval waiting task')
    await addProject(app, page, projectB)
    const runtimeB = await seedTask(page, 'Unaffected reading task')
    await page.evaluate(() => window.pipilot!.notifications.clear())
    await taskButton(page, 'Approval waiting task').click()
    await expectSelected(page, runtimeA)
    await submit(page, prompt)
    await expect.poll(() => exists(join(gateDir, 'started'))).toBe(true)
    await taskButton(page, 'Unaffected reading task').click()
    await expectSelected(page, runtimeB)
    await writeFile(join(gateDir, 'release'), 'release')

    const question = await waitForNotification(page, runtimeA.sessionState!.sessionId, 'input-required')
    expect(question).toMatchObject({ read: false, resolved: false })
    await expect(taskRow(page, 'Approval waiting task').locator('[data-session-indicator]')).toHaveAttribute('data-session-indicator', 'attention')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expectSelected(page, runtimeB)
    await page.getByRole('button', { name: 'Notifications (1 unread)', exact: true }).click()
    const notification = page.locator(`[data-task-notification-id="${question.id}"]`)
    await expect(notification).toContainText('Input required')
    await notification.getByRole('button').click()

    const dialog = page.getByRole('dialog', { name: questionTitle, exact: true })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText(questionBody)
    await expectSelected(page, runtimeA)
    await expect(notificationPopover(page)).toHaveCount(0)
    await setDarkMinimum(page)
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath('background-question-restored-dark-minimum.png') })
    await dialog.getByRole('button', { name: 'Yes', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect.poll(async () => exists(join(gateDir, 'answered'))
      .then((present) => present ? readFile(join(gateDir, 'answered'), 'utf8') : null)).toBe('yes')
    await expectResponse(page, prompt)
    await expect.poll(async () => (await notificationItems(page)).find((item) => item.id === question.id))
      .toMatchObject({ read: true, resolved: true })
    await expect.poll(async () => (await page.evaluate(() => window.pipilot!.localPi.runtime.status()))
      .sessionStatuses?.find((status) => status.sessionId === runtimeA.sessionState!.sessionId)?.needsUserInput ?? false).toBe(false)
    await expect(taskRow(page, 'Approval waiting task').locator('[data-session-indicator="attention"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible()
    await taskButton(page, 'Unaffected reading task').click()
    await expectSelected(page, runtimeB)
    await taskButton(page, 'Approval waiting task').click()
    await expectSelected(page, runtimeA)
    await expect(dialog).toHaveCount(0)
    expect((await notificationItems(page)).filter((item) => item.kind === 'input-required')).toHaveLength(1)
    expect(errors).toEqual([])
  } finally {
    await writeFile(join(gateDir, 'release'), 'release')
    await fixture.close()
  }
})
