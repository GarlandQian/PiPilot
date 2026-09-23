import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { _electron as electron, expect, test, type ElectronApplication, type Page, type TestInfo } from '@playwright/test'
import { ipcChannels } from '../../src/shared/ipc/contracts'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'

const pixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=', 'base64')
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

test('saves before clearing, allows another send during acceptance, and freezes complete editable queues until Resume', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const running = 'Hold this run while editing the delivery queue'
  const clearingRun = 'Hold another run before clearing paused messages'
  const provider = deferred()
  const clearingProvider = deferred()
  const { app, page, fixture } = await launchFixture(testInfo, {
    [running]: provider.promise,
    [clearingRun]: clearingProvider.promise,
  })
  const reply = await holdSubmissionReply(app, running)
  try {
    await send(page, running)
    await expect.poll(() => reply.evaluate((gate) => gate.accepted)).toBe(true)
    await expect(page.locator('[data-outbox-status="sending"]')).toContainText(running)
    await send(page, 'First queued image instruction', 'first.png')
    await expect(pending(page)).toContainText('1 pending')
    await send(page, '', 'only-image.png')
    await expect(pending(page)).toContainText('2 pending')
    await send(page, 'Last queued instruction')
    await expect(pending(page)).toContainText('3 pending')
    expect(fixture.prompts).toEqual([running])
    await reply.evaluate((gate) => gate.release())
    await expect(page.locator('[data-composer-outbox]')).toHaveCount(0)

    await pending(page).getByRole('button', { name: 'Show pending messages', exact: true }).click()
    const first = pending(page).getByRole('listitem').filter({ hasText: 'First queued image instruction' })
    await first.getByRole('button', { name: 'Edit message', exact: true }).click()
    await first.getByRole('textbox', { name: 'Edit message', exact: true }).fill('Edited first queued image instruction')
    await expect(first.getByRole('img', { name: 'Queued image 1', exact: true })).toHaveAttribute('src', imageSrc)
    await first.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect.poll(async () => (await delivery(page)).items.map((item) => item.message))
      .toEqual(['Edited first queued image instruction', '', 'Last queued instruction'])
    await expect(pending(page).locator('[data-queue-image]')).toHaveCount(2)
    await page.screenshot({ path: testInfo.outputPath('delivery-editable-queue-light.png') })

    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(pending(page)).toContainText('Paused · 3 pending')
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expect.poll(async () => (await delivery(page)).items.map((item) => item.status)).toEqual(['frozen', 'frozen', 'frozen'])
    await send(page, 'New instruction while paused', 'paused.png')
    await expect(pending(page)).toContainText('Paused · 4 pending')
    await expect(pending(page).locator('[data-queue-image]')).toHaveCount(3)
    expect(fixture.prompts).toEqual([running])
    await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'dark' } }))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1100, 680))
    await page.setViewportSize({ width: 1100, height: 680 })
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
    expect(await page.evaluate(() => {
      const rail = document.querySelector<HTMLElement>('[data-pending-message-rail]')!.getBoundingClientRect()
      const editor = document.querySelector<HTMLElement>('[data-composer-surface]')!.getBoundingClientRect()
      return {
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        aligned: Math.abs(rail.left - editor.left) <= 1 && Math.abs(rail.right - editor.right) <= 1,
      }
    })).toEqual({ horizontalOverflow: false, aligned: true })
    await page.screenshot({ path: testInfo.outputPath('delivery-paused-minimum-dark.png') })
    provider.release()
    await page.waitForTimeout(300)
    expect(fixture.prompts).toEqual([running])

    await pending(page).getByRole('button', { name: 'Resume queue', exact: true }).click()
    await expect.poll(() => fixture.prompts.includes('New instruction while paused')).toBe(true)
    await expect(pending(page)).toHaveCount(0)
    await expect.poll(async () => (await history(page)).filter((message) => message.role === 'user' &&
      Array.isArray(message.content) && message.content.some((part) => part.type === 'image')).length).toBe(3)
    await page.screenshot({ path: testInfo.outputPath('delivery-queue-resumed.png') })

    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await send(page, clearingRun)
    await expect.poll(() => fixture.prompts.includes(clearingRun)).toBe(true)
    await send(page, 'Clear this waiting image', 'clear.png')
    await expect(pending(page)).toContainText('1 pending')
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(pending(page)).toContainText('Paused · 1 pending')
    await pending(page).getByRole('button', { name: 'More pending-message actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Clear waiting messages', exact: true }).click()
    await expect.poll(() => delivery(page)).toMatchObject({ paused: true, items: [] })
    await expect(pending(page)).toContainText('Paused · 0 pending')
    await pending(page).getByRole('button', { name: 'Resume queue', exact: true }).click()
    await expect(pending(page)).toHaveCount(0)
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

test('promotes a single queued message with its image into real Pi steering without a global send mode', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const running = 'Hold this run for a direction adjustment'
  const steering = 'Use the queued screenshot to adjust direction'
  const provider = deferred()
  const { app, page, fixture } = await launchFixture(testInfo, { [running]: provider.promise })
  try {
    await send(page, running)
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await send(page, steering, 'steer.png')
    await expect(pending(page)).toContainText('1 pending')
    await pending(page).getByRole('button', { name: 'Show pending messages', exact: true }).click()
    const item = pending(page).getByRole('listitem').filter({ hasText: steering })
    await item.getByRole('button', { name: 'Adjust direction', exact: true }).click()
    await expect(item.getByRole('button', { name: 'Adjust direction', exact: true })).toHaveCount(0)
    await expect(item.getByRole('button', { name: 'Edit message', exact: true })).toHaveCount(0)
    await expect(item.getByRole('img', { name: 'Queued image 1', exact: true })).toHaveAttribute('src', imageSrc)
    await expect.poll(async () => (await delivery(page)).items[0]).toMatchObject({ mode: 'steer', status: 'delivering' })
    provider.release()
    await expect.poll(() => fixture.prompts.filter((prompt) => prompt === steering).length).toBe(1)
    await expect(pending(page)).toHaveCount(0)
    await expect.poll(async () => (await history(page)).some((message) => message.role === 'user' &&
      Array.isArray(message.content) && message.content.some((part) => part.type === 'text' && part.text === steering) &&
      message.content.some((part) => part.type === 'image' && part.data === pixelPng.toString('base64')))).toBe(true)
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
    await failed.getByRole('button', { name: 'Edit message', exact: true }).click()
    await failed.getByRole('textbox', { name: 'Edit message', exact: true }).fill('Edited retry is accepted exactly once')
    await expect(failed.getByRole('img', { name: 'Queued image 1', exact: true })).toHaveAttribute('src', imageSrc)
    await page.screenshot({ path: testInfo.outputPath('delivery-edit-failed-light.png') })
    await failed.getByRole('button', { name: 'Save and retry', exact: true }).click()
    await expect(page.locator('[data-composer-outbox]')).toHaveCount(0)
    await expect.poll(() => fixture.prompts.filter((prompt) => prompt === 'Edited retry is accepted exactly once').length).toBe(1)
    expect(fixture.prompts).not.toContain(missing)
    await expect(composer(page)).toHaveText('Keep this new draft untouched')
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
