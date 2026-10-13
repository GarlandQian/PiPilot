import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { closeFixtureApplication } from './close-fixture-application'
import { startPiSdkFixture } from './pi-sdk-fixture'

test('uses message menus to copy exact content, quote a selection and edit a question', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userData = testInfo.outputPath('user-data'), agentDir = testInfo.outputPath('pi-agent'), project = testInfo.outputPath('Menu project')
  await Promise.all([userData, project].map((path) => mkdir(path, { recursive: true })))
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, settings: {
    ...DEFAULT_SETTINGS, locale: 'en-US', notifications: { desktop: false, sound: false }, appearance: { ...DEFAULT_SETTINGS.appearance, reducedMotion: true },
  } }))
  const cwd = await realpath(project), timestamp = '2026-10-01T01:00:00Z'
  const sessions = join(agentDir, 'sessions', `--${cwd.replace(/^[/\\]/u, '').replace(/[/\\:]/gu, '-')}--`)
  await mkdir(sessions, { recursive: true })
  const question = 'Please **review** the snippet.'
  const prompt = `<skill name="review" location="/fixture/SKILL.md">\nPrivate skill instructions\n</skill>\n\n${question}`
  const code = Array.from({ length: 30 }, (_, index) => `const value${index + 1} = ${index + 1}`).join('\n') + '\n'
  const markdown = 'Answer **with formatting** and [documentation](https://example.test/docs).\n\n```ts\n' + code + '```'
  await writeFile(join(sessions, 'menus.jsonl'), [
    { type: 'session', version: 3, id: 'message-menu-session', timestamp, cwd },
    { type: 'message', id: 'question', parentId: null, timestamp, message: { role: 'user', content: prompt, timestamp: 1 } },
    { type: 'message', id: 'answer', parentId: 'question', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: markdown }],
      api: 'openai-completions', provider: 'fixture', model: 'fake-chat', stopReason: 'stop', timestamp: 2,
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } } },
    { type: 'session_info', id: 'name', parentId: 'answer', timestamp, name: 'Message menus' },
  ].map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  const fixture = await startPiSdkFixture({ agentDir })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: { ...process.env, ...fixture.env,
    PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' } })
  const clipboardBefore = await app.evaluate(({ clipboard }) => clipboard.readText())
  try {
    const page = await app.firstWindow(), errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 1000 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await app.evaluate(({ dialog }, directory) => { Object.defineProperty(dialog, 'showOpenDialog', { configurable: true, value: async () => ({ canceled: false, filePaths: [directory] }) }) }, cwd)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).first().click()
    await page.locator('[data-session-list="project"]').getByRole('button', { name: 'Message menus', exact: true }).click()
    const transcript = page.getByRole('log', { name: 'Conversation', exact: true })
    const composer = page.getByRole('textbox', { name: 'Message input', exact: true })
    const user = transcript.locator('[data-conversation-question]')
    const answer = transcript.locator('.conversation-answer-content')
    await expect(answer).toContainText('Answer with formatting')
    await expect(composer).toBeEditable()

    await user.locator('[data-prompt-message]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Copy message as Markdown', exact: true }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(question)

    await answer.locator('p').first().click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Fork from this turn’s question', exact: true })).toBeEnabled()
    await page.getByRole('menuitem', { name: 'Copy message as Markdown', exact: true }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(markdown)

    const snippet = answer.locator('code'), bounds = (await snippet.boundingBox())!
    // Radix's touch long-press opens without a contextmenu event; only the inner menu should open.
    await snippet.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: bounds.x + 30, clientY: bounds.y + 10 })
    await expect(page.getByRole('menu')).toHaveCount(1)
    await page.getByRole('menuitem', { name: 'Copy code', exact: true }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(code)
    await answer.getByRole('link', { name: 'documentation' }).click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Open link', exact: true })).toBeEnabled()
    await page.getByRole('menuitem', { name: 'Copy link address', exact: true }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('https://example.test/docs')

    await composer.fill('Please explain this passage.')
    // A real paragraph selection first leaves the editor; a synthetic Range while
    // Tiptap owns focus can be restored to the editor by its selection observer.
    await answer.locator('p').first().click({ clickCount: 3, position: { x: 10, y: 6 } })
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString().trim())).toBe('Answer with formatting and documentation.')
    // Right-click the highlighted glyphs, not the paragraph's empty full-width gutter.
    await answer.locator('p').first().click({ button: 'right', position: { x: 10, y: 6 } })
    await expect(page.getByRole('menuitem', { name: 'Ask on the side', exact: true })).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath('message-selection-menu.png') })
    // Opening a menu may change focus; its action must use the captured text.
    await page.evaluate(() => window.getSelection()?.removeAllRanges())
    await page.getByRole('menuitem', { name: 'Quote selection', exact: true }).click()
    await expect(composer.locator('[data-precision-reference="message"]')).toHaveCount(1)
    await expect(composer).toContainText('Please explain this passage.')
    await composer.getByRole('button', { name: 'Inspect reference: Assistant response', exact: true }).click()
    await expect(page.locator('[data-slot="popover-content"]')).toContainText('Answer with formatting and documentation.')
    await page.keyboard.press('Escape')
    expect(fixture.prompts).toEqual([])

    // The keyboard path opens the same menu, then uses the existing edit branch action.
    await user.locator('..').focus()
    await page.keyboard.press('Shift+F10')
    await page.getByRole('menuitem', { name: 'Edit and ask again', exact: true }).click()
    await expect(composer).toContainText(question)
    await expect(answer).toHaveCount(0)
    expect(fixture.prompts).toEqual([])
    expect(errors).toEqual([])
  } finally {
    await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), clipboardBefore)
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
