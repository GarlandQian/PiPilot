import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'
import { selectInspectorView } from './select-inspector-view'

async function seedSettings(userDataPath: string, theme: 'light' | 'system') {
  await mkdir(userDataPath, { recursive: true })
  await writeFile(join(userDataPath, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: {
      ...DEFAULT_SETTINGS,
      locale: 'en-US',
      appearance: { ...DEFAULT_SETTINGS.appearance, theme, reducedMotion: true },
    },
  }))
}

/** Gate real provider SSE deltas, not the renderer or its authoritative store. */
async function startReadingStream(agentDir: string, initialContent: string) {
  let activeResponse: ServerResponse | undefined
  const chunk = (content: string | null) => ({
    id: 'chatcmpl-reading-fixture',
    object: 'chat.completion.chunk',
    created: 1_780_000_000,
    model: 'fake-chat',
    choices: [{
      index: 0,
      delta: content === null ? {} : { role: 'assistant', content },
      finish_reason: content === null ? 'stop' : null,
    }],
  })
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions' || activeResponse) {
      response.writeHead(404).end()
      return
    }
    request.resume()
    request.on('end', () => {
      activeResponse = response
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      response.write(`data: ${JSON.stringify(chunk(initialContent))}\n\n`)
    })
  })
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture endpoint did not bind')
  const modelPath = join(agentDir, 'models.json')
  const models = JSON.parse(await readFile(modelPath, 'utf8')) as {
    providers: { fixture: { baseUrl: string } }
  }
  models.providers.fixture.baseUrl = `http://127.0.0.1:${address.port}/v1`
  await writeFile(modelPath, JSON.stringify(models))
  return {
    append(content: string) {
      if (!activeResponse || activeResponse.destroyed) throw new Error('No active provider stream')
      activeResponse.write(`data: ${JSON.stringify(chunk(content))}\n\n`)
    },
    finish() {
      if (!activeResponse) throw new Error('No active provider stream')
      activeResponse.write(`data: ${JSON.stringify(chunk(null))}\n\n`)
      activeResponse.end('data: [DONE]\n\n')
    },
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose())
      })
    },
  }
}

function viewportMetrics(scroller: Locator) {
  return scroller.evaluate((element) => ({
    top: element.scrollTop,
    height: element.scrollHeight,
    view: element.clientHeight,
    bottom: element.scrollHeight - element.clientHeight - element.scrollTop,
  }))
}

async function flushLayout(page: Page) {
  await page.evaluate(() => new Promise<void>((resolveFrame) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))
  }))
}

test('preserves near-bottom upward reading intent until a downward gesture or Jump to latest', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const userDataPath = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  await seedSettings(userDataPath, 'light')
  const fixture = await startPiSdkFixture({ agentDir })
  const initial = Array.from({ length: 30 }, (_, index) =>
    `Reading paragraph ${index + 1}: stable transcript text for the native scrolling probe.`,
  ).join('\n\n')
  const stream = await startReadingStream(agentDir, initial)
  const electronApp = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userDataPath },
  })

  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await page.getByRole('textbox', { name: 'Message input', exact: true }).fill('Read a live response')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const log = page.getByRole('log', { name: 'Conversation', exact: true })
    const scroller = log.locator('.scroll-slim')
    const jump = page.getByRole('button', { name: 'Jump to latest', exact: true })
    await expect(log).toContainText('Reading paragraph 30')
    await expect.poll(async () => (await viewportMetrics(scroller)).bottom).toBeLessThanOrEqual(1)
    expect((await viewportMetrics(scroller)).height).toBeGreaterThan((await viewportMetrics(scroller)).view + 100)

    await scroller.focus()
    await scroller.hover()
    await flushLayout(page)
    await page.mouse.wheel(0, -20)
    // Native device scale can leave a fractional CSS-pixel bottom remainder.
    await expect.poll(async () => Math.abs((await viewportMetrics(scroller)).bottom - 20)).toBeLessThanOrEqual(1)
    await expect(jump).toBeVisible()
    const paused = await viewportMetrics(scroller)
    stream.append('\n\nPaused append one.\n\nPaused append two.\n\nPaused append three.')
    await expect(log).toContainText('Paused append three.')
    await flushLayout(page)
    const afterAppend = await viewportMetrics(scroller)
    expect(afterAppend.height).toBeGreaterThan(paused.height)
    expect(Math.abs(afterAppend.top - paused.top)).toBeLessThanOrEqual(1)
    await expect(jump).toBeVisible()

    // Explicit downward input permits following again; content growth alone did not.
    await page.mouse.wheel(0, afterAppend.bottom + 100)
    await expect.poll(async () => (await viewportMetrics(scroller)).bottom).toBeLessThanOrEqual(1)
    await expect(jump).toHaveCount(0)
    stream.append('\n\nFollowing after downward intent.')
    await expect(log).toContainText('Following after downward intent.')
    await expect.poll(async () => (await viewportMetrics(scroller)).bottom).toBeLessThanOrEqual(1)

    await page.mouse.wheel(0, -20)
    await expect.poll(async () => Math.abs((await viewportMetrics(scroller)).bottom - 20)).toBeLessThanOrEqual(1)
    await expect(jump).toBeVisible()
    const pausedAgain = await viewportMetrics(scroller)
    stream.append('\n\nAnother output while paused.\n\nFinal paused paragraph.')
    await expect(log).toContainText('Final paused paragraph.')
    await flushLayout(page)
    expect(Math.abs((await viewportMetrics(scroller)).top - pausedAgain.top)).toBeLessThanOrEqual(1)
    await page.screenshot({ path: testInfo.outputPath('reading-paused-light.png') })
    await jump.click()
    await expect(jump).toHaveCount(0)
    await expect.poll(async () => (await viewportMetrics(scroller)).bottom).toBeLessThanOrEqual(1)
    stream.append('\n\nFollowing after explicit Jump.')
    await expect(log).toContainText('Following after explicit Jump.')
    await expect.poll(async () => (await viewportMetrics(scroller)).bottom).toBeLessThanOrEqual(1)
    stream.finish()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expect(log).toContainText('Reading paragraph 1:')
    await expect(log).toContainText('Following after explicit Jump.')
  } finally {
    await electronApp.close()
    await stream.close()
    await fixture.close()
  }
})

