import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { _electron as electron, expect, test, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'
import { ipcChannels } from '../../src/shared/ipc/contracts'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'
import { PNG_FIXTURE_BASE64 } from '../helpers/image-fixture'

const pixelPng = Buffer.from(PNG_FIXTURE_BASE64, 'base64')
const imageSrc = `data:image/png;base64,${pixelPng.toString('base64')}`

function deferred() {
  let release!: () => void
  const promise = new Promise<void>((resolveGate) => { release = resolveGate })
  return { promise, release }
}

async function launchFixture(testInfo: TestInfo, promptGates: Record<string, Promise<void>> = {}) {
  const userDataPath = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const projectDir = testInfo.outputPath('delivery-project')
  await Promise.all([userDataPath, projectDir].map((path) => mkdir(path, { recursive: true })))
  const cwd = await realpath(projectDir)
  await writeFile(join(userDataPath, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US' },
  }))
  const fixture = await startPiSdkFixture({ agentDir, promptGates })
  const app = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userDataPath },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
  await app.evaluate(({ dialog }, path) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true, writable: true,
      value: async () => ({ canceled: false, filePaths: [path] }),
    })
  }, cwd)
  await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.pipilot!.localPi.runtime.status()))
    .toMatchObject({ cwd, state: 'ready' })
  await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat')
  return { app, page, fixture }
}

function composer(page: Page) { return page.getByRole('textbox', { name: 'Message input', exact: true }) }
function pending(page: Page) { return page.locator('[data-pending-message-rail]') }
function projectSession(page: Page, name: string) {
  return page.locator('[data-session-list="project"]').getByRole('button', { name, exact: true })
}

async function send(page: Page, text: string, imageName?: string) {
  await composer(page).fill(text)
  if (imageName) await page.locator('input[type="file"]').setInputFiles({ name: imageName, mimeType: 'image/png', buffer: pixelPng })
  await page.locator('[data-composer-submit]').click()
  await expect(composer(page)).toHaveText('')
}

async function delivery(page: Page) {
  return page.evaluate(async () => {
    const response = await window.pipilot!.localPi.runtime.command({ type: 'get_delivery_state' })
    if (!response.success || response.command !== 'get_delivery_state') throw new Error('Could not read fixture delivery state')
    return response.data
  })
}

async function history(page: Page) {
  return page.evaluate(async () => {
    const response = await window.pipilot!.localPi.runtime.command({ type: 'get_messages' })
    if (!response.success || response.command !== 'get_messages') throw new Error('Could not read fixture messages')
    return response.data.messages
  })
}

async function seedAndName(page: Page, name: string) {
  await send(page, `Seed ${name}`)
  await expect(page.getByRole('log', { name: 'Conversation' }).getByText(`Fixture response: Seed ${name}`, { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  const result = await page.evaluate((title) => window.pipilot!.localPi.runtime.command({ type: 'set_session_name', name: title }), name)
  expect(result.success).toBe(true)
  await expect(projectSession(page, name)).toBeVisible()
}

/** Gates transport acknowledgements only; the real command handler still runs. */
async function holdSubmissionReply(app: ElectronApplication, message: string) {
  return app.evaluateHandle(({ ipcMain }, { channel, text }) => {
    type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
    const original = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers.get(channel)
    if (!original) throw new Error('Missing command handler')
    let release!: () => void
    const pause = new Promise<void>((resolveReply) => { release = resolveReply })
    const gate = {
      accepted: false, release,
      restore: () => { ipcMain.removeHandler(channel); ipcMain.handle(channel, original) },
    }
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const request = args[0] as { command?: { type?: string; message?: string } }
      const result = await original(event, ...args)
      if (request.command?.type === 'submit_message' && request.command.message === text) {
        gate.accepted = true
        await pause
      }
      return result
    })
    return gate
  }, { channel: ipcChannels.localPiCommand, text: message })
}

/** Emulates a broken reply/query channel, never inventing an acceptance receipt. */
async function interruptSubmissionReply(app: ElectronApplication, message: string, accepted: boolean) {
  return app.evaluateHandle(({ ipcMain }, { channel, text, runOriginal }) => {
    type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
    const original = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })._invokeHandlers.get(channel)
    if (!original) throw new Error('Missing command handler')
    const gate = {
      submissionId: '', allowQuery: false,
      restore: () => { ipcMain.removeHandler(channel); ipcMain.handle(channel, original) },
    }
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const request = args[0] as { command?: { type?: string; message?: string; submissionId?: string } }
      const command = request.command
      if (command?.type === 'submit_message' && command.message === text) {
        gate.submissionId = command.submissionId ?? ''
        if (runOriginal) await original(event, ...args)
        throw new Error('Fixture interrupted the submission reply channel')
      }
      if (command?.type === 'get_delivery_state' && command.submissionId === gate.submissionId && !gate.allowQuery) {
        throw new Error('Fixture interrupted the receipt query channel')
      }
      return original(event, ...args)
    })
    return gate
  }, { channel: ipcChannels.localPiCommand, text: message, runOriginal: accepted })
}

