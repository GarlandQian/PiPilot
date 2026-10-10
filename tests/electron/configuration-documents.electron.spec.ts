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

test('retains target-owned MCP drafts through project A/B/A and pane navigation', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const projectA = testInfo.outputPath('project-A')
  const projectB = testInfo.outputPath('project-B')
  for (const path of [userData, join(projectA, '.pi'), join(projectB, '.pi')]) await mkdir(path, { recursive: true })
  const baselineA = '{ "mcpServers": {}, "owner": "A" }\n'
  const baselineB = '{ "mcpServers": {}, "owner": "B" }\n'
  await writeFile(join(projectA, '.pi', 'mcp.json'), baselineA)
  await writeFile(join(projectB, '.pi', 'mcp.json'), baselineB)
  await writeFile(join(userData, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US', appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true } },
  }))
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
      .getByRole('button', { name: 'New task in project-A', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Project actions for project-A', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('[data-context-panel-nav-id="mcp"]').click()
    const mcpPanel = page.getByRole('main', { name: 'MCP Servers', exact: true })
    // The pane follows the open project; its note names it once the project's file is in.
    const projectReady = (name: string) => expect(mcpPanel).toContainText(`Servers marked Project apply only to ${name}.`)
    const openFile = async (scope: 'project' | 'global') => {
      await mcpPanel.locator('[data-mcp-server-list] header').getByRole('button', { name: 'More', exact: true }).click()
      await page.getByRole('menuitem', { name: scope === 'project' ? 'Edit project mcp.json…' : 'Edit global mcp.json…', exact: true }).click()
    }
    await projectReady('project-A')
    await openFile('project')
    const editor = mcpPanel.getByRole('textbox', { name: 'mcp.json', exact: true })
    await expect(editor).toHaveValue(baselineA)
    await expect(mcpPanel.getByText(join(projectA, '.pi', 'mcp.json'), { exact: true })).toBeVisible()
    const draftA = '{ "mcpServers": {}, "future": { "keep": true } }\n'
    await editor.fill(draftA)
    await expect(mcpPanel.getByText('Unsaved changes', { exact: true })).toBeVisible()

    // Another pane and back: the file page and its draft are where they were.
    await page.locator('[data-context-panel-nav-id="external-control"]').click()
    await expect(page.getByRole('main', { name: 'External Control', exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'mcp.json', exact: true })).toHaveCount(0)
    await page.locator('[data-context-panel-nav-id="mcp"]').click()
    await expect(editor).toHaveValue(draftA)

    // Each project owns its draft.
    await page.getByRole('button', { name: 'Back to app', exact: true }).click()
    await addProject(app, page, projectB)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    // A newly opened project starts at its list; its file opens as its own document.
    await projectReady('project-B')
    await openFile('project')
    await expect(mcpPanel.getByText(join(projectB, '.pi', 'mcp.json'), { exact: true })).toBeVisible()
    await expect(editor).toHaveValue(baselineB)
    const draftB = '{ "mcpServers": {}, "future": "B" }\n'
    await editor.fill(draftB)

    await page.getByRole('button', { name: 'Back to app', exact: true }).click()
    await page.getByRole('region', { name: 'Projects', exact: true })
      .getByRole('button', { name: 'New task in project-A', exact: true }).click()
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.localPi.runtime.status()).cwd), { timeout: 20_000 }).toBe(projectA)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    // Back in project A, its file page and draft are where they were.
    await expect(mcpPanel.getByText(join(projectA, '.pi', 'mcp.json'), { exact: true })).toBeVisible()
    await expect(editor).toHaveValue(draftA)

    await mcpPanel.getByRole('button', { name: 'Refresh', exact: true }).click()
    const discard = page.getByRole('alertdialog', { name: 'Discard unsaved changes?', exact: true })
    await expect(discard).toBeVisible()
    await discard.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(editor).toHaveValue(draftA)
    await mcpPanel.getByRole('button', { name: 'Refresh', exact: true }).click()
    await discard.getByRole('button', { name: 'Discard and reload', exact: true }).click()
    await expect(editor).toHaveValue(baselineA)
    expect(await readFile(join(projectB, '.pi', 'mcp.json'), 'utf8')).toBe(baselineB)
    await editor.fill(draftA)
    await mcpPanel.locator('[data-settings-actions]').getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => readFile(join(projectA, '.pi', 'mcp.json'), 'utf8')).toBe(draftA)
    await expect(mcpPanel.locator('[data-mcp-server-list]')).toBeVisible()

    // The global file is a document of its own.
    await openFile('global')
    await expect(mcpPanel.getByText(join(agentDir, 'mcp.json'), { exact: true })).toBeVisible()
    await expect(editor).not.toHaveValue(draftA)
    await mcpPanel.locator('[data-settings-actions]').getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(mcpPanel.locator('[data-mcp-server-list]')).toBeVisible()

    await page.setViewportSize({ width: 1_100, height: 680 })
    await expect.poll(() => page.locator('[data-settings-section="mcp"]').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.mouse.move(1_090, 670)
    await page.screenshot({ path: testInfo.outputPath('mcp-draft-target-minimum.png'), animations: 'disabled' })
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
