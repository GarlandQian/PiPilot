import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { closeFixtureApplication } from './close-fixture-application'
import { startPiSdkFixture } from './pi-sdk-fixture'

async function seedSettings(userData: string) {
  await mkdir(userData, { recursive: true })
  await writeFile(join(userData, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: {
      ...DEFAULT_SETTINGS,
      locale: 'en-US',
      appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true },
    },
  }))
  await writeFile(join(userData, 'pi-managed-packages.json'), JSON.stringify({ version: 1, mcpOptedOut: true }))
}

async function send(page: Page, prompt: string) {
  await page.getByRole('textbox', { name: 'Message input', exact: true }).fill(prompt)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
}

function responseFor(page: Page, prompt: string) {
  return page.locator('[data-conversation-response]').filter({
    has: page.locator('[data-conversation-question]').filter({ hasText: prompt }),
  })
}

async function expectWorkVisibility(response: Locator, expanded: boolean) {
  await expect(response.locator('[data-response-work-toggle]')).toHaveAttribute('aria-expanded', String(expanded))
  await expect.poll(() => response.locator('[data-response-region="work"]').evaluateAll((elements, expanded) => (
    elements.length > 0 && elements.every((element) => (element as HTMLElement).hidden === !expanded)
  ), expanded)).toBe(true)
  // aria-controls must target all work wrappers, including lazy, hidden rows.
  await expect.poll(() => response.locator('[data-response-work-toggle]').evaluate((element) => {
    const ids = element.getAttribute('aria-controls')?.split(' ').filter(Boolean) ?? []
    return ids.length > 0 && ids.every((id) => document.getElementById(id)?.dataset.responseRegion === 'work')
  })).toBe(true)
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  for (const selector of ['[role="log"]', '[data-composer-surface]', '[data-conversation-response]']) {
    await expect.poll(() => page.locator(selector).evaluateAll((elements) => elements.every((element) => (
      element.scrollWidth <= element.clientWidth + 1
    )))).toBe(true)
  }
}