test('queues during a reply, edits by taking a message back, reorders, and Stop returns unsent messages to the input', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const running = 'Hold this run while editing the delivery queue'
  const clearingRun = 'Hold another run before clearing waiting messages'
  const provider = deferred()
  const clearingProvider = deferred()
  const { app, page, fixture } = await launchFixture(testInfo, {
    [running]: provider.promise,
    [clearingRun]: clearingProvider.promise,
  })
  const reply = await holdSubmissionReply(app, running)
  const rows = pending(page).locator('[data-pending-message-id]')
  const order = async () => (await delivery(page)).items.map((item) => item.message)
  try {
    await send(page, running)
    await expect.poll(() => reply.evaluate((gate) => gate.accepted)).toBe(true)
    await expect(page.locator('[data-outbox-status="sending"]')).toContainText(running)
    await send(page, 'First queued image instruction', 'first.png')
    await send(page, '', 'only-image.png')
    await send(page, 'Last queued instruction')
    await expect(rows).toHaveCount(3)
    expect(fixture.prompts).toEqual([running])
    await reply.evaluate((gate) => gate.release())
    await expect(page.locator('[data-composer-outbox]')).toHaveCount(0)

    // One quiet row per message: Steer stays visible, the full text opens in place.
    const first = rows.filter({ hasText: 'First queued image instruction' })
    await expect(first.getByRole('button', { name: 'Steer', exact: true })).toBeVisible()
    await first.locator('[data-pending-toggle]').click()
    await expect(first.getByRole('img', { name: 'Queued image 1', exact: true })).toHaveAttribute('src', imageSrc)

    // Edit takes the message out of the queue and back into the input, with its image.
    await first.hover()
    await first.getByRole('button', { name: 'Edit in input', exact: true }).click()
    await expect(composer(page)).toHaveText('First queued image instruction')
    await expect(page.getByRole('button', { name: 'Remove image image-1.png', exact: true })).toBeAttached()
    await expect.poll(order).toEqual(['', 'Last queued instruction'])
    await composer(page).fill('Edited first queued image instruction')
    await page.locator('[data-composer-submit]').click()
    await expect(composer(page)).toHaveText('')
    await expect.poll(order).toEqual(['', 'Last queued instruction', 'Edited first queued image instruction'])

    // Reorder from the row's menu and by dragging; delivery follows the list.
    const edited = rows.filter({ hasText: 'Edited first queued image instruction' })
    await edited.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move up', exact: true }).click()
    await expect.poll(order).toEqual(['', 'Edited first queued image instruction', 'Last queued instruction'])
    await edited.dragTo(rows.first(), { targetPosition: { x: 40, y: 3 } })
    await expect.poll(order).toEqual(['Edited first queued image instruction', '', 'Last queued instruction'])
    await page.screenshot({ path: testInfo.outputPath('delivery-editable-queue-light.png') })

    // Stop puts every unsent message back into the input, ahead of the draft,
    // instead of leaving a paused queue to resume.
    await composer(page).fill('Draft typed during the run')
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(page.locator('[data-composer-restored]')).toContainText('Unsent messages moved back to the input (3)')
    await expect(pending(page)).toHaveCount(0)
    await expect.poll(() => delivery(page)).toMatchObject({ paused: false, items: [] })
    const restored = await composer(page).innerText()
    expect(restored.indexOf('Edited first queued image instruction')).toBeLessThan(restored.indexOf('Last queued instruction'))
    expect(restored.indexOf('Last queued instruction')).toBeLessThan(restored.indexOf('Draft typed during the run'))
    await expect(page.locator('[data-composer-attachments] img')).toHaveCount(2)
    await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'dark' } }))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1100, 680))
    await page.setViewportSize({ width: 1100, height: 680 })
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
    await page.screenshot({ path: testInfo.outputPath('delivery-restored-minimum-dark.png') })
    provider.release()
    await page.waitForTimeout(300)
    expect(fixture.prompts).toEqual([running])

    // The restored text and both images go out as one ordinary message.
    await page.locator('[data-composer-submit]').click()
    await expect.poll(() => fixture.prompts.some((prompt) => prompt.includes('Draft typed during the run'))).toBe(true)
    await expect(page.locator('[data-composer-restored]')).toHaveCount(0)
    await expect.poll(async () => (await history(page)).some((message) => message.role === 'user' &&
      Array.isArray(message.content) && message.content.filter((part) => part.type === 'image').length === 2)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('delivery-queue-resumed.png') })

    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0, { timeout: 20_000 })
    await send(page, clearingRun)
    await expect.poll(() => fixture.prompts.includes(clearingRun)).toBe(true)
    await send(page, 'Clear this waiting image', 'clear.png')
    await send(page, 'And this waiting note')
    await expect(rows).toHaveCount(2)
    await pending(page).getByRole('button', { name: 'Clear all', exact: true }).click()
    await expect.poll(() => delivery(page)).toMatchObject({ items: [] })
    await expect(pending(page)).toHaveCount(0)
    clearingProvider.release()
    await page.waitForTimeout(300)
    expect(fixture.prompts).not.toContain('Clear this waiting image')
  } finally {
    provider.release()
    clearingProvider.release()
    await reply.evaluate((gate) => { gate.release(); gate.restore() }).catch(() => {})
    await reply.dispose()
    await app.close()
    await fixture.close()
  }
})

