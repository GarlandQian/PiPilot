import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { basename, join, resolve } from 'node:path'
import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/server'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { createWindowsUserPathAdapter } from '../../src/main/external-control/launcher-service'
import { startPiSdkFixture } from '../electron/pi-sdk-fixture'

// This test really installs/uninstalls PiPilot and changes the runner's HKCU
// PATH through the product UI. Never run against a developer's Windows account.
const fixtureRoot = process.env.PIPILOT_WINDOWS_UPDATE_CANARY
test.skip(process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' || !fixtureRoot,
  'Requires the isolated Windows release canary prepared on a disposable runner.')

const require = createRequire(import.meta.url)
const updaterRequire = createRequire(require.resolve('electron-updater/package.json'))
const yaml = updaterRequire('js-yaml') as { load(value: string): unknown }

async function run(command: string, args: string[], env = process.env, timeout = 180_000) {
  return new Promise<string>((done, fail) => {
    const child = spawn(command, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const capture = (chunk: Buffer) => { output = `${output}${chunk.toString('utf8')}`.slice(-32_768) }
    child.stdout?.on('data', capture)
    child.stderr?.on('data', capture)
    const timer = setTimeout(() => { child.kill(); fail(new Error(`Timed out: ${basename(command)}\n${output}`)) }, timeout)
    child.once('error', (error) => { clearTimeout(timer); fail(error) })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) done(output)
      else fail(new Error(`${basename(command)} exited ${code}\n${output}`))
    })
  })
}

function powershell(script: string, env = process.env) {
  return run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(`$ProgressPreference = 'SilentlyContinue'; $ErrorActionPreference = 'Stop'; ${script}`, 'utf16le').toString('base64')], env)
}

async function installedProcesses(executable: string) {
  const output = await powershell(`@(Get-CimInstance Win32_Process -Filter "Name='PiPilot.exe'" |
    Where-Object { $_.ExecutablePath -eq $env:PIPILOT_CANARY_EXE } |
    Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress`,
  { ...process.env, PIPILOT_CANARY_EXE: executable })
  if (!output.trim()) return [] as Array<{ ProcessId: number; CommandLine: string }>
  const parsed = JSON.parse(output)
  return (Array.isArray(parsed) ? parsed : [parsed]) as Array<{ ProcessId: number; CommandLine: string }>
}

async function allPiPilotProcesses() {
  const output = await powershell(`@(Get-CimInstance Win32_Process -Filter "Name='PiPilot.exe'" |
    Select-Object ProcessId,ExecutablePath,CommandLine) | ConvertTo-Json -Compress`)
  if (!output.trim()) return [] as Array<Record<string, unknown>>
  const parsed = JSON.parse(output)
  return (Array.isArray(parsed) ? parsed : [parsed]) as Array<Record<string, unknown>>
}

async function stopInstalledApp(executable: string) {
  for (const child of await installedProcesses(executable)) {
    await run('taskkill.exe', ['/PID', String(child.ProcessId), '/T', '/F']).catch(() => undefined)
  }
  await expect.poll(async () => (await installedProcesses(executable)).length).toBe(0)
}

async function freePort() {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No debugging port.')
  await new Promise<void>((done) => server.close(() => done()))
  return address.port
}

async function launch(executable: string, env: NodeJS.ProcessEnv, log: (value: string) => void) {
  const port = await freePort()
  const child = spawn(executable, [`--remote-debugging-port=${port}`], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout?.on('data', (chunk: Buffer) => log(chunk.toString('utf8')))
  child.stderr?.on('data', (chunk: Buffer) => log(chunk.toString('utf8')))
  child.on('error', (error) => log(String(error)))
  let browser: Browser | undefined
  await expect.poll(async () => {
    if (child.exitCode !== null) throw new Error(`Installed PiPilot exited ${child.exitCode}.`)
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); return true } catch { return false }
  }, { timeout: 120_000 }).toBe(true)
  let page: Page | undefined
  await expect.poll(async () => {
    for (const context of browser!.contexts()) {
      for (const candidate of context.pages()) if (await candidate.title() === 'PiPilot') page = candidate
    }
    return Boolean(page)
  }).toBe(true)
  await page!.waitForFunction(() => Boolean(window.pipilot))
  return { child, browser: browser!, page: page! }
}

