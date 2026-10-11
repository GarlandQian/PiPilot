import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { closeFixtureApplication } from './close-fixture-application'
import { startPiSdkFixture } from './pi-sdk-fixture'

async function seed(page: Page, name: string) {
  const composer = page.getByRole('textbox', { name: 'Message input', exact: true })
  await composer.fill(name)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('log', { name: 'Conversation' }).getByText(`Fixture response: ${name}`, { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  await page.evaluate((title) => window.pipilot!.localPi.runtime.command({ type: 'set_session_name', name: title }), name)
  await expect(page.getByRole('region', { name: 'Chats', exact: true }).getByRole('button', { name, exact: true })).toBeVisible()
}

test('pops a conversation out into its own window and jumps to the next one needing attention', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userData = testInfo.outputPath('user-data'), agentDir = testInfo.outputPath('pi-agent')
  await mkdir(userData, { recursive: true })
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, settings: {
    ...DEFAULT_SETTINGS, locale: 'en-US', notifications: { desktop: false, sound: false } } }))
  const fixture = await startPiSdkFixture({ agentDir })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' } })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await seed(page, 'First chat')

    // ⋯ › Open in New Window shows the same conversation in a small window.
    await page.getByRole('button', { name: 'Conversation actions', exact: true }).click()
    const opened = app.waitForEvent('window')
    await page.getByRole('menuitem', { name: 'Open in New Window', exact: true }).click()
    const popout = await opened
    await expect(popout.locator('[data-popout]')).toBeVisible()
    await expect(popout.locator('[data-popout-transcript]')).toContainText('Fixture response: First chat', { timeout: 20_000 })
    expect(await popout.title()).toBe('First chat')

    // Sending from the pop-out runs in the shared conversation.
    await popout.locator('[data-popout-composer]').fill('From the window')
    await popout.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(popout.locator('[data-popout-transcript]')).toContainText('Fixture response: From the window', { timeout: 20_000 })
    await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('Fixture response: From the window', { timeout: 20_000 })

    await popout.locator('[data-popout-pin]').click()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.isAlwaysOnTop()))).toBe(true)
    // Opening it again focuses the same window.
    await page.getByRole('button', { name: 'Conversation actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Open in New Window', exact: true }).click()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2)
    await popout.close()
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)

    // ⌘⌥A / Ctrl+Alt+A opens the next conversation needing attention.
    await page.getByRole('button', { name: 'New chat', exact: true }).click()
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await seed(page, 'Second chat')
    const chats = page.getByRole('region', { name: 'Chats', exact: true })
    const first = chats.getByRole('button', { name: 'First chat', exact: true })
    // Its reply from the pop-out finished in the background, so it is unread.
    await expect(first.locator('..').locator('[data-session-indicator="unread"]')).toHaveCount(1)
    await page.locator('body').press(process.platform === 'darwin' ? 'Meta+Alt+KeyA' : 'Control+Alt+KeyA')
    await expect(chats.getByRole('button', { name: 'First chat', exact: true })).toHaveAttribute('aria-current', 'page', { timeout: 20_000 })
    await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('Fixture response: First chat')
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