test('steers into the running reply from a row, with ⌘⇧↩, or by default from the setting', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const running = 'Hold this run for a direction adjustment'
  const steering = 'Use the queued screenshot to adjust direction'
  const provider = deferred()
  const { app, page, fixture } = await launchFixture(testInfo, { [running]: provider.promise })
  try {
    await send(page, running)
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await send(page, steering, 'steer.png')
    const item = pending(page).locator('[data-pending-message-id]').filter({ hasText: steering })
    await item.getByRole('button', { name: 'Steer', exact: true }).click()
    await expect(item).toContainText('Steering · next step')
    await expect(item.getByRole('button', { name: 'Steer', exact: true })).toHaveCount(0)
    await expect(item.getByRole('button', { name: 'Edit in input', exact: true })).toHaveCount(0)
    await expect.poll(async () => (await delivery(page)).items[0]).toMatchObject({ mode: 'steer', status: 'delivering' })

    // ⌘⇧↩ does the opposite of the setting: steer while the default is Queue.
    await composer(page).fill('Steer with the shortcut')
    await composer(page).press('ControlOrMeta+Shift+Enter')
    await expect(composer(page)).toHaveText('')
    await expect.poll(async () => (await delivery(page)).items.find((entry) => entry.message === 'Steer with the shortcut'))
      .toMatchObject({ mode: 'steer' })

    // With Steer as the default, Enter steers and ⌘⇧↩ queues.
    await page.evaluate(() => window.pipilot!.settings.update({ composer: { runningSubmit: 'steer' } }))
    await composer(page).fill('Steer by default')
    await composer(page).press('Enter')
    await expect(composer(page)).toHaveText('')
    await composer(page).fill('Queue with the shortcut')
    await composer(page).press('ControlOrMeta+Shift+Enter')
    await expect(composer(page)).toHaveText('')
    await expect.poll(async () => Object.fromEntries((await delivery(page)).items.map((entry) => [entry.message, entry.mode])))
      .toMatchObject({ 'Steer by default': 'steer', 'Queue with the shortcut': 'follow_up' })

    provider.release()
    await expect.poll(() => fixture.prompts.filter((prompt) => prompt === steering).length).toBe(1)
    await expect.poll(async () => (await history(page)).some((message) => message.role === 'user' &&
      Array.isArray(message.content) && message.content.some((part) => part.type === 'text' && part.text === steering) &&
      message.content.some((part) => part.type === 'image' && part.data === pixelPng.toString('base64')))).toBe(true)
    await expect.poll(() => fixture.prompts.includes('Queue with the shortcut'), { timeout: 20_000 }).toBe(true)
    await expect(pending(page)).toHaveCount(0, { timeout: 20_000 })
  } finally {
    provider.release()
    await app.close()
    await fixture.close()
  }
})