test('preserves live work reading, text identity, and final actions across settlement and session reopening', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const writeTarget = testInfo.outputPath('workspace', 'response-evidence.txt')
  const writeContent = 'Real SDK write evidence for the response work log.\n'
  const prompt = 'Write the response work log evidence'
  const commentary = 'I will write the evidence file, then report the result.'
  await seedSettings(userData)
  await mkdir(testInfo.outputPath('workspace'), { recursive: true })
  const fixture = await startPiSdkFixture({
    agentDir,
    writeToolPrompts: { [prompt]: { path: writeTarget, content: writeContent } },
    writeToolCommentary: { [prompt]: { text: commentary, delayMs: 2_000 } },
    reasoningDelays: { [prompt]: 1_500 },
    completionDelays: { [prompt]: 2_000 },
  })
  const app = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' },
  })
  let clipboardBefore: string | undefined
  try {
    const page = await app.firstWindow()
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    clipboardBefore = await app.evaluate(({ clipboard }) => clipboard.readText())
    await send(page, prompt)
    const response = responseFor(page, prompt)
    const commentaryBody = response.locator('.conversation-answer-content').filter({ hasText: commentary })
    await expect(commentaryBody).toBeVisible()
    const retainedCommentary = await commentaryBody.elementHandle()
    if (!retainedCommentary) throw new Error('Expected the live assistant commentary DOM node')
    expect(await retainedCommentary.evaluate((element) => element.closest('[data-response-region]')?.getAttribute('data-response-region'))).toBe('answer')

    await expect.poll(() => readFile(writeTarget, 'utf8').catch(() => ''), { timeout: 20_000 }).toBe(writeContent)
    await expectWorkVisibility(response, true)
    await expect.poll(() => retainedCommentary.evaluate((element) => (
      element.isConnected && element.closest('[data-response-region]')?.getAttribute('data-response-region') === 'work'
    ))).toBe(true)
    expect(await commentaryBody.evaluate((element, retained) => element === retained, retainedCommentary)).toBe(true)

    // New SSE reasoning and answer text must not undo a manual collapse.
    await response.locator('[data-response-work-toggle]').click()
    await expectWorkVisibility(response, false)
    const reasoning = response.getByRole('button', { name: /^(?:Thinking|Thought)/ })
    await expect(reasoning).toBeVisible()
    await expect(reasoning).toHaveAttribute('aria-expanded', 'true')
    await expect(response.getByText(`Fixture reasoning: ${prompt}`, { exact: true })).toBeVisible()
    const answer = response.locator('[data-response-region="answer"]')
    await expect(answer).toContainText(`Fixture response: ${prompt}`)
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await expectWorkVisibility(response, false)
    expect(await retainedCommentary.evaluate((element) => element.isConnected)).toBe(true)

    // Once explicitly reopened, finishing must not retract the work being read.
    await response.locator('[data-response-work-toggle]').click()
    await expectWorkVisibility(response, true)
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expectWorkVisibility(response, true)
    await expect(reasoning).toHaveAttribute('aria-expanded', 'true')
    await expect(response.locator('[data-response-work-toggle]')).toContainText('Work completed')
    const copy = response.getByRole('button', { name: 'Copy response', exact: true })
    await expect(copy).toBeVisible()
    await expect(response.getByRole('button', { name: 'Fork from this response', exact: true })).toBeEnabled()
    await copy.click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(`${commentary}\n\nFixture response: ${prompt}`)

    const named = await page.evaluate(() => window.pipilot!.localPi.runtime.command({ type: 'set_session_name', name: 'Response reading fixture' }))
    expect(named.success).toBe(true)
    await expect(page.getByRole('button', { name: 'Response reading fixture', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'New general chat', exact: true }).click()
    await expect(page.locator('[data-conversation-welcome]')).toBeVisible()
    await page.getByRole('button', { name: 'Response reading fixture', exact: true }).click()
    await expect(answer).toContainText(`Fixture response: ${prompt}`)
    await expectWorkVisibility(response, false)
    await expect(reasoning).toBeVisible()
    await expect(reasoning).toHaveAttribute('aria-expanded', 'false')
    await reasoning.click()
    await expect(reasoning).toHaveAttribute('aria-expanded', 'true')
    await expect(response.locator('p').filter({ hasText: `Fixture reasoning: ${prompt}` })).toBeVisible()
    await expectWorkVisibility(response, false)
    await expect(response.getByRole('button', { name: 'Copy response', exact: true })).toBeVisible()
    await expect(response.getByRole('button', { name: 'Fork from this response', exact: true })).toBeEnabled()

    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((theme) => window.pipilot!.settings.update({ appearance: { theme } }), theme)
      await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark'))).toBe(theme === 'dark')
      for (const width of [1440, 1100]) {
        await page.setViewportSize({ width, height: width === 1100 ? 680 : 900 })
        await expectNoHorizontalOverflow(page)
        await expectWorkVisibility(response, false)
        if (width === 1440) await expect(page.getByRole('button', { name: 'Jump to latest', exact: true })).toHaveCount(0)
        await page.mouse.move(width - 10, 10)
        await page.screenshot({ path: testInfo.outputPath(`conversation-response-${theme}-${width}.png`), animations: 'disabled' })
      }
    }
    await response.locator('[data-response-work-toggle]').click()
    await expectWorkVisibility(response, true)
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath('conversation-response-expanded-dark-1100.png'), animations: 'disabled' })
    expect(fixture.prompts.filter((value) => value === prompt)).toHaveLength(2)
    expect(pageErrors).toEqual([])
    await retainedCommentary.dispose()
  } finally {
    if (clipboardBefore !== undefined) await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboardBefore)
    await closeFixtureApplication(app)
    await fixture.close()
  }
})

async function seedNoticeExtension(agentDir: string, prompt: string) {
  // Uses real public SDK events and UI calls. No runtime, IPC, or renderer
  // state is replaced. Plan card persistence has focused projection coverage.
  await writeFile(join(agentDir, 'extensions', 'conversation-response.js'), `
export default function responseFixture(pi) {
  pi.on('before_agent_start', (event, ctx) => {
    if (event.prompt !== ${JSON.stringify(prompt)}) return
    ctx.ui.setWorkingMessage('**Checking** the persistent response records.')
    ctx.ui.setStatus('response-fixture', 'Checking the fixture output.')
    ctx.ui.notify('Fixture warning: **review the response output**.', 'warning')
    ctx.ui.notify('Fixture error: **this exact notification stays visible**.', 'error')
  })
}
`)
}

