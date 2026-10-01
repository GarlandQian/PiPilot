import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { basename, join } from 'node:path'
import { chromium, expect, test, type Browser, type Page, type TestInfo } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from '../electron/pi-sdk-fixture'
import { PNG_FIXTURE_BASE64 } from '../helpers/image-fixture'
import {
  isAppImageMainProcess, isLinuxCanaryRunner, linuxCanaryEnvironment,
  linuxCanaryProcesses, readLinuxCanaryManifest, validateLinuxCanaryRoot,
} from './linux-canary-support'

// This suite installs and removes a real DEB. It can never run on a developer's
// machine: preparation, execution and cleanup all require a disposable CI runner.
const preparedRoot = process.env.PIPILOT_LINUX_PACKAGE_CANARY
if (process.env.PIPILOT_REQUIRE_LINUX_PACKAGE_CANARY === '1' && (!isLinuxCanaryRunner() || !preparedRoot)) {
  throw new Error('The release gate requires the Linux package canary; a skipped native check cannot pass.')
}
test.skip(!isLinuxCanaryRunner() || !preparedRoot,
  'Requires the isolated Linux release canary prepared on a disposable runner.')
test.describe.configure({ mode: 'serial' })

const require = createRequire(import.meta.url)
const updaterRequire = createRequire(require.resolve('electron-updater/package.json'))
const yaml = updaterRequire('js-yaml') as { load(value: string): unknown }
const workspaceId = '11111111-1111-4111-8111-111111111111'

async function run(command: string, args: string[], allowedCodes = [0]) {
  return new Promise<string>((done, fail) => {
    const child = spawn(command, args, { env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const capture = (chunk: Buffer) => { output = `${output}${chunk.toString('utf8')}`.slice(-32_768) }
    child.stdout.on('data', capture)
    child.stderr.on('data', capture)
    const timer = setTimeout(() => { child.kill(); fail(new Error(`Timed out: ${command}\n${output}`)) }, 180_000)
    child.once('error', (error) => { clearTimeout(timer); fail(error) })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code !== null && allowedCodes.includes(code)) done(output)
      else fail(new Error(`${command} exited ${code}\n${output}`))
    })
  })
}

async function checksum(file: string) {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('base64')
}