test('persists unconfirmed delivery across reload and session switching, and retries a failed item without replacing the new draft', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const { app, page, fixture } = await launchFixture(testInfo)
  const accepted = 'Accepted once although its reply was lost'
  const missing = 'Never reached Pi before its channel broke'
  let fault: Awaited<ReturnType<typeof interruptSubmissionReply>> | undefined
  try {
    await seedAndName(page, 'Delivery A')
    await page.evaluate(async () => {
      const response = await window.pipilot!.localPi.runtime.command({ type: 'new_session' })
      if (!response.success) throw new Error(response.error)
    })
    await expect(composer(page)).toBeVisible()
    await seedAndName(page, 'Delivery B')
    await projectSession(page, 'Delivery A').click()
    await expect(page.getByRole('log', { name: 'Conversation' }).getByText('Fixture response: Seed Delivery A', { exact: true })).toBeVisible()

    fault = await interruptSubmissionReply(app, accepted, true)
    await send(page, accepted, 'accepted.png')
    await expect(page.locator('[data-outbox-status="unknown"]')).toContainText(accepted)
    await page.locator('[data-outbox-status="unknown"] [data-pending-toggle]').click()
    await expect(page.locator('[data-composer-outbox]').getByRole('img')).toHaveAttribute('src', imageSrc)
    await page.screenshot({ path: testInfo.outputPath('delivery-unconfirmed-light.png') })
    await projectSession(page, 'Delivery B').click()
    await expect(page.locator('[data-composer-outbox]')).toHaveCount(0)
    await composer(page).fill('An unrelated draft in Delivery B')
    await projectSession(page, 'Delivery A').click()
    await expect(page.locator('[data-outbox-status="unknown"]')).toContainText(accepted)
    await page.reload()
    await expect(projectSession(page, 'Delivery A')).toBeVisible({ timeout: 20_000 })
    await projectSession(page, 'Delivery A').click()
    await expect(page.locator('[data-outbox-status="unknown"]')).toContainText(accepted)
    await fault.evaluate((gate) => { gate.allowQuery = true })
    await page.getByRole('button', { name: 'Check delivery', exact: true }).click()
    await expect(page.locator('[data-composer-outbox]')).toHaveCount(0)
    expect(fixture.prompts.filter((prompt) => prompt === accepted)).toHaveLength(1)
    await fault.evaluate((gate) => gate.restore())
    await fault.dispose()
    fault = undefined

    fault = await interruptSubmissionReply(app, missing, false)
    await send(page, missing, 'failed.png')
    await expect(page.locator('[data-outbox-status="unknown"]')).toContainText(missing)
    await composer(page).fill('Keep this new draft untouched')
    await fault.evaluate((gate) => { gate.allowQuery = true })
    await page.getByRole('button', { name: 'Check delivery', exact: true }).click()
    const failed = page.locator('[data-outbox-status="failed"]')
    await expect(failed).toContainText(missing)
    await expect(composer(page)).toHaveText('Keep this new draft untouched')
    await page.screenshot({ path: testInfo.outputPath('delivery-edit-failed-light.png') })
    // Editing a failed message takes it back into the input, after the draft.
    await failed.hover()
    await failed.getByRole('button', { name: 'Edit in input', exact: true }).click()
    await expect(page.locator('[data-composer-outbox]')).toHaveCount(0)
    const merged = await composer(page).innerText()
    expect(merged.indexOf('Keep this new draft untouched')).toBeLessThan(merged.indexOf(missing))
    await expect(page.locator('[data-composer-attachments] img')).toHaveCount(1)
    await composer(page).fill('Edited retry is accepted exactly once')
    await page.locator('[data-composer-submit]').click()
    await expect.poll(() => fixture.prompts.filter((prompt) => prompt === 'Edited retry is accepted exactly once').length).toBe(1)
    expect(fixture.prompts).not.toContain(missing)
    await expect.poll(async () => (await history(page)).some((entry) => entry.role === 'user' &&
      Array.isArray(entry.content) && entry.content.some((part) => part.type === 'text' && part.text === 'Edited retry is accepted exactly once') &&
      entry.content.some((part) => part.type === 'image' && part.data === pixelPng.toString('base64')))).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('delivery-retry-keeps-next-draft.png') })
  } finally {
    if (fault) {
      await fault.evaluate((gate) => gate.restore()).catch(() => {})
      await fault.dispose()
    }
    await app.close()
    await fixture.close()
  }
})

