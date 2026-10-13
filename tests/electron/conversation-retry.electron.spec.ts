import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { closeFixtureApplication } from './close-fixture-application'
import { startPiSdkFixture } from './pi-sdk-fixture'

async function seedSettings(userData: string) {
  await mkdir(userData, { recursive: true })
  await writeFile(join(userData, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US', appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true } },
  }))
}

async function send(page: Page, prompt: string) {
  await page.getByRole('textbox', { name: 'Message input', exact: true }).fill(prompt)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
}

test('explains a permanent error and retries the response without duplicating the prompt or completed tools', { tag: '@core' }, async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const outputFile = testInfo.outputPath('completed-write.txt')
  const prompt = 'Write once and recover the final answer'
  const bodies: unknown[] = []
  let rejectAnswer = true
  await seedSettings(userData)
  const fixture = await startPiSdkFixture({
    agentDir, retryEnabled: true,
    writeToolPrompts: { [prompt]: { path: outputFile, content: 'already completed' } },
    writeToolCommentary: { [prompt]: { text: 'I will preserve this completed work.', delayMs: 0 } },
    providerFault: ({ body, hasWriteResult }) => {
      bodies.push(body)
      return hasWriteResult && rejectAnswer ? { kind: 'http', status: 400, message: "role 'developer' is not allowed; api_key=fixture-secret-123456789" } : null
    },
  })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' } })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await send(page, prompt)
    const failure = page.locator('[data-response-error="error"]')
    await expect(failure).toContainText('The model service rejected the request or endpoint configuration.')
    await expect(failure).toContainText('Not retried automatically.')
    await expect(page.getByText('I will preserve this completed work.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    expect(fixture.requests).toHaveLength(2)
    await failure.getByRole('button', { name: 'Error details', exact: true }).click()
    await expect(failure).toContainText("role 'developer' is not allowed")
    await expect(failure).not.toContainText('fixture-secret-123456789')
    await expect(page.getByRole('log', { name: 'Conversation' })).not.toContainText('[Empty assistant message]')
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((theme) => window.pipilot!.settings.update({ appearance: { theme } }), theme)
      await page.setViewportSize({ width: 1100, height: 680 })
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`response-error-${theme}.png`), animations: 'disabled' })
    }
    rejectAnswer = false
    await failure.getByRole('button', { name: 'Retry response', exact: true }).click()
    await expect(page.getByText(`Fixture response: ${prompt}`, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expect(page.locator('[data-conversation-question]').filter({ hasText: prompt })).toHaveCount(1)
    expect(fixture.requests).toHaveLength(3)
    expect(fixture.requests.filter((request) => !request.hasWriteResult)).toHaveLength(1)
    const final = bodies[bodies.length - 1] as { messages: { role: string; content: unknown }[] }
    expect(final.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    expect(final.messages.filter((message) => message.role === 'tool')).toHaveLength(1)
    expect(await readFile(outputFile, 'utf8')).toBe('already completed')
    expect(errors).toEqual([])
  } finally { await closeFixtureApplication(app); await fixture.close() }
})

test('uses native retries for HTTP 503 and HTTP 429 responses and enforces the configured retry limit', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const overloadedPrompt = 'Recover from HTTP 503 service unavailability'
  const throttledPrompt = 'Recover from HTTP 429 rate limiting'
  const unavailablePrompt = 'Enforce two retries'
  await seedSettings(userData)
  const fixture = await startPiSdkFixture({
    agentDir, retryEnabled: true, retryMaxRetries: 2, retryBaseDelayMs: 1_000,
    providerFault: ({ prompt, attempt }) => prompt === overloadedPrompt && attempt === 1 ? { kind: 'http', status: 503, message: 'Service unavailable' }
      : prompt === throttledPrompt && attempt <= 2 ? { kind: 'http', status: 429, message: 'Too many requests. Please retry later.' }
      : prompt === unavailablePrompt ? { kind: 'http', status: 503, message: 'Service unavailable' } : null,
  })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' } })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await send(page, overloadedPrompt)
    await expect(page.getByText(`Fixture response: ${overloadedPrompt}`, { exact: true })).toBeVisible({ timeout: 15_000 })
    expect(fixture.prompts.filter((prompt) => prompt === overloadedPrompt)).toHaveLength(2)
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await send(page, throttledPrompt)
    await expect(page.getByText(`Fixture response: ${throttledPrompt}`, { exact: true })).toBeVisible({ timeout: 15_000 })
    expect(fixture.prompts.filter((prompt) => prompt === throttledPrompt)).toHaveLength(3)
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await send(page, unavailablePrompt)
    const failure = page.locator('[data-response-error="error"]').last()
    await expect(failure).toContainText('Automatic retries ended after 2 attempts.', { timeout: 20_000 })
    await expect(failure.getByRole('button', { name: 'Retry response', exact: true })).toBeEnabled()
    expect(fixture.prompts.filter((prompt) => prompt === unavailablePrompt)).toHaveLength(3)
    await expect(page.getByRole('log', { name: 'Conversation' })).not.toContainText('[Empty assistant message]')
    await page.screenshot({ path: testInfo.outputPath('retry-exhausted.png'), animations: 'disabled' })
    expect(errors).toEqual([])
  } finally { await closeFixtureApplication(app); await fixture.close() }
})

test('keeps the manual retry entry after stopping a countdown and reloading the conversation', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const prompt = 'Stop the countdown and recover later'
  let failing = true
  await seedSettings(userData)
  const fixture = await startPiSdkFixture({
    agentDir, retryEnabled: true, retryBaseDelayMs: 10_000,
    providerFault: () => failing ? { kind: 'http', status: 503, message: 'Service unavailable' } : null,
  })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' } })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await send(page, prompt)
    await page.locator('[data-response-error]').getByRole('button', { name: 'Stop retrying', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expect(page.locator('[data-response-error]')).toContainText('Automatic retries were stopped.')
    await page.reload()
    const retry = page.locator('[data-response-error]').getByRole('button', { name: 'Retry response', exact: true })
    await expect(retry).toBeEnabled({ timeout: 15_000 })
    expect(fixture.prompts).toHaveLength(1)
    failing = false
    await retry.click()
    await expect(page.getByText(`Fixture response: ${prompt}`, { exact: true })).toBeVisible()
    await expect(page.locator('[data-conversation-question]').filter({ hasText: prompt })).toHaveCount(1)
    expect(fixture.prompts).toHaveLength(2)
  } finally { await closeFixtureApplication(app); await fixture.close() }
})