async function pathExists(path: string) {
  try { await lstat(path); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function freePort() {
  const server = createServer()
  await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No debugging port.')
  await new Promise<void>((done) => server.close(() => done()))
  return address.port
}

async function launch(executable: string, environment: NodeJS.ProcessEnv, log: (value: string) => void) {
  const port = await freePort()
  // Execute the actual AppImage runtime or installed DEB launcher. No extracted
  // app, injected APPIMAGE identity, sandbox override or modified candidate.
  const child = spawn(executable, [`--remote-debugging-port=${port}`], {
    env: environment, stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk: Buffer) => log(chunk.toString('utf8')))
  child.stderr.on('data', (chunk: Buffer) => log(chunk.toString('utf8')))
  child.on('error', (error) => log(String(error)))
  let browser: Browser | undefined
  await expect.poll(async () => {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Linux package exited: ${child.exitCode ?? child.signalCode}`)
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
  expect(page!.url()).toBe('pipilot://app/')
  return { child, browser: browser!, page: page! }
}

async function stopFixtureProcesses(token: string) {
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    for (const entry of await linuxCanaryProcesses(token)) {
      try { process.kill(entry.pid, signal) } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }
    try {
      await expect.poll(async () => (await linuxCanaryProcesses(token)).length, { timeout: 5_000 }).toBe(0)
      return
    } catch {
      if (signal === 'SIGKILL') throw new Error('Canary processes did not exit; refusing to remove their installation.')
    }
  }
}

async function seedData(root: string) {
  const userData = join(root, 'user-data')
  const project = join(root, '保留的项目 With Spaces')
  const agentDir = join(root, 'agent-data')
  await Promise.all([mkdir(userData, { recursive: true }), mkdir(project, { recursive: true })])
  const pi = await startPiSdkFixture({ agentDir })
  const timestamp = '2026-09-27T00:00:00.000Z'
  const sessionDirectory = join(agentDir, 'sessions', `--${project.replace(/^\//u, '').replace(/[/\\:]/gu, '-')}--`)
  await mkdir(sessionDirectory, { recursive: true })
  const sessionFile = join(sessionDirectory, 'linux-canary-retained.jsonl')
  const session = [
    { type: 'session', version: 3, id: 'linux-canary-retained', timestamp, cwd: project },
    { type: 'message', id: 'retained-user', parentId: null, timestamp,
      message: { role: 'user', timestamp: Date.parse(timestamp), content: [
        { type: 'text', text: 'Preserve this conversation and its image through the Linux update.' },
        { type: 'image', mimeType: 'image/png', data: PNG_FIXTURE_BASE64 },
      ] } },
  ].map((entry) => JSON.stringify(entry)).join('\n') + '\n'
  await Promise.all([
    writeFile(sessionFile, session),
    writeFile(join(project, 'preserved-file.txt'), 'Linux canary keeps this project file.\n'),
    writeFile(join(userData, 'workspaces.json'), JSON.stringify({ version: 1, recent: [{
      id: workspaceId, name: basename(project), path: project, lastOpenedAt: timestamp, pinned: true,
    }] })),
    writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION,
      settings: { ...DEFAULT_SETTINGS, locale: 'en-US',
        appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'dark' }, notifications: { desktop: false, sound: false } } })),
  ])
  return { pi, project, sessionFile, session, userData, agentDir, environment: linuxCanaryEnvironment(root, pi.env) }
}

async function assertRetainedData(page: Page, data: Awaited<ReturnType<typeof seedData>>) {
  expect(await readFile(data.sessionFile, 'utf8')).toBe(data.session)
  expect(await readFile(join(data.project, 'preserved-file.txt'), 'utf8')).toBe('Linux canary keeps this project file.\n')
  const workspaces = await page.evaluate(() => window.pipilot!.workspace.get())
  expect(workspaces.recent).toContainEqual(expect.objectContaining({ id: workspaceId, pinned: true, available: true }))
  await page.evaluate((id) => window.pipilot!.workspace.open(id), workspaceId)
  const activation = await page.evaluate((id) => window.pipilot!.conversation.new({
    kind: 'project', workspaceId: id,
  }), workspaceId)
  expect(activation).toMatchObject({
    scope: { kind: 'project', workspaceId },
    sessionId: expect.any(String),
  })
  await expect.poll(async () => {
    const catalog = await page.evaluate((id) => window.pipilot!.sessionCatalog.refresh({ kind: 'project', workspaceId: id }), workspaceId)
    return {
      status: catalog.status,
      retainedSessionVisible: catalog.rows.some((row) => row.sessionId === 'linux-canary-retained'),
      diagnostics: catalog.diagnostics,
    }
  }, { message: 'The activated project catalog should include its retained session.' })
    .toMatchObject({ status: 'ready', retainedSessionVisible: true })
}

async function saveDiagnostics(testInfo: TestInfo, token: string, output: string) {
  await writeFile(testInfo.outputPath('application.log'), output)
  await writeFile(testInfo.outputPath('processes.json'), JSON.stringify(await linuxCanaryProcesses(token), null, 2))
  for (const name of ['conversation-navigation.json', 'observed-pi-session-directories.json']) {
    const contents = await readFile(join(token, 'user-data', name)).catch(() => undefined)
    if (contents) await writeFile(testInfo.outputPath(name), contents)
  }
  const mainLog = await readFile(join(token, 'user-data', 'logs', 'main.log')).catch(() => undefined)
  if (mainLog) await writeFile(testInfo.outputPath('main.log'), mainLog)
}

async function cleanup(actions: Array<() => Promise<unknown>>) {
  const errors: unknown[] = []
  for (const action of actions) {
    try { await action() } catch (error) { errors.push(error) }
  }
  if (errors.length > 0) throw new Error(`Linux canary cleanup failed:\n${errors.map(String).join('\n')}`)
}

test.afterAll(async () => {
  if (!isLinuxCanaryRunner() || !preparedRoot) return
  const root = await validateLinuxCanaryRoot(preparedRoot)
  // Only remove a validated preparation directory once every fixture process is
  // gone. The checkout's release directory is outside this tree.
  if ((await linuxCanaryProcesses(join(root, 'appimage'))).length === 0
    && (await linuxCanaryProcesses(join(root, 'deb'))).length === 0) {
    await rm(root, { recursive: true, force: true })
  }
})

test('runs the real AppImage, updates A to candidate B and automatically relaunches with retained data', async ({}, testInfo) => {
  test.setTimeout(600_000)
  const prepared = await validateLinuxCanaryRoot(preparedRoot!)
  const manifest = await readLinuxCanaryManifest(prepared)
  const root = join(prepared, 'appimage')
  const metadata = yaml.load(await readFile(join(manifest.candidateDirectory, 'latest-linux.yml'), 'utf8')) as {
    version: string; path: string; sha512: string; files: Array<{ url: string; sha512: string; size: number }>
  }
  expect(metadata.version).toBe(manifest.version)
  const file = metadata.files.find((entry) => entry.url.endsWith('.AppImage'))
  expect(file).toBeDefined()
  const candidateName = basename(file!.url)
  expect(candidateName).toBe(file!.url)
  const candidate = join(manifest.candidateDirectory, candidateName)
  expect(await checksum(candidate)).toBe(file!.sha512)
  const candidateSize = (await stat(candidate)).size
  expect(candidateSize).toBe(file!.size)
  const installDirectory = join(root, '安装路径 With Spaces')
  const executable = join(installDirectory, 'PiPilot.AppImage')
  await mkdir(installDirectory, { recursive: true })
  await copyFile(manifest.olderAppImage, executable)
  await chmod(executable, 0o755)
  const data = await seedData(root)
  let imageRequests = 0
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/latest-linux.yml') {
      response.writeHead(200, { 'content-type': 'application/yaml', 'cache-control': 'no-store' })
      response.end(JSON.stringify(metadata)); return
    }
    if (decodeURIComponent(url.pathname) === `/${candidateName}`) {
      imageRequests += 1
      // Reject ranges so the official updater exercises its supported full-file
      // fallback. The exact release bytes and published SHA-512 stay intact.
      if (request.headers.range) { response.writeHead(416); response.end(); return }
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': candidateSize })
      createReadStream(candidate).pipe(response); return
    }
    response.writeHead(404); response.end()
  })
  let app: Awaited<ReturnType<typeof launch>> | undefined
  let output = ''
  const log = (value: string) => { output = `${output}${value}`.slice(-256_000) }
  try {
    await new Promise<void>((done, fail) => { server.once('error', fail); server.listen(manifest.feedPort, '127.0.0.1', done) })
    app = await launch(executable, data.environment, log)
    expect((await app.page.evaluate(() => window.pipilot!.applicationUpdate.get())).policy).toMatchObject({
      currentVersion: '0.0.0', platform: 'linux', package: 'appimage', capability: 'native-install',
    })
    await assertRetainedData(app.page, data)
    const preservedPaths = [join(data.userData, 'settings.json'), join(data.agentDir, 'settings.json')]
    const preservedBytes = await Promise.all(preservedPaths.map((path) => readFile(path)))
    const oldMain = (await linuxCanaryProcesses(root)).filter((entry) => isAppImageMainProcess(entry, executable))
    expect(oldMain).toHaveLength(1)
    expect((await app.page.evaluate(() => window.pipilot!.applicationUpdate.check())).snapshot).toMatchObject({
      state: 'available', availableVersion: manifest.version,
    })
    expect((await app.page.evaluate(() => window.pipilot!.applicationUpdate.download())).snapshot.state).toBe('downloaded')
    expect(imageRequests).toBeGreaterThan(0)
    await app.page.screenshot({ path: testInfo.outputPath('appimage-update-ready.png') })
    const install = await app.page.evaluate(() => window.pipilot!.applicationUpdate.install(true)).catch((error: unknown) => {
      if (!/closed|destroyed|disconnected/iu.test(String(error))) throw error
    })
    if (install) expect(install.outcome).toBe('accepted')
    await expect.poll(() => app!.child.exitCode, { timeout: 120_000 }).toBe(0)
    await expect.poll(async () => (await linuxCanaryProcesses(root)).some((entry) =>
      entry.pid !== oldMain[0].pid && isAppImageMainProcess(entry, executable)),
    { timeout: 120_000, message: 'AppImageUpdater must automatically launch B at the same custom path.' }).toBe(true)
    expect(await checksum(executable)).toBe(file!.sha512)
    // Observe the real automatic relaunch before reopening B with debug flags;
    // electron-updater intentionally does not propagate Chromium debug arguments.
    await stopFixtureProcesses(root)
    await app.browser.close().catch(() => undefined)
    app = await launch(executable, data.environment, log)
    expect(await app.page.evaluate(() => window.pipilot!.app.getInfo())).toMatchObject({ version: manifest.version, mode: 'production' })
    expect((await app.page.evaluate(() => window.pipilot!.applicationUpdate.get())).policy).toMatchObject({
      currentVersion: manifest.version, package: 'appimage', capability: 'native-install',
    })
    for (const [index, path] of preservedPaths.entries()) expect(await readFile(path)).toEqual(preservedBytes[index])
    await assertRetainedData(app.page, data)
    expect(await checksum(candidate)).toBe(file!.sha512)
    await app.page.screenshot({ path: testInfo.outputPath('appimage-updated.png') })
    await writeFile(testInfo.outputPath('result.json'), JSON.stringify({
      olderVersion: '0.0.0', candidateVersion: manifest.version, candidateSha512: file!.sha512,
      actualAppImageRuntime: true, nativeUpdate: true, automaticRelaunch: true,
      preservedSettings: true, preservedPiConfiguration: true, preservedProject: true,
      preservedSessionAndImage: true, candidateUnmodified: true,
    }, null, 2))
  } finally {
    await cleanup([
      () => saveDiagnostics(testInfo, root, output),
      () => stopFixtureProcesses(root),
      async () => { await app?.browser.close().catch(() => undefined) },
      async () => {
        server.closeAllConnections()
        await new Promise<void>((done) => server.close(() => done()))
      },
      () => data.pi.close(),
    ])
  }
})

