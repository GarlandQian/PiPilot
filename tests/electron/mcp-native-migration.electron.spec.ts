import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'
import { closeFixtureApplication } from './close-fixture-application'

test('imports legacy MCP only into a reviewed native draft and preserves original files', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const userData = testInfo.outputPath('user-data')
  const project = testInfo.outputPath('project')
  const agentDir = testInfo.outputPath('pi-agent')
  await Promise.all([mkdir(userData, { recursive: true }), mkdir(project, { recursive: true })])
  const legacyPath = join(project, '.mcp.json')
  const nativePath = join(project, '.pi', 'mcp.json')
  const original = `// Keep this original for other clients.
{
  "mcpServers": {
    "docs": { "command": "pipilot-fixture-must-not-run", "disabled": true, "future": { "preserve": true } },
    "legacy_sse": { "url": "https://example.test/sse", "type": "sse", "disabled": true }
  },
  "futureTop": true,
}
`
  await writeFile(legacyPath, original)
  await writeFile(join(userData, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US', appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'dark', reducedMotion: true } },
  }))
  const fixture = await startPiSdkFixture({ agentDir })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.setViewportSize({ width: 1_100, height: 680 })
    await app.evaluate(({ dialog }, selectedPath) => {
      Object.defineProperty(dialog, 'showOpenDialog', { configurable: true, value: async () => ({ canceled: false, filePaths: [selectedPath] }) })
    }, project)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('[data-context-panel-nav-id="mcp"]').click()
    const panel = page.getByRole('main', { name: 'MCP Servers', exact: true })
    await expect(panel.getByText(legacyPath, { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'Import legacy configuration into draft', exact: true }).click()
    // The draft opens in the project file's own editor, at the native location.
    await expect(panel.getByText(nativePath, { exact: true })).toBeVisible()
    const editor = panel.getByRole('textbox', { name: 'mcp.json', exact: true })
    const save = panel.locator('[data-settings-actions]').getByRole('button', { name: 'Save', exact: true })
    const imported = JSON.parse(await editor.inputValue())
    expect(imported.mcpServers.docs).toEqual({ command: 'pipilot-fixture-must-not-run', enabled: false, future: { preserve: true } })
    expect(imported.mcpServers.legacy_sse.type).toBe('sse')
    await expect(save).toBeDisabled()
    await expect(panel.getByText(/legacy SSE is not supported/u)).toBeVisible()
    await expect(readFile(nativePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(legacyPath, 'utf8')).toBe(original)

    delete imported.mcpServers.legacy_sse
    await editor.fill(`${JSON.stringify(imported, null, 2)}\n`)
    await save.click()
    await expect(async () => expect(JSON.parse(await readFile(nativePath, 'utf8'))).toEqual(imported)).toPass({ timeout: 5_000 })
    expect(await readFile(legacyPath, 'utf8')).toBe(original)

    await panel.getByRole('button', { name: 'Edit docs', exact: true }).click()
    const server = panel.locator('[data-mcp-server-editor="docs"]')
    await server.getByRole('combobox', { name: 'Tool availability', exact: true }).selectOption({ label: 'Direct tools' })
    await server.getByRole('textbox', { name: 'Request timeout (seconds)', exact: true }).fill('15')
    await save.click()
    await expect.poll(async () => JSON.parse(await readFile(nativePath, 'utf8')).mcpServers.docs).toEqual({ ...imported.mcpServers.docs, exposure: 'direct', timeout: 15 })
    await panel.locator('[data-mcp-server-list] header').getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Refresh', exact: true }).click()
    await expect(panel.getByText(/An older .mcp.json also exists/u)).toBeVisible()
    expect(await readFile(legacyPath, 'utf8')).toBe(original)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('native-mcp-minimum.png'), animations: 'disabled' })
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})

test('keeps native MCP writes blocked until an enabled adapter is explicitly removed', async ({}, testInfo) => {
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const legacyPackage = testInfo.outputPath('legacy-package')
  await Promise.all([mkdir(userData, { recursive: true }), mkdir(legacyPackage, { recursive: true })])
  await writeFile(join(legacyPackage, 'package.json'), JSON.stringify({
    name: 'pi-mcp-adapter', version: '0.0.0', keywords: ['pi-package'], pi: { extensions: ['./index.js'] },
  }))
  await writeFile(join(legacyPackage, 'index.js'), "export default (pi) => pi.registerCommand('mcp', { handler: async () => {} });\n")
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, settings: { ...DEFAULT_SETTINGS, locale: 'en-US' } }))
  const fixture = await startPiSdkFixture({ agentDir, globalPackages: [legacyPackage] })
  const original = '{ "mcpServers": { "docs": { "command": "do-not-run", "disabled": true } } }\n'
  const nativePath = join(agentDir, 'mcp.json')
  await writeFile(nativePath, original)
  const app = await electron.launch({ args: [resolve(process.cwd())], env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('[data-context-panel-nav-id="mcp"]').click()
    const panel = page.getByRole('main', { name: 'MCP Servers', exact: true })
    await panel.getByRole('button', { name: 'Convert to native JSON draft', exact: true }).click()
    const editor = panel.getByRole('textbox', { name: 'mcp.json', exact: true })
    const save = panel.locator('[data-settings-actions]').getByRole('button', { name: 'Save', exact: true })
    const draft = await editor.inputValue()
    expect(JSON.parse(draft).mcpServers.docs.enabled).toBe(false)
    await expect(panel.getByText(/no package is removed automatically/u)).toBeVisible()
    await expect(save).toBeDisabled()
    const rejected = await page.evaluate(async (content) => {
      const target = { kind: 'global' as const }
      const snapshot = await window.pipilot!.mcpConfig.load(target)
      try {
        await window.pipilot!.mcpConfig.save(target, content, snapshot.fingerprint, false)
        return null
      } catch (error) {
        return (error as { code?: string }).code
      }
    }, draft)
    expect(rejected).toBe('MCP_CONFIG_EXTENSION_OVERRIDE')
    expect(await readFile(nativePath, 'utf8')).toBe(original)
    expect((await readFile(join(agentDir, 'settings.json'), 'utf8'))).toContain(legacyPackage)

    await panel.getByRole('button', { name: 'Manage MCP extension', exact: true }).click()
    const packages = page.getByRole('main', { name: 'Packages', exact: true })
    await expect(packages).toBeVisible()
    await page.evaluate(async (source) => window.pipilot!.piIntegrations.remove({ kind: 'global' }, source), legacyPackage)
    await packages.locator('header').getByRole('button', { name: 'More', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Refresh', exact: true }).click()
    await page.locator('[data-context-panel-nav-id="mcp"]').click()
    await expect(editor).toHaveValue(draft)
    await expect(save).toBeEnabled()
    await save.click()
    await expect.poll(() => readFile(nativePath, 'utf8')).toBe(draft)
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
