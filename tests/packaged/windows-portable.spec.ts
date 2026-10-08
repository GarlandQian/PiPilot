import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { DefaultPackageRepository } from '../../src/main/local-pi-management/default-package-repository'
import { PI_RECOMMENDED_PACKAGES } from '../../src/shared/pi-package-adapters'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from '../electron/pi-sdk-fixture'

test.skip(process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true'
  || process.env.RUNNER_ENVIRONMENT !== 'github-hosted', 'Requires a disposable Windows release runner.')

const run = promisify(execFile)
async function freePort() {
  const server = createServer()
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No debugging port.')
  await new Promise<void>((done) => server.close(() => done()))
  return address.port
}

for (const extension of ['exe', 'zip']) {
  test(`starts the real portable ${extension.toUpperCase()} with adjacent data and manual updates`, async ({}, testInfo) => {
    test.setTimeout(180_000)
    const { version } = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as { version: string }
    const root = await mkdtemp(join(tmpdir(), 'pipilot-portable-'))
    const directory = join(root, '中文 Portable With Spaces')
    await mkdir(directory)
    const source = resolve(`release/PiPilot-${version}-windows-x64-portable.${extension}`)
    const executable = join(directory, extension === 'exe' ? 'PiPilot-portable.exe' : 'PiPilot.exe')
    if (extension === 'exe') await copyFile(source, executable)
    else await run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      '$ErrorActionPreference = "Stop"; Expand-Archive -LiteralPath $env:PIPILOT_TEST_ZIP -DestinationPath $env:PIPILOT_TEST_DIRECTORY'],
    { env: { ...process.env, PIPILOT_TEST_ZIP: source, PIPILOT_TEST_DIRECTORY: directory }, timeout: 90_000 })
    const data = join(directory, 'data')
    const agent = join(data, 'agent')
    const fixture = await startPiSdkFixture({ agentDir: agent })
    const decisions = new DefaultPackageRepository(agent)
    for (const recommendation of PI_RECOMMENDED_PACKAGES) await decisions.save({ ...recommendation, status: 'removed' })
    await writeFile(join(data, 'settings.json'), JSON.stringify({
      version: SETTINGS_SCHEMA_VERSION, settings: { ...DEFAULT_SETTINGS, locale: 'en-US' },
    }))
    // No test-userData or Pi-directory override: this must use the real portable default.
    const environment: NodeJS.ProcessEnv = { ...process.env, ...fixture.env }
    for (const key of Object.keys(environment)) {
      if (key.startsWith('PIPILOT_E2E_') || key.startsWith('PORTABLE_') || key.toLowerCase() === 'path'
        || key === 'PI_CODING_AGENT_DIR' || key === 'ELECTRON_RUN_AS_NODE') delete environment[key]
    }
    environment.PATH = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
    let child: ChildProcess | undefined
    let browser: Browser | undefined
    let page: Page | undefined
    let output = ''
    try {
      const port = await freePort()
      child = spawn(executable, [`--remote-debugging-port=${port}`], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
      const capture = (chunk: Buffer) => { output = `${output}${chunk.toString('utf8')}`.slice(-64_000) }
      child.stdout?.on('data', capture)
      child.stderr?.on('data', capture)
      child.on('error', (error) => { output += String(error) })
      await expect.poll(async () => {
        if (child!.exitCode !== null) throw new Error(`Portable launcher exited ${child!.exitCode}: ${output}`)
        try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); return true } catch { return false }
      }, { timeout: 90_000 }).toBe(true)
      await expect.poll(async () => {
        for (const context of browser!.contexts()) for (const candidate of context.pages()) {
          if (await candidate.title() === 'PiPilot') page = candidate
        }
        return Boolean(page)
      }).toBe(true)
      await page!.waitForFunction(() => Boolean(window.pipilot))
      expect(await page!.evaluate(() => window.pipilot!.settings.getPiDirectory())).toMatchObject({
        activeDirectory: agent, defaultDirectory: agent, selectedDirectory: null,
      })
      expect((await page!.evaluate(() => window.pipilot!.applicationUpdate.get())).policy).toMatchObject({
        currentVersion: version, platform: 'windows', package: 'portable', capability: 'manual-release',
      })
      await page!.evaluate(() => window.pipilot!.settings.update({ composer: { sendShortcut: 'mod-enter' } }))
      await expect.poll(async () => JSON.parse(await readFile(join(data, 'settings.json'), 'utf8')).settings.composer.sendShortcut).toBe('mod-enter')
      await page!.getByRole('button', { name: 'New chat', exact: true }).click()
      await expect.poll(() => page!.evaluate(() => window.pipilot!.localPi.runtime.status()), { timeout: 60_000 }).toMatchObject({ state: 'ready' })
      await page!.screenshot({ path: testInfo.outputPath(`portable-${extension}.png`) })
    } finally {
      await browser?.close().catch(() => undefined)
      if (child?.pid && child.exitCode === null) await run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'])
      await fixture.close()
      await writeFile(testInfo.outputPath('application.log'), output)
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
    }
  })
}