test('recovers a saved message after consecutive IndexedDB status-write aborts without locking sending or losing the next draft', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const { app, page, fixture } = await launchFixture(testInfo)
  const message = 'Saved locally before both status updates fail'
  try {
    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.put
      const state = {
        aborted: 0,
        restore: () => { IDBObjectStore.prototype.put = original },
      }
      const probe = window as typeof window & { __deliveryStorageFault?: typeof state }
      probe.__deliveryStorageFault = state
      IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
        const request = key === undefined ? original.call(this, value) : original.call(this, value, key)
        const items = (value as { items?: Array<{ status?: string }> } | null)?.items
        if (this.name === 'conversations' && items?.some((item) => item.status === 'sending' || item.status === 'failed')) {
          state.aborted += 1
          // Exercise the actual IDB abort event, including the failed fallback
          // write. The original pending record remains durably committed.
          this.transaction.abort()
        }
        return request
      }
    })
    await send(page, message, 'durable.png')
    await expect.poll(() => page.evaluate(() => (
      window as typeof window & { __deliveryStorageFault?: { aborted: number } }
    ).__deliveryStorageFault?.aborted)).toBe(2)
    const uncertain = page.locator('[data-outbox-status="unknown"]')
    await expect(uncertain).toContainText(message)
    await expect(uncertain.getByRole('button', { name: 'Check delivery', exact: true })).toBeEnabled()
    await uncertain.locator('[data-pending-toggle]').click()
    await expect(uncertain.getByRole('img', { name: 'Queued image 1', exact: true })).toHaveAttribute('src', imageSrc)
    expect(fixture.prompts).not.toContain(message)

    await page.evaluate(() => (
      window as typeof window & { __deliveryStorageFault?: { restore(): void } }
    ).__deliveryStorageFault?.restore())
    await composer(page).fill('Next draft survives storage recovery')
    await uncertain.getByRole('button', { name: 'Check delivery', exact: true }).click()
    const failed = page.locator('[data-outbox-status="failed"]')
    await expect(failed).toContainText(message)
    await expect(composer(page)).toHaveText('Next draft survives storage recovery')
    await failed.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect.poll(() => fixture.prompts.filter((prompt) => prompt === message).length).toBe(1)
    await expect(page.locator('[data-composer-outbox]')).toHaveCount(0)
    await expect(composer(page)).toHaveText('Next draft survives storage recovery')
    await expect.poll(async () => (await history(page)).some((entry) => entry.role === 'user' &&
      Array.isArray(entry.content) && entry.content.some((part) => part.type === 'text' && part.text === message) &&
      entry.content.some((part) => part.type === 'image' && part.data === pixelPng.toString('base64')))).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('delivery-storage-recovered.png') })
  } finally {
    await page.evaluate(() => (
      window as typeof window & { __deliveryStorageFault?: { restore(): void } }
    ).__deliveryStorageFault?.restore()).catch(() => {})
    await app.close()
    await fixture.close()
  }
})