test('keeps warning and error notifications and stopped-response notices visible outside collapsed work', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const prompt = 'Keep the response notifications visible'
  const stoppedPrompt = 'Stop this response while reasoning'
  let releaseProvider = () => {}
  const providerGate = new Promise<void>((resolveGate) => { releaseProvider = resolveGate })
  let releaseReasoning = () => {}
  const reasoningGate = new Promise<void>((resolveGate) => { releaseReasoning = resolveGate })
  await seedSettings(userData)
  await mkdir(testInfo.outputPath('workspace'), { recursive: true })
  const fixture = await startPiSdkFixture({
    agentDir,
    writeToolPrompts: { [stoppedPrompt]: { path: testInfo.outputPath('workspace', 'before-stop.txt'), content: 'Tool completed before response stopped.\n' } },
    promptGates: { [prompt]: providerGate },
    reasoningDelays: { [prompt]: 1_500, [stoppedPrompt]: 0 },
    reasoningGates: { [stoppedPrompt]: reasoningGate },
    completionDelays: { [prompt]: 1_000 },
  })
  await seedNoticeExtension(agentDir, prompt)
  const app = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' },
  })
  const runtimeEvents: unknown[] = []
  try {
    const page = await app.firstWindow()
    await page.exposeFunction('recordResponseRuntimeEvent', (event: unknown) => {
      if (runtimeEvents.length < 1_000) runtimeEvents.push(event)
    })
    await page.evaluate(() => {
      const record = (window as unknown as { recordResponseRuntimeEvent(event: unknown): Promise<void> }).recordResponseRuntimeEvent
      window.pipilot!.localPi.runtime.subscribeEvents((envelope) => {
        void record({ at: Date.now(), event: envelope })
      })
      window.pipilot!.localPi.runtime.subscribe(({ snapshot }) => {
        void record({ at: Date.now(), runtime: {
          generation: snapshot.generation, state: snapshot.state,
          diagnostics: snapshot.diagnostics, sessionState: snapshot.sessionState,
        } })
      })
    })
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.setViewportSize({ width: 1100, height: 680 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await send(page, prompt)
    const response = responseFor(page, prompt)
    const warning = response.getByText('Fixture warning: review the response output.', { exact: true })
    const error = response.getByText('Fixture error: this exact notification stays visible.', { exact: true })
    await expect(warning).toBeVisible()
    await expect(error).toBeVisible()
    await expect(warning.locator('strong')).toHaveText('review the response output')
    await expect(error.locator('strong')).toHaveText('this exact notification stays visible')
    await expectWorkVisibility(response, true)
    const thinking = response.getByRole('button', { name: /^(?:Thinking|Thought)/, includeHidden: true })
    await expect(thinking).toHaveCount(0)
    await response.locator('[data-response-work-toggle]').click()
    await expectWorkVisibility(response, false)
    await expect(warning).toBeVisible()
    await expect(error).toBeVisible()
    releaseProvider()
    await expect(thinking).toBeVisible()
    await expect(thinking).toHaveAttribute('aria-expanded', 'true')
    await expect(response.getByText(`Fixture reasoning: ${prompt}`, { exact: true })).toBeVisible()
    await expectWorkVisibility(response, false)
    await expect(response.locator('[data-response-region="answer"]')).toContainText(`Fixture response: ${prompt}`)
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expectWorkVisibility(response, false)
    // Thinking stays independently readable, including when it first arrives
    // while tool work is closed. Completion must not retract an open disclosure.
    await expect(thinking).toBeVisible()
    await expect(thinking).toHaveAttribute('aria-expanded', 'true')
    await expect(response.getByRole('button', { name: /^Thought for [1-9]\d*s$/ })).toBeVisible()
    await thinking.click()
    await expect(thinking).toHaveAttribute('aria-expanded', 'false')
    await expect(response.getByText(`Fixture reasoning: ${prompt}`, { exact: true })).toBeHidden()
    await thinking.click()
    await expect(response.locator('p').filter({ hasText: `Fixture reasoning: ${prompt}` })).toBeVisible()
    await expectWorkVisibility(response, false)
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath('conversation-persistent-records-light-1100.png'), animations: 'disabled' })

    await send(page, stoppedPrompt)
    const stopped = responseFor(page, stoppedPrompt)
    await expectWorkVisibility(stopped, true)
    await expect.poll(() => fixture.prompts.filter((value) => value === stoppedPrompt).length, { timeout: 20_000 }).toBe(2)
    await expect(stopped.getByText(`Fixture reasoning: ${stoppedPrompt}`, { exact: true })).toBeVisible()
    await stopped.locator('[data-response-work-toggle]').click()
    await expectWorkVisibility(stopped, false)
    await expect(stopped.getByRole('button', { name: /^Thinking/ })).toBeVisible()
    await expect(stopped.getByText(`Fixture reasoning: ${stoppedPrompt}`, { exact: true })).toBeVisible()
    await expect(stopped.getByText('Fixture warning: review the response output.', { exact: true })).toHaveCount(0)
    await expect(stopped.getByText('Fixture error: this exact notification stays visible.', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expectWorkVisibility(stopped, false)
    await expect(stopped.getByText('Response stopped.', { exact: true })).toBeVisible()
    await expect(stopped.locator('[data-response-work-toggle]')).toContainText('Response stopped')
    await expect(stopped.getByRole('button', { name: 'Copy response', exact: true })).toHaveCount(0)
    await expect(warning).toBeVisible()
    await expect(error).toBeVisible()
    await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'dark' } }))
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath('conversation-stopped-and-persistent-dark-1100.png'), animations: 'disabled' })
    expect(pageErrors).toEqual([])
  } finally {
    await testInfo.attach('response-runtime-events', {
      body: JSON.stringify(runtimeEvents, null, 2), contentType: 'application/json',
    })
    releaseProvider()
    releaseReasoning()
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