test('installs the exact DEB, starts its registered launcher and retains manual update policy', async ({}, testInfo) => {
  test.setTimeout(360_000)
  const prepared = await validateLinuxCanaryRoot(preparedRoot!)
  const manifest = await readLinuxCanaryManifest(prepared)
  const packages = (await readdir(manifest.candidateDirectory)).filter((name) => name.endsWith('.deb'))
  expect(packages).toHaveLength(1)
  const candidate = join(manifest.candidateDirectory, packages[0])
  const candidateHash = await checksum(candidate)
  expect((await run('dpkg-deb', ['--field', candidate, 'Package'])).trim()).toBe('pipilot')
  expect((await run('dpkg-deb', ['--field', candidate, 'Version'])).trim()).toBe(manifest.version)
  // Guard every machine-wide target before touching dpkg. Residual registrations
  // also fail closed, so this never removes an existing developer installation.
  const installed = await run('dpkg-query', ['--show', '--showformat=${db:Status-Abbrev}', 'pipilot'], [0, 1])
  expect(installed).toMatch(/no packages found matching pipilot/iu)
  for (const path of ['/opt/PiPilot', '/usr/bin/pipilot', '/etc/alternatives/pipilot', '/etc/apparmor.d/pipilot']) {
    expect(await pathExists(path), `Pre-existing PiPilot path: ${path}`).toBe(false)
  }
  const root = join(prepared, 'deb')
  const data = await seedData(root)
  let app: Awaited<ReturnType<typeof launch>> | undefined
  let installationStarted = false
  let output = ''
  const log = (value: string) => { output = `${output}${value}`.slice(-256_000) }
  try {
    installationStarted = true
    log(await run('sudo', ['--non-interactive', 'dpkg', '--install', candidate]))
    expect((await run('dpkg-query', ['--show', '--showformat=${Status}', 'pipilot'])).trim()).toBe('install ok installed')
    expect(await realpath('/usr/bin/pipilot')).toBe('/opt/PiPilot/pipilot')
    app = await launch('/usr/bin/pipilot', data.environment, log)
    expect(await app.page.evaluate(() => window.pipilot!.app.getInfo())).toMatchObject({ version: manifest.version, mode: 'production' })
    expect((await app.page.evaluate(() => window.pipilot!.applicationUpdate.get())).policy).toMatchObject({
      currentVersion: manifest.version, platform: 'linux', package: 'deb', capability: 'manual-release',
    })
    await expect.poll(async () => (await app!.page.evaluate(() => window.pipilot!.applicationUpdate.download())).snapshot).toMatchObject({
      state: 'error', operation: 'download', code: 'UPDATE_UNSUPPORTED',
    })
    expect(app.child.exitCode).toBeNull()
    await assertRetainedData(app.page, data)
    expect(await checksum(candidate)).toBe(candidateHash)
    await app.page.screenshot({ path: testInfo.outputPath('installed-deb.png') })
    await writeFile(testInfo.outputPath('result.json'), JSON.stringify({
      candidateVersion: manifest.version, candidateSha512: candidateHash,
      dpkgInstalled: true, registeredLauncher: true, manualUpdatePolicy: true,
      nativeDownloadRejected: true, candidateUnmodified: true,
    }, null, 2))
  } finally {
    let stopped = false
    await cleanup([
      () => saveDiagnostics(testInfo, root, output),
      async () => { await stopFixtureProcesses(root); stopped = true },
      async () => { await app?.browser.close().catch(() => undefined) },
      async () => {
        if (!installationStarted) return
        if (!stopped) throw new Error('Refusing to purge the DEB while fixture processes remain.')
        log(await run('sudo', ['--non-interactive', 'dpkg', '--purge', 'pipilot']))
        expect(await pathExists('/opt/PiPilot')).toBe(false)
        expect(await pathExists('/usr/bin/pipilot')).toBe(false)
      },
      () => data.pi.close(),
      () => writeFile(testInfo.outputPath('application.log'), output),
    ])
  }
})