test('updates the live terminal with resolved native system theme without replacing its PTY', async ({}, testInfo) => {
  test.setTimeout(45_000)
  const userDataPath = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  await seedSettings(userDataPath, 'system')
  const fixture = await startPiSdkFixture({ agentDir })
  const electronApp = await electron.launch({
    args: [resolve(process.cwd())],
    env: {
      ...process.env,
      ...fixture.env,
      PIPILOT_E2E_USER_DATA: userDataPath,
      PIPILOT_E2E_TERMINAL_SHELL: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    },
  })

  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    // Playwright defaults to light media emulation; remove it so the real
    // Electron nativeTheme drives matchMedia and the product's system setting.
    await page.emulateMedia({ colorScheme: null })
    await page.setViewportSize({ width: 1440, height: 900 })
    await electronApp.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light' })
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await selectInspectorView(page, 'Terminal')
    const panel = page.locator('[data-terminal-status]')
    await expect(panel).toHaveAttribute('data-terminal-status', 'running')
    const activeTerminal = await page.evaluate(async () => {
      const navigation = await window.pipilot!.conversation.get()
      return window.pipilot!.terminal.create(navigation.activeScope, 80, 24)
    })
    expect(activeTerminal.reused).toBe(true)
    const xterm = await panel.locator('.xterm').elementHandle()
    if (!xterm) throw new Error('Live xterm element is missing')
    const colors = () => panel.evaluate((element) => {
      const viewport = element.querySelector('.xterm-scrollable-element')
      const rows = element.querySelector('.xterm-rows')
      if (!viewport || !rows) throw new Error('Live xterm rendering is missing')
      return {
        background: getComputedStyle(viewport).backgroundColor,
        foreground: getComputedStyle(rows).color,
      }
    })
    const light = await colors()
    expect(light.background).toBe('rgb(240, 239, 235)')
    expect(light.foreground).toBe('rgb(41, 40, 36)')
    for (const theme of ['dark', 'light'] as const) {
      await electronApp.evaluate(({ nativeTheme }, nextTheme) => { nativeTheme.themeSource = nextTheme }, theme)
      await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
        .toBe(theme === 'dark')
      await expect.poll(colors).toEqual(theme === 'dark'
        ? { background: 'rgb(22, 23, 25)', foreground: 'rgb(233, 229, 223)' }
        : light)
      expect(await xterm.evaluate((element) => element.isConnected && element === document.querySelector('[data-terminal-status] .xterm'))).toBe(true)
      const current = await page.evaluate(async ({ scope, terminalId }) => {
        const session = await window.pipilot!.terminal.create(scope, 80, 24)
        const settings = await window.pipilot!.settings.get()
        return { sameId: session.terminalId === terminalId, reused: session.reused, theme: settings.settings.appearance.theme }
      }, { scope: activeTerminal.scope, terminalId: activeTerminal.terminalId })
      expect(current).toEqual({ sameId: true, reused: true, theme: 'system' })
      await page.screenshot({ path: testInfo.outputPath(`terminal-system-${theme}.png`) })
    }
  } finally {
    await electronApp.close()
    await fixture.close()
  }
})
