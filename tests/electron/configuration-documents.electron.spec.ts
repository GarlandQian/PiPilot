import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'
import { closeFixtureApplication } from './close-fixture-application'

async function addProject(electronApp: ElectronApplication, page: Page, path: string) {
  await electronApp.evaluate(({ dialog }, selectedPath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [selectedPath] }),
    })
  }, path)
  await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
}

test('retains target-owned MCP drafts through project A/B/A and semantic tab navigation', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const projectA = testInfo.outputPath('project-A')
  const projectB = testInfo.outputPath('project-B')
  for (const path of [userData, projectA, projectB]) await mkdir(path, { recursive: true })
  const baselineA = '// Disk A\n{ "mcpServers": {}, "owner": "A" }\n'
  const baselineB = '// Disk B\n{ "mcpServers": {}, "owner": "B" }\n'
  await writeFile(join(projectA, '.mcp.json'), baselineA)
  await writeFile(join(projectB, '.mcp.json'), baselineB)
  await writeFile(join(userData, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US', appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true } },
  }))
  await writeFile(join(userData, 'pi-managed-packages.json'), JSON.stringify({ version: 1, mcpOptedOut: true }))
  const fixture = await startPiSdkFixture({ agentDir })
  const app = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, ...fixture.env, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1', PIPILOT_E2E_USER_DATA: userData },
  })

  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.setViewportSize({ width: 1_440, height: 900 })
    await addProject(app, page, projectA)
    await page.getByRole('region', { name: 'Projects', exact: true })
      .getByRole('button', { name: 'New session in project-A', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Project actions for project-A', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('[data-context-panel-nav-id="integrations"]').click()
    const settings = page.getByRole('main', { name: 'Integrations', exact: true })
    await settings.getByRole('button', { name: 'Current project', exact: true }).click()
    const mcpTab = settings.getByRole('tab', { name: 'MCP', exact: true })
    await mcpTab.click()
    const mcpPanel = settings.getByRole('tabpanel', { name: 'MCP', exact: true })
    await mcpPanel.getByRole('button', { name: 'JSON', exact: true }).click()
    const editor = mcpPanel.getByRole('textbox', { name: 'JSON', exact: true })
    await expect(editor).toHaveValue(baselineA)
    const draftA = '// Unsaved A stays here\n{ "mcpServers": {}, "future": { "keep": true } }\n'
    await editor.fill(draftA)
    await expect(mcpPanel.getByText('Unsaved changes', { exact: true })).toBeVisible()

    await mcpTab.focus()
    await mcpTab.press('ArrowRight')
    const externalTab = settings.getByRole('tab', { name: 'External Control', exact: true })
    await expect(externalTab).toBeFocused()
    await expect(externalTab).toHaveAttribute('aria-selected', 'true')
    const externalPanel = settings.getByRole('tabpanel', { name: 'External Control', exact: true })
    await expect(externalPanel).toHaveAttribute('id', (await externalTab.getAttribute('aria-controls'))!)
    await expect(settings.getByRole('textbox', { name: 'JSON', exact: true })).toHaveCount(0)
    await externalTab.press('Home')
    await expect(settings.getByRole('tab', { name: 'Overview', exact: true })).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(settings.getByRole('tab', { name: 'Packages', exact: true })).toBeFocused()
    await page.keyboard.press('End')
    await expect(externalTab).toBeFocused()
    await mcpTab.click()
    await expect(editor).toHaveValue(draftA)

    await settings.getByRole('button', { name: 'Global', exact: true }).click()
    await mcpPanel.getByRole('button', { name: 'JSON', exact: true }).click()
    const globalDraft = '// Unsaved global\n{ "mcpServers": {} }\n'
    await editor.fill(globalDraft)
    await settings.getByRole('button', { name: 'Current project', exact: true }).click()
    await expect(editor).toHaveValue(draftA)

    await page.getByRole('button', { name: 'Sessions', exact: true }).click()
    await addProject(app, page, projectB)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(settings.getByText('project-B', { exact: true })).toBeVisible()
    await mcpPanel.getByRole('button', { name: 'JSON', exact: true }).click()
    await expect(editor).toHaveValue(baselineB)
    const draftB = '// Unsaved B stays here\n{ "mcpServers": {}, "future": "B" }\n'
    await editor.fill(draftB)

    await page.getByRole('button', { name: 'Sessions', exact: true }).click()
    await page.getByRole('region', { name: 'Projects', exact: true })
      .getByRole('button', { name: 'New session in project-A', exact: true }).click()
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.localPi.runtime.status()).cwd), { timeout: 20_000 }).toBe(projectA)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(settings.getByText('project-A', { exact: true })).toBeVisible()
    await expect(editor).toHaveValue(draftA)
    await settings.getByRole('button', { name: 'Global', exact: true }).click()
    await expect(editor).toHaveValue(globalDraft)
    await settings.getByRole('button', { name: 'Current project', exact: true }).click()
    await expect(editor).toHaveValue(draftA)

    await mcpPanel.getByRole('button', { name: 'Refresh', exact: true }).click()
    const discard = page.getByRole('alertdialog', { name: 'Discard unsaved changes?', exact: true })
    await expect(discard).toBeVisible()
    await discard.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(editor).toHaveValue(draftA)
    await mcpPanel.getByRole('button', { name: 'Refresh', exact: true }).click()
    await discard.getByRole('button', { name: 'Discard and reload', exact: true }).click()
    await expect(editor).toHaveValue(baselineA)
    expect(await readFile(join(projectB, '.mcp.json'), 'utf8')).toBe(baselineB)
    await editor.fill(draftA)
    await mcpPanel.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => readFile(join(projectA, '.mcp.json'), 'utf8')).toBe(draftA)
    await expect(mcpPanel.getByText('Unsaved changes', { exact: true })).toHaveCount(0)

    await page.setViewportSize({ width: 1_100, height: 680 })
    await expect.poll(() => settings.getByRole('tablist').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.mouse.move(1_090, 670)
    await page.screenshot({ path: testInfo.outputPath('mcp-draft-target-minimum.png'), animations: 'disabled' })
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
