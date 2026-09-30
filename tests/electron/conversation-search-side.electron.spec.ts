import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { inspectorDetailsSessionEntries } from './inspector-details-fixture'
import { startPiSdkFixture } from './pi-sdk-fixture'
import { closeFixtureApplication } from './close-fixture-application'

test('searches message content and saved sessions, and asks a side question while the foreground keeps running', async ({}, testInfo) => {
  test.setTimeout(100_000)
  const userData = testInfo.outputPath('user-data'), project = testInfo.outputPath('Search project'), agentDir = testInfo.outputPath('pi-agent')
  await Promise.all([userData, project].map((path) => mkdir(path, { recursive: true })))
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, settings: {
    ...DEFAULT_SETTINGS, locale: 'en-US', notifications: { desktop: false }, appearance: { ...DEFAULT_SETTINGS.appearance, reducedMotion: true },
  } }))
  const cwd = await realpath(project)
  const sessionDirectory = join(agentDir, 'sessions', `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`)
  await mkdir(sessionDirectory, { recursive: true })
  await writeFile(join(sessionDirectory, 'history.jsonl'), inspectorDetailsSessionEntries(cwd).map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  await writeFile(join(sessionDirectory, 'another.jsonl'), inspectorDetailsSessionEntries(cwd).map((entry) => JSON.stringify(entry)
    .replace(/real-sdk-session/gu, 'another-sdk-session').replace(/Existing project session/gu, 'Another project session').replace(/Selected session history response/gu, 'Distinctive archive needle beyond title')).join('\n') + '\n')
  let finishMain!: () => void
  const gate = new Promise<void>((resolveGate) => { finishMain = resolveGate })
  const fixture = await startPiSdkFixture({ agentDir, completionGates: { 'Keep main running': gate } })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: { ...process.env, ...fixture.env,
    PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' } })
  const page = await app.firstWindow(), errors: string[] = []
  const processErrors: string[] = []
  app.process().stderr?.on('data', (value: Buffer) => processErrors.push(value.toString()))
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1000 })
  const composer = page.getByRole('textbox', { name: 'Message input', exact: true })
  const conversation = page.getByRole('log', { name: 'Conversation', exact: true })
  try {
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await app.evaluate(({ dialog }, path) => { Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true, value: async () => ({ canceled: false, filePaths: [path] }),
    }) }, project)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
    const sessions = page.getByRole('region', { name: 'Projects', exact: true })
    await sessions.getByRole('button', { name: 'Existing project session', exact: true }).click()
    await expect(conversation).toContainText('Selected session history response')
    await page.getByRole('button', { name: 'Search conversations', exact: true }).click()
    let search = page.getByRole('dialog', { name: 'Search conversations', exact: true })
    await search.getByRole('textbox', { name: 'Search message content' }).fill('history response')
    await expect(search.getByRole('button').filter({ hasText: 'history response' })).toHaveCount(1)
    await search.getByRole('textbox', { name: 'Search message content' }).press('Enter')
    await expect(search).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => CSS.highlights.get('pipilot-search')?.size ?? 0)).toBeGreaterThan(0)
    expect(await conversation.locator('[data-conversation-response]').first().evaluate((node) => getComputedStyle(node, '::highlight(pipilot-search)').backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
    await page.getByRole('button', { name: 'Search conversations', exact: true }).click()
    search = page.getByRole('dialog', { name: 'Search conversations', exact: true })
    await search.getByRole('textbox', { name: 'Search message content' }).fill('All checks passed')
    await expect(search.getByRole('button').filter({ hasText: 'All checks passed' })).toHaveCount(1)
    await search.getByRole('textbox', { name: 'Search message content' }).press('Enter')
    await expect(conversation.locator('[data-conversation-search-result] mark')).toHaveText('All checks passed')
    await page.getByRole('button', { name: 'Search conversation content…', exact: true }).click()
    search = page.getByRole('dialog', { name: 'Search conversations', exact: true })
    await search.getByRole('textbox', { name: 'Search message content' }).fill('Distinctive archive needle')
    const match = search.getByRole('button').filter({ hasText: 'Distinctive archive needle' })
    await expect(match).toHaveCount(1)
    await match.click()
    await expect(conversation).toContainText('Distinctive archive needle beyond title')
    await expect.poll(() => page.evaluate(() => CSS.highlights.get('pipilot-search')?.size ?? 0)).toBeGreaterThan(0)
    await sessions.getByRole('button', { name: 'Existing project session', exact: true }).click()
    await expect(composer).toBeEditable()
    await composer.fill('Keep main running')
    await page.locator('[data-composer-submit]').click()
    await expect.poll(() => fixture.prompts.includes('Keep main running')).toBe(true)
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.localPi.runtime.status()).sessionStatuses?.some((item) => item.selected && item.status === 'running'))).toBe(true)
    const before = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    const message = conversation.locator('[data-precision-source="message"]').filter({ hasText: 'Selected session history response' })
    await message.locator('p').first().evaluate((element) => {
      const range = document.createRange(); range.selectNodeContents(element)
      window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
      element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Shift' }))
    })
    await message.getByRole('button', { name: 'Ask on the side', exact: true }).click()
    const side = page.locator('[data-side-conversations]')
    await side.getByRole('textbox', { name: 'Ask about the selection…', exact: true }).fill('Explain this selection briefly')
    await side.getByRole('button', { name: 'Send side question', exact: true }).click()
    await expect(side.getByRole('log')).toContainText('Fixture response:', { timeout: 20_000 })
    await expect(side.getByRole('status')).toHaveText('Finished', { timeout: 10_000 })
    const during = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    expect(during.sessionState?.sessionId).toBe(before.sessionState?.sessionId)
    expect(during.sessionStatuses?.some((item) => item.selected && item.status === 'running')).toBe(true)
    expect(fixture.prompts.filter((prompt) => prompt.includes('Explain this selection briefly'))).toHaveLength(1)
    await side.getByRole('textbox', { name: 'Ask about the selection…', exact: true }).fill('Follow up on the side')
    await side.getByRole('button', { name: 'Send side question', exact: true }).click()
    await expect(side.getByRole('log')).toContainText('Fixture response: Follow up on the side')
    await page.screenshot({ path: testInfo.outputPath('side-question.png') })
    await side.getByRole('button', { name: 'Close this view (keep the saved conversation running)', exact: true }).click()
    expect((await page.evaluate(() => window.pipilot!.localPi.runtime.status())).sessionStatuses?.some((item) => item.selected && item.status === 'running')).toBe(true)
    finishMain()
    await expect(conversation).toContainText('Fixture response: Keep main running')
    expect(errors).toEqual([])
  } catch (error) {
    await page.screenshot({ path: testInfo.outputPath('search-side-failure.png') }).catch(() => undefined)
    await testInfo.attach('isolated-side-diagnostics', { body: JSON.stringify({
      sideText: await page.locator('[data-side-conversations]').textContent().catch(() => null),
      runtime: await page.evaluate(() => window.pipilot!.localPi.runtime.status()).catch(() => null),
      prompts: fixture.prompts, errors, processErrors,
    }), contentType: 'application/json' })
    throw error
  } finally { finishMain(); await closeFixtureApplication(app); await fixture.close() }
})
