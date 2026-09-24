import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type TestInfo } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'
import { installFixtureTrash } from './fixture-trash'

async function launchWelcomeFixture(testInfo: TestInfo, startupDelayMs = 0) {
  const userDataPath = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const startsPath = testInfo.outputPath('session-starts.txt')
  await mkdir(userDataPath, { recursive: true })
  await writeFile(join(userDataPath, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US' },
  }))
  const fixture = await startPiSdkFixture({ agentDir })
  // Observe real SDK activations to catch a duplicate startup conversation.
  await writeFile(join(agentDir, 'extensions', 'aaa-welcome-starts.js'), `
import { appendFileSync } from 'node:fs'
export default function welcomeStarts(pi) {
  pi.on('session_start', () => appendFileSync(${JSON.stringify(startsPath)}, 'started\\n'))
}
`)
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({
      args: [resolve(process.cwd())],
      env: {
        ...process.env,
        ...fixture.env,
        PIPILOT_E2E_USER_DATA: userDataPath,
        PIPILOT_E2E_STARTUP_DELAY_MS: String(startupDelayMs),
      },
    })
    await installFixtureTrash(app, testInfo)
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.setViewportSize({ width: 1440, height: 900 })
    return { app, page, fixture, startsPath }
  } catch (error) {
    await app?.close().catch(() => undefined)
    await fixture.close()
    throw error
  }
}

test('Start writing waits for startup and focuses the existing draft without creating another session', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const { app, page, fixture, startsPath } = await launchWelcomeFixture(testInfo, 3_000)
  try {
    const composer = page.getByRole('textbox', { name: 'Message input', exact: true })
    const start = page.getByRole('button', { name: 'Start writing', exact: true })
    await expect(start).toBeVisible()
    await expect(composer).toHaveAttribute('contenteditable', 'false')
    await start.click({ clickCount: 2 })
    await expect(page.getByText('Loading conversation…', { exact: true })).toBeVisible()
    await expect(composer).toHaveAttribute('contenteditable', 'true', { timeout: 20_000 })
    await expect(composer).toBeFocused()
    const initial = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    expect(initial.sessionStatuses).toHaveLength(1)
    expect((await readFile(startsPath, 'utf8')).trim().split('\n')).toHaveLength(1)

    await composer.fill('Keep this unsent draft')
    await start.click()
    await expect(composer).toBeFocused()
    await expect(composer).toHaveText('Keep this unsent draft')
    await page.keyboard.type(' and keep typing')
    await expect(composer).toHaveText('Keep this unsent draft and keep typing')
    const final = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    expect(final.sessionState?.sessionId).toBe(initial.sessionState?.sessionId)
    expect(final.sessionStatuses).toHaveLength(1)
    expect((await readFile(startsPath, 'utf8')).trim().split('\n')).toHaveLength(1)
    expect(fixture.prompts).toHaveLength(0)
    await page.screenshot({ path: testInfo.outputPath('welcome-composer-focused.png') })
  } finally {
    await app.close()
    await fixture.close()
  }
})

test('Start writing reports a creation failure and retries in the current empty project', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const { app, page, fixture, startsPath } = await launchWelcomeFixture(testInfo)
  const projectPath = testInfo.outputPath('welcome-project')
  const movedPath = testInfo.outputPath('temporarily-unavailable-project')
  await mkdir(projectPath, { recursive: true })
  const project = await realpath(projectPath)
  let moved = false
  try {
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await app.evaluate(({ dialog }, path) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [path] }),
      })
    }, project)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat')
    const composer = page.getByRole('textbox', { name: 'Message input', exact: true })
    await composer.fill('Persist a project conversation for the empty-state fixture')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByRole('log', { name: 'Conversation' }).getByText(
      'Fixture response: Persist a project conversation for the empty-state fixture', { exact: true },
    )).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    const previous = await page.evaluate(async () => {
      const api = window.pipilot!
      const scope = (await api.conversation.get()).activeScope
      const runtime = await api.localPi.runtime.status()
      const catalog = await api.sessionCatalog.list(scope)
      const selected = catalog.rows.find((row) => row.sessionId === runtime.sessionState?.sessionId)
      if (!selected) throw new Error('The fixture conversation was not persisted.')
      return { scope, sessionId: selected.sessionId, selectionToken: selected.selectionToken, sessionFile: runtime.sessionFile }
    })
    expect(previous.scope.kind).toBe('project')
    if (!previous.sessionFile) throw new Error('The fixture conversation has no session file.')
    const canonicalSession = await realpath(previous.sessionFile)
    const fixtureRoot = await realpath(testInfo.outputPath())
    const ownedPath = relative(fixtureRoot, canonicalSession)
    expect(ownedPath).not.toMatch(/^\.\.(?:[\\/]|$)/)
    expect(isAbsolute(ownedPath)).toBe(false)
    expect(canonicalSession).toMatch(/\.jsonl$/)
    await page.evaluate(({ scope, selectionToken }) => window.pipilot!.sessionCatalog.delete(scope, selectionToken), previous)
    const start = page.getByRole('button', { name: 'Start writing', exact: true })
    await expect(start).toBeVisible()
    await expect(composer).toHaveAttribute('contenteditable', 'false')

    const startsBeforeRetry = (await readFile(startsPath, 'utf8')).trim().split('\n').length

    // The reversible rename affects only this test's isolated project folder.
    await rename(project, movedPath)
    moved = true
    await start.click()
    const error = page.getByRole('alertdialog')
    await expect(error).toContainText('Operation failed')
    await expect(error).toContainText('The operation could not be completed.')
    await error.getByRole('button', { name: 'OK', exact: true }).click()
    await expect(start).toBeEnabled()
    await expect(composer).toHaveAttribute('contenteditable', 'false')
    expect((await readFile(startsPath, 'utf8')).trim().split('\n')).toHaveLength(startsBeforeRetry)

    await rename(movedPath, project)
    moved = false
    await start.click({ clickCount: 2 })
    await expect(composer).toHaveAttribute('contenteditable', 'true', { timeout: 20_000 })
    await expect(composer).toBeFocused()
    const created = await page.evaluate(async () => ({
      navigation: await window.pipilot!.conversation.get(),
      runtime: await window.pipilot!.localPi.runtime.status(),
    }))
    expect(created.navigation.activeScope).toEqual(previous.scope)
    expect(created.runtime.cwd).toBe(project)
    expect(created.runtime.sessionState?.sessionId).not.toBe(previous.sessionId)
    // The inventory also retains completed historical statuses; selected
    // identity and SDK starts establish that the retry made exactly one session.
    expect(created.runtime.sessionStatuses?.filter((status) => status.selected))
      .toMatchObject([{ scope: previous.scope, sessionId: created.runtime.sessionState?.sessionId }])
    expect((await readFile(startsPath, 'utf8')).trim().split('\n')).toHaveLength(startsBeforeRetry + 1)
  } finally {
    if (moved) await rename(movedPath, project)
    await app.close()
    await fixture.close()
  }
})
