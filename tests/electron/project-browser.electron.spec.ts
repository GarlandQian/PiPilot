import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { closeFixtureApplication } from './close-fixture-application'
import { startPiSdkFixture } from './pi-sdk-fixture'

const PAGE = `<!doctype html><html><head><title>Fixture shop</title></head><body style="margin:0;font-family:sans-serif">
<header style="padding:24px"><button id="buy" style="background:#0a84ff;color:white;border:0;border-radius:8px;padding:12px 20px">Buy now</button></header>
<script>console.error('Fixture failure: cart is empty')</script></body></html>`

test('opens the project page in the browser tab, annotates an element for Pi, and lets Pi look at it', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const site = createServer((request, response) => {
    if (request.url === '/missing.js') { response.writeHead(404).end(); return }
    response.writeHead(200, { 'content-type': 'text/html' }).end(PAGE.replace('</body>', '<script src="/missing.js"></script></body>'))
  })
  await new Promise<void>((done) => site.listen(0, '127.0.0.1', done))
  const url = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`
  const userData = testInfo.outputPath('user-data'), agentDir = testInfo.outputPath('pi-agent'), projectPath = testInfo.outputPath('Shop project')
  await Promise.all([userData, projectPath].map((path) => mkdir(path, { recursive: true })))
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, settings: {
    ...DEFAULT_SETTINGS, locale: 'en-US', notifications: { desktop: false, sound: false } } }))
  const project = await realpath(projectPath)
  const fixture = await startPiSdkFixture({
    agentDir,
    // The model looks at the page once, then answers.
    providerToolCall: ({ prompt, body }) => {
      const messages = (body as { messages?: Array<{ role?: string }> }).messages ?? []
      return prompt === 'Check the page' && messages[messages.length - 1]?.role !== 'tool'
        ? { id: 'look-1', name: 'browser_screenshot', arguments: {} } : null
    },
  })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' } })
  try {
    const page = await app.firstWindow()
    // Keep the emulated DOM viewport inside the actual native content area so child WebContentsViews are not clipped off-window.
    const viewport = await app.evaluate(({ BrowserWindow }) => {
      const { width, height } = BrowserWindow.getAllWindows()[0]!.getContentBounds()
      return { width, height }
    })
    await page.setViewportSize(viewport)
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await app.evaluate(({ dialog }, directory) => { Object.defineProperty(dialog, 'showOpenDialog', { configurable: true, value: async () => ({ canceled: false, filePaths: [directory] }) }) }, project)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).first().click()
    await expect(page.getByRole('textbox', { name: 'Message input', exact: true })).toBeEditable({ timeout: 20_000 })

    await page.getByRole('button', { name: 'Expand panel', exact: true }).click()
    await page.getByRole('button', { name: 'New tab', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Browser', exact: true }).click()
    const panel = page.locator('[data-browser-panel]')
    await panel.getByRole('textbox', { name: 'Address' }).fill(url)
    await panel.getByRole('button', { name: 'Open', exact: true }).click()
    await expect(panel.locator('[data-browser-tab]')).toContainText('Fixture shop', { timeout: 20_000 })
    await expect(panel.locator('[data-browser-errors]')).toContainText('1 console errors · 1 failed requests', { timeout: 20_000 })
    // The page is a native view laid over the tab.
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.contentView.children.length)).toBe(1)

    // Annotate the button: the page reports it, the composer receives it.
    await panel.locator('[data-browser-annotate="element"]').click()
    const shop = await expect.poll(() => app.windows().find((candidate) => candidate.url() === url) ?? null).not.toBeNull().then(() => app.windows().find((candidate) => candidate.url() === url)!)
    await expect.poll(() => shop.evaluate(() => Boolean(document.querySelector('[data-pipilot-annotation]')))).toBe(true)
    const probePick = () => shop.evaluate(() => {
      const target = document.querySelector<HTMLElement>('#buy')!
      const overlay = document.querySelector<HTMLElement>('[data-pipilot-annotation]')!
      const rect = target.getBoundingClientRect()
      const x = rect.left + Math.min(10, rect.width / 2)
      const y = rect.top + Math.min(10, rect.height / 2)
      overlay.style.pointerEvents = 'none'
      const hit = document.elementFromPoint(x, y)
      overlay.style.pointerEvents = 'auto'
      return { hit: hit ? (hit.id || hit.tagName) : null, viewport: { width: innerWidth, height: innerHeight }, target: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
    })
    await expect.poll(async () => {
      const dom = await probePick()
      const native = await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]!
        return { window: window.getContentBounds(), view: window.contentView.children[0]?.getBounds() }
      })
      return JSON.stringify({ ...dom, native })
    }, { timeout: 20_000 }).toContain('"hit":"buy"')
    const pickedTarget = await shop.evaluate(() => {
      const target = document.querySelector<HTMLElement>('#buy')!
      const overlay = document.querySelector<HTMLElement>('[data-pipilot-annotation]')!
      const rect = target.getBoundingClientRect()
      const x = rect.left + Math.min(10, rect.width / 2)
      const y = rect.top + Math.min(10, rect.height / 2)
      overlay.style.pointerEvents = 'none'
      const hit = document.elementFromPoint(x, y)?.id
      overlay.style.pointerEvents = 'auto'
      overlay.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }))
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }))
      return hit
    })
    expect(pickedTarget).toBe('buy')
    const form = panel.locator('[data-browser-annotation="element"]')
    await expect(form).toContainText('#buy', { timeout: 20_000 })
    await form.locator('[data-browser-comment]').fill('Make this button green')
    await form.getByRole('checkbox').click()
    await form.locator('[data-browser-add]').click()
    const composer = page.locator('[data-composer-root]')
    await expect(composer.locator('[data-precision-reference="browser"]')).toContainText('Element on Fixture shop')
    await expect(composer.locator('img').first()).toBeVisible()

    // Pi's read-only tool sees the same page.
    await page.getByRole('textbox', { name: 'Message input', exact: true }).fill('Check the page')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    // The screenshot goes back to the model with the tool result.
    await expect(page.getByRole('log', { name: 'Conversation' })).toContainText('Fixture response: Attached image(s) from tool result', { timeout: 30_000 })
    const sessionFile = (await page.evaluate(() => window.pipilot!.localPi.runtime.status())).sessionState?.sessionFile
    const entries = (await readFile(sessionFile!, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as {
      message?: { role?: string; toolName?: string; content?: Array<{ type: string; text?: string }> } })
    const result = entries.find((entry) => entry.message?.role === 'toolResult' && entry.message.toolName === 'browser_screenshot')?.message
    expect(result?.content?.find((part) => part.type === 'text')?.text).toContain(`URL: ${url}`)
    expect(result?.content?.some((part) => part.type === 'image')).toBe(true)
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
    await new Promise((done) => site.close(done))
  }
})
