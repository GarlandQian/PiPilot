import { access, mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'

async function exists(path: string) {
  try { await access(path); return true } catch { return false }
}

function projectSession(page: Page, name: string) {
  return page.locator('[data-session-list="project"]')
    .getByRole('button', { name, exact: true })
}

function projectSessionRow(page: Page, name: string) {
  return page.locator('[data-session-list="project"]').getByRole('listitem')
    .filter({ has: page.getByRole('button', { name, exact: true }) })
}

async function addProject(app: ElectronApplication, page: Page, path: string) {
  await app.evaluate(({ dialog }, selectedPath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      writable: true,
      value: async () => ({ canceled: false, filePaths: [selectedPath] }),
    })
  }, path)
  await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
  await expect.poll(async () => {
    const runtime = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    return { cwd: runtime.cwd, state: runtime.state }
  }).toEqual({ cwd: path, state: 'ready' })
  await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat')
}

async function send(page: Page, prompt: string) {
  await page.getByRole('textbox', { name: 'Message input', exact: true }).fill(prompt)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('log', { name: 'Conversation' }).getByText(
    `Fixture response: ${prompt}`, { exact: true },
  )).toBeVisible({ timeout: 20_000 })
}

async function nameSession(page: Page, name: string) {
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  const result = await page.evaluate((title) => window.pipilot!.localPi.runtime.command({
    type: 'set_session_name', name: title,
  }), name)
  expect(result.success).toBe(true)
  await expect(projectSession(page, name)).toBeVisible()
}

