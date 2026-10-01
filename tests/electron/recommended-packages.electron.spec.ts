import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { DefaultPackageRepository } from '../../src/main/local-pi-management/default-package-repository'
import { PI_RECOMMENDED_PACKAGES } from '../../src/shared/pi-package-adapters'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { closeFixtureApplication } from './close-fixture-application'
import { startPiSdkFixture } from './pi-sdk-fixture'

test('shows global defaults, retries explicitly and preserves removal across application launches', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const npmLog = testInfo.outputPath('npm-commands.jsonl')
  const npmRunner = testInfo.outputPath('npm-fixture.cjs')
  const [plan, subagents, goal] = PI_RECOMMENDED_PACKAGES
  const planDirectory = join(agentDir, 'npm', 'node_modules', plan.packageName)
  await Promise.all([mkdir(userData, { recursive: true }), mkdir(planDirectory, { recursive: true })])
  await writeFile(join(planDirectory, 'package.json'), JSON.stringify({ name: plan.packageName, version: '0.58.3', pi: { extensions: [] } }))
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, settings: {
    ...DEFAULT_SETTINGS, locale: 'en-US', appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true },
  } }))
  // Exercise the actual official package manager without contacting a registry.
  await writeFile(npmRunner, `
const fs = require('node:fs'), path = require('node:path');
const [log, ...args] = process.argv.slice(2);
fs.appendFileSync(log, JSON.stringify(args) + '\\n');
if (args[0] === 'root') process.stdout.write(path.join(path.dirname(log), 'no-legacy-packages'));
else if (args[0] === 'install') {
  const spec = args[1], split = spec.lastIndexOf('@'), name = spec.slice(0, split), version = spec.slice(split + 1);
  const target = path.join(args[args.indexOf('--prefix') + 1], 'node_modules', name);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name, version, pi: { extensions: [] } }));
  process.stdout.write('Ordinary npm output must not corrupt IPC.\\n');
} else if (args[0] !== 'uninstall') throw new Error('Unexpected fixture command');
`)
  const fixture = await startPiSdkFixture({ agentDir, globalPackages: [plan.source] })
  const settingsPath = join(agentDir, 'settings.json')
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
  const configuredPlan = { source: plan.source, extensions: [] }
  await writeFile(settingsPath, JSON.stringify({ ...settings, packages: [configuredPlan], npmCommand: [process.execPath, npmRunner, npmLog] }))
  const repository = new DefaultPackageRepository(agentDir)
  await repository.save({ ...plan, status: 'existing' })
  await repository.save({ ...subagents, status: 'removed' })
  await repository.save({ ...goal, status: 'failed', message: 'Fixture registry was unavailable.' })
  const launch = () => electron.launch({ args: [resolve(process.cwd())], env: {
    ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1',
  } })
  let app = await launch()
  try {
    let page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 900 })
    const openPackages = async () => {
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('region', { name: 'Settings', exact: true }).getByRole('button', { name: 'Integrations', exact: true }).click()
      await page.getByRole('tab', { name: 'Packages', exact: true }).click()
      return page.getByRole('region', { name: 'Recommended plugins', exact: true })
    }
    let defaults = await openPackages()
    await expect(defaults).toContainText('Existing installation or configuration preserved')
    await expect(defaults).toContainText('Removed · automatic installation is off')
    await expect(defaults.getByRole('alert')).toHaveText('Fixture registry was unavailable.')
    await page.screenshot({ path: testInfo.outputPath('recommended-plugins-light.png') })
    await defaults.getByRole('button', { name: `Retry ${goal.packageName}`, exact: true }).click()
    await expect(defaults.getByRole('listitem').filter({ hasText: goal.packageName })).toContainText('Installed ·', { timeout: 20_000 })
    await expect(defaults.getByRole('alert')).toHaveCount(0)
    const installedSettings = JSON.parse(await readFile(settingsPath, 'utf8'))
    expect(installedSettings.packages).toEqual([configuredPlan, goal.source])
    const packages = page.getByRole('tabpanel', { name: 'Packages', exact: true })
    await packages.locator('[data-integration-row]').filter({ hasText: goal.packageName }).click()
    await packages.getByRole('button', { name: 'Remove', exact: true }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(defaults.getByRole('listitem').filter({ hasText: goal.packageName })).toContainText('Removed ·', { timeout: 20_000 })
    await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'dark' } }))
    await page.setViewportSize({ width: 1100, height: 680 })
    await expect(page.locator('html')).toHaveClass(/dark/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('recommended-plugins-minimum-dark.png') })
    await closeFixtureApplication(app)
    app = await launch()
    page = await app.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    defaults = await openPackages()
    await expect(defaults.getByRole('listitem').filter({ hasText: goal.packageName })).toContainText('Removed ·')
    await expect(defaults.getByRole('button', { name: `Install ${subagents.packageName}`, exact: true })).toBeEnabled()
    const commands = (await readFile(npmLog, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as string[])
    expect(commands.filter((args) => args[0] === 'install')).toHaveLength(1)
    expect(commands.filter((args) => args[0] === 'install')[0]).toContain(join(agentDir, 'npm'))
    expect(JSON.parse(await readFile(settingsPath, 'utf8')).packages).toEqual([configuredPlan])
    expect(errors).toEqual([])
  } finally { await closeFixtureApplication(app); await fixture.close() }
})