test('blocks sending and retries until the saved draft cleanup commits, then preserves the next draft across reload', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const { app, page, fixture } = await launchFixture(testInfo)
  const title = 'Draft storage boundary'
  const message = 'Do not deliver before the old draft is durably cleared'
  const nextDraft = 'Keep this new draft after retry and reload'
  try {
    await seedAndName(page, title)
    await composer(page).fill(message)
    await page.locator('input[type="file"]').setInputFiles({ name: 'draft-boundary.png', mimeType: 'image/png', buffer: pixelPng })
    await expect(page.getByRole('button', { name: 'Remove image draft-boundary.png', exact: true })).toBeAttached()
    await expect(page.locator('[data-composer-root]')).toHaveAttribute('data-draft-storage', 'ready')

    await page.evaluate(() => {
      const originalPut = IDBObjectStore.prototype.put
      const originalDelete = IDBObjectStore.prototype.delete
      const state = {
        aborted: 0,
        restore() { IDBObjectStore.prototype.put = originalPut; IDBObjectStore.prototype.delete = originalDelete },
      }
      const abortDraftWrite = (store: IDBObjectStore) => {
        if (store.transaction.db.name !== 'pipilot-composer-drafts') return
        state.aborted += 1
        // Abort the actual browser transaction. Outbox writes must still commit.
        store.transaction.abort()
      }
      ;(window as typeof window & { __draftCleanupFault?: typeof state }).__draftCleanupFault = state
      IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
        const request = key === undefined ? originalPut.call(this, value) : originalPut.call(this, value, key)
        abortDraftWrite(this)
        return request
      }
      IDBObjectStore.prototype.delete = function (key: IDBValidKey | IDBKeyRange) {
        const request = originalDelete.call(this, key)
        abortDraftWrite(this)
        return request
      }
    })
    const aborted = () => page.evaluate(() => (
      window as typeof window & { __draftCleanupFault?: { aborted: number } }
    ).__draftCleanupFault?.aborted ?? 0)
    await page.locator('[data-composer-submit]').click()
    const failed = page.locator('[data-outbox-status="failed"]')
    await expect(failed).toContainText(message)
    await failed.locator('[data-pending-toggle]').click()
    await expect(failed.getByRole('img', { name: 'Queued image 1', exact: true })).toHaveAttribute('src', imageSrc)
    await expect(page.locator('[data-composer-root]')).toHaveAttribute('data-draft-storage', 'error')
    await expect(composer(page)).toHaveText('')
    await expect.poll(aborted).toBeGreaterThan(0)
    expect(fixture.prompts).not.toContain(message)

    // The two real databases now disagree intentionally: the outbox committed,
    // while abort left the original draft on disk. Dispatch must remain blocked.
    const persisted = await page.evaluate(async () => {
      const read = async (name: string) => {
        const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
          const request = indexedDB.open(name, 1)
          request.onsuccess = () => resolveDatabase(request.result)
          request.onerror = () => reject(request.error)
        })
        try {
          return await new Promise<unknown[]>((resolveRecords, reject) => {
            const transaction = database.transaction('conversations', 'readonly')
            const request = transaction.objectStore('conversations').getAll()
            transaction.oncomplete = () => resolveRecords(request.result)
            transaction.onabort = () => reject(transaction.error)
            transaction.onerror = () => reject(transaction.error)
          })
        } finally { database.close() }
      }
      return { outbox: await read('pipilot-composer-outbox'), drafts: await read('pipilot-composer-drafts') }
    })
    expect(persisted.outbox).toEqual([expect.objectContaining({ items: [expect.objectContaining({
      status: 'failed', text: message, images: [{ type: 'image', data: pixelPng.toString('base64'), mimeType: 'image/png' }],
    })] })])
    expect(persisted.drafts).toEqual([expect.objectContaining({
      document: expect.objectContaining({ content: [expect.objectContaining({ content: [{ type: 'text', text: message }] })] }),
      attachments: [expect.objectContaining({ name: 'draft-boundary.png' })],
    })])

    const beforeRetry = await aborted()
    await failed.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect.poll(aborted).toBeGreaterThan(beforeRetry)
    await expect(failed).toContainText(message)
    await expect(failed.getByRole('button', { name: 'Retry', exact: true })).toBeEnabled()
    expect(fixture.prompts).not.toContain(message)

    await page.evaluate(() => (
      window as typeof window & { __draftCleanupFault?: { restore(): void } }
    ).__draftCleanupFault?.restore())
    await composer(page).fill(nextDraft)
    await expect(page.locator('[data-composer-root]')).toHaveAttribute('data-draft-storage', 'ready')
    await failed.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect.poll(() => fixture.prompts.filter((prompt) => prompt === message).length).toBe(1)
    await expect(page.locator('[data-composer-outbox]')).toHaveCount(0)
    await expect(composer(page)).toHaveText(nextDraft)
    await expect.poll(async () => (await history(page)).filter((entry) => entry.role === 'user' &&
      Array.isArray(entry.content) && entry.content.some((part) => part.type === 'text' && part.text === message) &&
      entry.content.some((part) => part.type === 'image' && part.data === pixelPng.toString('base64'))).length).toBe(1)
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await page.reload()
    await projectSession(page, title).click()
    await expect(composer(page)).toHaveText(nextDraft)
    await expect(page.locator('[data-composer-attachments]')).toHaveCount(0)
    await expect(page.locator('[data-composer-outbox]')).toHaveCount(0)
    expect(fixture.prompts.filter((prompt) => prompt === message)).toHaveLength(1)
  } finally {
    await page.evaluate(() => (
      window as typeof window & { __draftCleanupFault?: { restore(): void } }
    ).__draftCleanupFault?.restore()).catch(() => {})
    await app.close()
    await fixture.close()
  }
})