test('updates a loaded background project catalog while another project remains selected', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userDataPath = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const workspaceA = testInfo.outputPath('catalog-project-a')
  const workspaceB = testInfo.outputPath('catalog-project-b')
  const gateDir = testInfo.outputPath('catalog-gate')
  await Promise.all([userDataPath, workspaceA, workspaceB, gateDir].map((path) =>
    mkdir(path, { recursive: true })))
  const canonicalA = await realpath(workspaceA)
  const canonicalB = await realpath(workspaceB)
  await writeFile(join(userDataPath, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US' },
  }))
  const backgroundPrompt = 'Complete project A after project B is selected'
  const firstTitle = 'Catalog background A'
  const updatedTitle = 'Catalog background A updated'
  const selectedTitle = 'Catalog selected B'
  const cancelledPrompt = 'Stop project A before completion'
  let releaseCancelledPrompt!: () => void
  const cancelledPromptGate = new Promise<void>((resolveGate) => {
    releaseCancelledPrompt = resolveGate
  })
  const fixture = await startPiSdkFixture({
    agentDir,
    promptGates: { [cancelledPrompt]: cancelledPromptGate },
  })
  let app: ElectronApplication | undefined

  try {
    // Pause an actual SDK completion, not its IPC projection or the renderer.
    await writeFile(join(agentDir, 'extensions', 'background-catalog-gate.js'), `
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export default function backgroundCatalogGate(pi) {
  let pending = false
  pi.on('before_agent_start', (event, context) => {
    pending = context.cwd === ${JSON.stringify(canonicalA)} && event.prompt === ${JSON.stringify(backgroundPrompt)}
  })
  pi.on('agent_end', async () => {
    if (!pending) return
    pending = false
    const gate = ${JSON.stringify(gateDir)}
    writeFileSync(join(gate, 'started'), 'started')
    const deadline = Date.now() + 45000
    while (!existsSync(join(gate, 'release')) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    if (!existsSync(join(gate, 'release'))) throw new Error('Background catalog fixture release timed out.')
    pi.setSessionName(${JSON.stringify(updatedTitle)})
    writeFileSync(join(gate, 'finished'), 'finished')
  })
}
`)
    app = await electron.launch({
      args: [resolve(process.cwd())],
      env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userDataPath },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })

    await addProject(app, page, canonicalA)
    await send(page, 'Seed project A catalog')
    await nameSession(page, firstTitle)
    const runtimeA = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    const rowA = projectSession(page, firstTitle)
    await expect(rowA).toHaveAttribute('aria-current', 'page')
    await expect(projectSessionRow(page, firstTitle).getByRole('status')).toHaveCount(0)

    await send(page, backgroundPrompt)
    await expect.poll(() => exists(join(gateDir, 'started'))).toBe(true)
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await expect(projectSessionRow(page, firstTitle).locator('[data-session-indicator]'))
      .toHaveAttribute('data-session-indicator', 'running')

    await addProject(app, page, canonicalB)
    await send(page, 'Seed project B catalog')
    await nameSession(page, selectedTitle)
    const runtimeB = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    const navigationB = await page.evaluate(() => window.pipilot!.conversation.get())
    expect(runtimeB.sessionState?.sessionId).not.toBe(runtimeA.sessionState?.sessionId)
    await expect(rowA).toBeVisible()
    await expect(rowA).not.toHaveAttribute('aria-current', 'page')
    const rowB = projectSession(page, selectedTitle)
    await expect(rowB).toHaveAttribute('aria-current', 'page')
    await expect(projectSessionRow(page, selectedTitle).getByRole('status')).toHaveCount(0)
    await expect(projectSessionRow(page, firstTitle).locator('[data-session-indicator]'))
      .toHaveAttribute('data-session-indicator', 'running')

    // A is already loaded but no longer selected. Do not refresh or reopen it.
    await writeFile(join(gateDir, 'release'), 'release')
    await expect.poll(() => exists(join(gateDir, 'finished'))).toBe(true)
    const updatedRow = projectSession(page, updatedTitle)
    const updatedSession = projectSessionRow(page, updatedTitle)
    await expect(updatedRow).toBeVisible({ timeout: 15_000 })
    await expect(rowA).toHaveCount(0)
    await expect(updatedRow).not.toHaveAttribute('aria-current', 'page')
    await expect(rowB).toHaveAttribute('aria-current', 'page')
    await expect(updatedSession.locator('[data-session-indicator]'))
      .toHaveAttribute('data-session-indicator', 'unread')
    await expect(updatedSession.getByRole('status')).toHaveCount(1)
    await expect(updatedSession.getByRole('status', { name: 'New result', exact: true }))
      .toBeVisible()
    await expect(projectSessionRow(page, selectedTitle).getByRole('status')).toHaveCount(0)
    await expect(page.evaluate(() => window.pipilot!.conversation.get())).resolves.toEqual(navigationB)
    await expect(page.evaluate(() => window.pipilot!.localPi.runtime.status())).resolves.toMatchObject({
      state: 'ready', generation: runtimeB.generation, cwd: canonicalB,
      sessionFile: runtimeB.sessionFile, sessionState: { sessionId: runtimeB.sessionState!.sessionId },
    })
    const transcript = page.getByRole('log', { name: 'Conversation' })
    await expect(transcript.getByText(`Fixture response: ${backgroundPrompt}`, { exact: true })).toHaveCount(0)
    await expect(transcript.getByText('Fixture response: Seed project B catalog', { exact: true })).toBeVisible()
    await send(page, 'Project B remains usable after the background update')
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expect(projectSessionRow(page, selectedTitle).getByRole('status')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('background-catalog-updated.png') })

    // Reading the real background result clears its only indicator.
    await updatedRow.click()
    await expect(transcript.getByText(`Fixture response: ${backgroundPrompt}`, { exact: true }))
      .toBeVisible({ timeout: 20_000 })
    await expect(updatedRow).toHaveAttribute('aria-current', 'page')
    await expect(updatedSession.locator('[data-session-indicator]')).toHaveCount(0)
    await expect(updatedSession.getByRole('status')).toHaveCount(0)
    await expect(projectSessionRow(page, selectedTitle).getByRole('status')).toHaveCount(0)

    // Stop an actual SDK request, then leave it in the background. Cancellation
    // must remain quiet instead of becoming a successful or unread result.
    await page.getByRole('textbox', { name: 'Message input', exact: true }).fill(cancelledPrompt)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => fixture.prompts.includes(cancelledPrompt)).toBe(true)
    await expect(updatedSession.locator('[data-session-indicator]'))
      .toHaveAttribute('data-session-indicator', 'running')
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expect.poll(async () => {
      const runtime = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
      return runtime.sessionStatuses?.find((session) =>
        session.sessionId === runtimeA.sessionState!.sessionId)?.status
    }).toBe('cancelled')
    releaseCancelledPrompt()
    await expect(updatedSession.locator('[data-session-indicator]')).toHaveCount(0)
    await expect(updatedSession.getByRole('status')).toHaveCount(0)
    await rowB.click()
    await expect(transcript.getByText(
      'Fixture response: Project B remains usable after the background update', { exact: true },
    )).toBeVisible({ timeout: 20_000 })
    await expect(rowB).toHaveAttribute('aria-current', 'page')
    await expect(updatedRow).not.toHaveAttribute('aria-current', 'page')
    await expect(updatedSession.locator('[data-session-indicator]')).toHaveCount(0)
    await expect(updatedSession.getByRole('status')).toHaveCount(0)
    await expect(projectSessionRow(page, selectedTitle).getByRole('status')).toHaveCount(0)
    expect(fixture.prompts).toEqual([
      'Seed project A catalog', backgroundPrompt, 'Seed project B catalog',
      'Project B remains usable after the background update', cancelledPrompt,
    ])
    await page.screenshot({ path: testInfo.outputPath('navigation-completed-and-cancelled-quiet.png') })
  } finally {
    releaseCancelledPrompt()
    await writeFile(join(gateDir, 'release'), 'release')
    await app?.close()
    await fixture.close()
  }
})
