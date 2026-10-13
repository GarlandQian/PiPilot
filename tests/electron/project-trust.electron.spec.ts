import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { closeFixtureApplication } from './close-fixture-application'
import { startPiSdkFixture } from './pi-sdk-fixture'

async function projectSkillLoaded(page: Page) {
  const response = await page.evaluate(() => window.pipilot!.localPi.runtime.command({ type: 'get_commands' }))
  const commands = (response as { data?: { commands?: Array<{ name: string }> } }).data?.commands ?? []
  return commands.some((command) => command.name.includes('trust-fixture-skill'))
}

test('an added project with Pi resources asks for trust and loads them only once trusted', { tag: '@core' }, async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const projectPath = testInfo.outputPath('Trust project')
  await Promise.all([mkdir(userData, { recursive: true }), mkdir(join(projectPath, '.pi', 'skills', 'trust-fixture-skill'), { recursive: true })])
  await writeFile(join(projectPath, '.pi', 'skills', 'trust-fixture-skill', 'SKILL.md'),
    '---\nname: trust-fixture-skill\ndescription: Loaded only for a trusted project.\n---\n\nUse the trusted project fixture.\n')
  const project = await realpath(projectPath)
  await writeFile(join(userData, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US', notifications: { desktop: false, sound: false } },
  }))
  const fixture = await startPiSdkFixture({ agentDir })
  // The shared fixture trusts every project; this test needs Pi's default prompt.
  const piSettings = JSON.parse(await readFile(join(agentDir, 'settings.json'), 'utf8')) as Record<string, unknown>
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ ...piSettings, defaultProjectTrust: 'ask' }))
  const app = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' },
  })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1280, height: 820 })
    const composer = page.getByRole('textbox', { name: 'Message input', exact: true })
    await expect(composer).toBeEditable({ timeout: 20_000 })
    await app.evaluate(({ dialog }, directory) => {
      Object.defineProperty(dialog, 'showOpenDialog', { configurable: true, value: async () => ({ canceled: false, filePaths: [directory] }) })
    }, project)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()

    const sheet = page.locator('[data-project-trust-sheet]')
    await expect(sheet).toBeVisible({ timeout: 20_000 })
    await expect(sheet.getByRole('heading', { name: 'Trust “Trust project”?' })).toBeVisible()
    await expect(sheet.getByText(project, { exact: true })).toBeVisible()
    await sheet.getByRole('button', { name: 'Decide Later', exact: true }).click()
    await expect(sheet).toHaveCount(0)

    // Undecided: the conversation works, but the project's skill is not loaded.
    const notice = page.locator('[data-project-trust-notice="undecided"]')
    await expect(notice).toBeVisible()
    await expect(composer).toBeEditable()
    expect(await projectSkillLoaded(page)).toBe(false)

    await notice.getByRole('button', { name: 'Trust…', exact: true }).click()
    await expect(sheet).toBeVisible()
    await sheet.getByRole('radio', { name: 'This folder, until PiPilot quits' }).click()
    await sheet.getByRole('button', { name: 'Trust', exact: true }).click()
    await expect(notice).toHaveCount(0)
    await expect.poll(() => projectSkillLoaded(page), { timeout: 20_000 }).toBe(true)
    // A session decision is not written to Pi's trust.json.
    await expect(readFile(join(agentDir, 'trust.json'), 'utf8')).rejects.toThrow()

    // Settings › Local environment shows and changes the saved decision.
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('[data-context-panel-nav-id="local-environment"]').click()
    const row = page.locator('[data-project-trust-row]')
    await expect(row).toContainText('Trusted until PiPilot quits')
    await row.getByRole('button', { name: 'Don’t Trust', exact: true }).click()
    await expect(row).toHaveAttribute('data-project-trust-row', 'untrusted')
    expect(JSON.parse(await readFile(join(agentDir, 'trust.json'), 'utf8'))).toEqual({ [project]: false })
    await expect.poll(() => projectSkillLoaded(page), { timeout: 20_000 }).toBe(false)

    // The policy for new projects is Pi's defaultProjectTrust.
    await page.locator('[data-context-panel-nav-id="general"]').click()
    await page.getByLabel('New projects').selectOption('never')
    await expect.poll(async () => JSON.parse(await readFile(join(agentDir, 'settings.json'), 'utf8')).defaultProjectTrust).toBe('never')
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