async function mcpHandshake(executable: string, env: NodeJS.ProcessEnv, version: string) {
  const child = spawn(executable, [], { env, stdio: ['pipe', 'pipe', 'pipe'] })
  let output = ''
  let error = ''
  child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8') })
  child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString('utf8') })
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {},
    clientInfo: { name: 'PiPilot update canary', version },
  } })}\n`)
  try {
    await expect.poll(() => output.split('\n').some((line) => {
      try { return JSON.parse(line).id === 1 } catch { return false }
    }), { timeout: 90_000, message: 'Updated MCP executable must connect to the preserved application bridge.' }).toBe(true)
    const response = output.split('\n').map((line) => { try { return JSON.parse(line) } catch { return null } })
      .find((value) => value?.id === 1)
    expect(response, error).toMatchObject({ result: { serverInfo: { name: 'pipilot-conversations', version } } })
  } finally {
    child.stdin.end()
    if (child.exitCode === null) child.kill()
  }
}

test('installs unsigned A at a custom path, rejects corruption, then updates and relaunches B with data and MCP intact', async ({}, testInfo) => {
  test.setTimeout(900_000)
  const root = resolve(fixtureRoot!)
  expect(basename(root)).toMatch(/^pipilot-packaged-smoke-update-/u)
  const manifest = JSON.parse(await readFile(join(root, 'canary.json'), 'utf8')) as {
    candidateDirectory: string; version: string; olderInstaller: string
  }
  const metadata = yaml.load(await readFile(join(manifest.candidateDirectory, 'latest.yml'), 'utf8')) as {
    version: string; path: string; sha512: string; files: Array<{ url: string; sha512: string; size: number }>
  }
  expect(metadata.version).toBe(manifest.version)
  const candidateName = basename(metadata.path)
  expect(candidateName).toBe(metadata.path)
  const candidate = join(manifest.candidateDirectory, candidateName)
  const installerBytes = await readFile(candidate)
  expect(createHash('sha512').update(installerBytes).digest('base64')).toBe(metadata.sha512)
  const installDirectory = join(root, '安装路径 With Spaces', 'PiPilot')
  const executable = join(installDirectory, 'PiPilot.exe')
  const userData = join(root, 'user-data')
  const cacheName = `${basename(root)}-cache`
  const cacheDirectory = join(process.env.LOCALAPPDATA!, cacheName)
  await mkdir(userData, { recursive: true })
  const sentinel = 'Update canary: keep settings, projects, sessions and attachment bytes.\n'
  await writeFile(join(userData, 'preserved-canary.txt'), sentinel)
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US',
      appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'dark' }, notifications: { desktop: false } } }))
  const runningPrompt = 'Update canary keeps this task running until restart is explicitly confirmed'
  let releasePrompt!: () => void
  const promptGate = new Promise<void>((done) => { releasePrompt = done })
  const pi = await startPiSdkFixture({ agentDir: join(root, 'agent-data'), reasoningDelays: { [runningPrompt]: 0 },
    reasoningGates: { [runningPrompt]: promptGate } })
  const retainedSession = join(root, 'agent-data', 'sessions', 'update-canary', 'retained.jsonl')
  await mkdir(join(root, 'agent-data', 'sessions', 'update-canary'), { recursive: true })
  const retainedSessionContent = [
    { type: 'session', version: 3, id: 'update-canary-retained', timestamp: '2026-09-27T00:00:00.000Z', cwd: root },
    { type: 'message', id: 'retained-user', parentId: null, timestamp: '2026-09-27T00:00:01.000Z',
      message: { role: 'user', content: 'Keep this existing conversation through the update.', timestamp: 1790467201000 } },
  ].map((entry) => JSON.stringify(entry)).join('\n') + '\n'
  await writeFile(retainedSession, retainedSessionContent)
  let corrupted = true
  let installerRequests = 0
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/latest.yml') {
      const hash = corrupted ? Buffer.alloc(64, 7).toString('base64') : metadata.sha512
      const feed = { ...metadata, sha512: hash, files: metadata.files.map((file) => ({ ...file, sha512: hash })) }
      response.writeHead(200, { 'content-type': 'application/yaml', 'cache-control': 'no-store' })
      response.end(JSON.stringify(feed)); return
    }
    if (decodeURIComponent(url.pathname) === `/${candidateName}`) {
      installerRequests += 1
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': installerBytes.length })
      createReadStream(candidate).pipe(response); return
    }
    response.writeHead(404); response.end()
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No update feed port.')
  const env = { ...process.env, ...pi.env, PIPILOT_PACKAGED_SMOKE: '1', PIPILOT_E2E_USER_DATA: userData }
  const pathAdapter = createWindowsUserPathAdapter(process.env, join(root, 'registry-adapter'))
  const originalPath = await pathAdapter.read()
  let app: { child: ChildProcess; browser: Browser; page: Page } | undefined
  let output = ''
  const log = (value: string) => { output = `${output}${value}`.slice(-256_000) }
  try {
    // A fresh runner must not contain another real installation which shares
    // PiPilot's NSIS upgrade identity. Do not silently uninstall someone else's app.
    const existing = await powershell(`@(Get-ItemProperty @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*') -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -like 'PiPilot*' }) | Select-Object DisplayName,InstallLocation | ConvertTo-Json -Compress`)
    expect(existing.trim(), 'The disposable runner must not already have PiPilot installed.').toBe('')
    await run(manifest.olderInstaller, ['/S', '/currentuser', `/D=${installDirectory}`], env)
    expect(existsSync(executable)).toBe(true)
    // Only the installed fixture feed is changed. Candidate B remains exactly
    // the public release artifact, including ASAR, fuses and its production feed.
    await writeFile(join(installDirectory, 'resources', 'app-update.yml'), JSON.stringify({
      provider: 'generic', url: `http://127.0.0.1:${address.port}/`, updaterCacheDirName: cacheName,
    }))
    app = await launch(executable, env, log)
    expect(await app.page.evaluate(() => window.pipilot!.applicationUpdate.get())).toMatchObject({
      policy: { currentVersion: '0.0.0', capability: 'native-install', package: 'nsis' },
    })
    await app.page.evaluate(() => window.pipilot!.externalControl.setEnabled(true))
    expect(await app.page.evaluate(() => window.pipilot!.externalControl.installLauncher())).toMatchObject({ state: 'installed' })
    const installedPath = await pathAdapter.read()
    expect(installedPath?.value.toLowerCase()).toContain(installDirectory.toLowerCase())
    const settingsBefore = await readFile(join(userData, 'settings.json'), 'utf8')
    const piSettingsBefore = await readFile(join(root, 'agent-data', 'settings.json'), 'utf8')
    expect((await app.page.evaluate(() => window.pipilot!.applicationUpdate.check())).snapshot).toMatchObject({ state: 'available', availableVersion: manifest.version })
    expect((await app.page.evaluate(() => window.pipilot!.applicationUpdate.download())).snapshot).toMatchObject({ state: 'error', operation: 'download', code: 'UPDATE_DOWNLOAD_FAILED' })
    expect(installerRequests).toBeGreaterThan(0)
    expect(output).toMatch(/sha512|checksum/i)
    expect((await app.page.evaluate(() => window.pipilot!.applicationUpdate.get())).policy.currentVersion).toBe('0.0.0')
    await app.page.screenshot({ path: testInfo.outputPath('corrupt-update-rejected.png') })
    corrupted = false
    expect((await app.page.evaluate(() => window.pipilot!.applicationUpdate.check())).snapshot.state).toBe('available')
    expect((await app.page.evaluate(() => window.pipilot!.applicationUpdate.download())).snapshot.state).toBe('downloaded')
    await app.page.screenshot({ path: testInfo.outputPath('valid-update-ready.png') })
    await expect.poll(() => app!.page.evaluate(() => window.pipilot!.localPi.runtime.status())).toMatchObject({ state: 'ready' })
    await app.page.evaluate((message) => window.pipilot!.localPi.runtime.command({ type: 'prompt', message }), runningPrompt)
    await expect.poll(() => pi.prompts.includes(runningPrompt)).toBe(true)
    // The visible Stop control confirms that the renderer is actively streaming.
    await expect(app.page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    expect(await app.page.evaluate(() => window.pipilot!.applicationUpdate.install())).toMatchObject({
      outcome: 'confirmation-required', activeWork: { primaryPi: true }, snapshot: { state: 'downloaded' },
    })
    expect(app.child.exitCode).toBeNull()
    const oldPid = app.child.pid
    // The real application shutdown coordinator and official NsisUpdater launch
    // the real candidate installer. Closing the window must not turn into tray-hide.
    const installResult = await app.page.evaluate(() => window.pipilot!.applicationUpdate.install(true)).catch((error: unknown) => {
      if (!/closed|destroyed|disconnected/iu.test(String(error))) throw error
    })
    if (installResult) expect(installResult).toMatchObject({ outcome: 'accepted', snapshot: { state: 'downloaded' } })
    await expect.poll(() => app!.child.exitCode, { timeout: 120_000 }).toBe(0)
    await expect.poll(async () => (await installedProcesses(executable))
      .some((process) => process.ProcessId !== oldPid && /--updated\b/u.test(process.CommandLine)),
    { timeout: 180_000, message: 'The updater must automatically relaunch B from the original custom installation directory.' }).toBe(true)
    const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
    const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'))
    const asar = appBuilderRequire('@electron/asar') as { extractFile(archive: string, path: string): Buffer }
    expect(JSON.parse(asar.extractFile(join(installDirectory, 'resources', 'app.asar'), 'package.json').toString()).version).toBe(manifest.version)
    expect(await pathAdapter.read()).toEqual(installedPath)
    // NSIS relaunches with --updated, not Chromium debug flags. Observe that
    // real relaunch above, then reopen B with CDP for application-level checks.
    await stopInstalledApp(executable)
    await app.browser.close().catch(() => undefined)
    app = await launch(executable, env, log)
    expect((await app.page.evaluate(() => window.pipilot!.applicationUpdate.get())).policy.currentVersion).toBe(manifest.version)
    expect(await readFile(join(userData, 'preserved-canary.txt'), 'utf8')).toBe(sentinel)
    expect(await readFile(join(userData, 'settings.json'), 'utf8')).toBe(settingsBefore)
    expect(await readFile(join(root, 'agent-data', 'settings.json'), 'utf8')).toBe(piSettingsBefore)
    expect(await readFile(retainedSession, 'utf8')).toBe(retainedSessionContent)
    await expect.poll(() => app!.page.evaluate(() => window.pipilot!.externalControl.get())).toMatchObject({
      state: 'ready', enabled: true, configuration: { command: 'pipilot-mcp', args: [] },
    })
    expect(await app.page.evaluate(() => window.pipilot!.externalControl.getLauncher())).toMatchObject({
      state: 'installed', managed: true,
    })
    await mcpHandshake(join(installDirectory, 'pipilot-mcp.exe'), env, manifest.version)
    await app.page.screenshot({ path: testInfo.outputPath('updated-app.png') })
    await writeFile(testInfo.outputPath('result.json'), JSON.stringify({
      olderVersion: '0.0.0', candidateVersion: manifest.version,
      candidateSha512: metadata.sha512, checksumRejection: true,
      customInstallDirectory: installDirectory, automaticRelaunch: true,
      activeTaskConfirmation: true,
      preservedSettings: true, preservedPiConfiguration: true, preservedSession: true, mcpHandshake: true,
    }, null, 2))
  } finally {
    await writeFile(testInfo.outputPath('application.log'), output)
    await writeFile(testInfo.outputPath('post-update-processes.json'), JSON.stringify(
      await allPiPilotProcesses().catch((error: unknown) => [{ error: String(error) }]), null, 2,
    ))
    await stopInstalledApp(executable).catch((error) => log(String(error)))
    await app?.browser.close().catch(() => undefined)
    if (originalPath) await pathAdapter.write(originalPath)
    else await pathAdapter.remove()
    if (existsSync(installDirectory)) {
      const uninstaller = (await readdir(installDirectory)).find((name) => /^Uninstall.*\.exe$/iu.test(name))
      if (uninstaller) await run(join(installDirectory, uninstaller), ['/S', '/currentuser']).catch((error) => log(String(error)))
    }
    releasePrompt()
    await pi.close()
    server.closeAllConnections()
    await new Promise<void>((done) => server.close(() => done()))
    await rm(cacheDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 })
    // Keep only failure artifacts in Playwright's output. This root was created
    // by prepare-windows-update-canary, never a real user-selected installation.
    await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 })
    await writeFile(testInfo.outputPath('application.log'), output)
  }
})
