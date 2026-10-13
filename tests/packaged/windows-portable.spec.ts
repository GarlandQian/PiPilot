import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { chromium, expect, test, type Browser, type Page } from '@playwright/test'
import { DefaultPackageRepository } from '../../src/main/local-pi-management/default-package-repository'
import { WorkspaceRepository } from '../../src/main/repositories/workspace-repository'
import { PI_RECOMMENDED_PACKAGES } from '../../src/shared/pi-package-adapters'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from '../electron/pi-sdk-fixture'
import { createNpxMcpFixture, NPX_MCP_CANARY_TEXT, NPX_MCP_CANARY_TOOL } from '../helpers/npx-mcp-fixture'

test.skip(process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true'
  || process.env.RUNNER_ENVIRONMENT !== 'github-hosted', 'Requires a disposable Windows release runner.')

const run = promisify(execFile)

function powershell(script: string, environment = process.env) {
  return run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(`$ErrorActionPreference = 'Stop'; ${script}`, 'utf16le').toString('base64')],
  { env: environment, timeout: 90_000, windowsHide: true })
}

async function portableProcesses() {
  const { stdout } = await powershell(`@(Get-CimInstance Win32_Process -Filter "Name='PiPilot.exe' OR Name='PiPilot-portable.exe'" |
    Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress`)
  if (!stdout.trim()) return [] as Array<{ ProcessId: number; CommandLine: string }>
  const parsed = JSON.parse(stdout)
  return (Array.isArray(parsed) ? parsed : [parsed]) as Array<{ ProcessId: number; CommandLine: string }>
}

async function stopPortableProcesses(preexistingPids: ReadonlySet<number>) {
  // A portable EXE has a launcher and an extracted GUI process. Close the exact
  // fixture process trees before disconnecting CDP, including utility children.
  for (const process of await portableProcesses()) {
    if (preexistingPids.has(process.ProcessId)) continue
    await run('taskkill.exe', ['/PID', String(process.ProcessId), '/T', '/F'], { windowsHide: true }).catch(() => undefined)
  }
  await expect.poll(async () => (await portableProcesses()).every((process) => preexistingPids.has(process.ProcessId)),
    { timeout: 30_000 }).toBe(true)
}

async function dataManifest(directory: string, prefix = ''): Promise<Record<string, string>> {
  const manifest: Record<string, string> = {}
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const relative = join(prefix, entry.name)
    if (entry.isDirectory()) Object.assign(manifest, await dataManifest(directory, relative))
    else if (entry.isFile()) manifest[relative] = createHash('sha256').update(await readFile(join(directory, relative))).digest('hex')
    else throw new Error(`Unexpected portable fixture data entry: ${relative}`)
  }
  return manifest
}

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
    test.setTimeout(300_000)
    const preexistingProcesses = await portableProcesses()
    const preexistingPids = new Set(preexistingProcesses.map((process) => process.ProcessId))
    expect(preexistingProcesses, 'The disposable runner must not already have PiPilot processes.').toEqual([])
    const { version } = JSON.parse(await readFile(resolve('package.json'), 'utf8')) as { version: string }
    const root = await mkdtemp(join(tmpdir(), 'pipilot-portable-'))
    const directory = join(root, '中文 Portable With Spaces')
    await mkdir(directory)
    const source = resolve(`release/PiPilot-${version}-windows-x64-portable.${extension}`)
    const executable = join(directory, extension === 'exe' ? 'PiPilot-portable.exe' : 'PiPilot.exe')
    const installProgram = async () => {
      if (extension === 'exe') await copyFile(source, executable)
      else await powershell('Expand-Archive -Force -LiteralPath $env:PIPILOT_TEST_ZIP -DestinationPath $env:PIPILOT_TEST_DIRECTORY',
        { ...process.env, PIPILOT_TEST_ZIP: source, PIPILOT_TEST_DIRECTORY: directory })
    }
    await installProgram()
    const data = join(directory, 'data')
    const agent = join(data, 'agent')
    const npxFixture = await createNpxMcpFixture(root)
    const prompt = 'Portable npx MCP canary'
    const fixture = await startPiSdkFixture({ agentDir: agent, codemodeToolPrompts: {
      [prompt]: `const result = await tools.mcp__npx_canary__${NPX_MCP_CANARY_TOOL}({}); text(result.content[0].text);`,
    } })
    await writeFile(join(agent, 'mcp.json'), JSON.stringify({ mcpServers: { npx_canary: npxFixture.config } }))
    const decisions = new DefaultPackageRepository(agent)
    for (const recommendation of PI_RECOMMENDED_PACKAGES) await decisions.save({ ...recommendation, status: 'removed' })
    await writeFile(join(data, 'settings.json'), JSON.stringify({
      version: SETTINGS_SCHEMA_VERSION, settings: { ...DEFAULT_SETTINGS, locale: 'en-US' },
    }))
    // Use the real repository to create valid persisted project metadata, then
    // create the conversations through the packaged GUI and the real Pi SDK.
    const projectPath = join(root, '保留 Project')
    await mkdir(projectPath)
    const workspaces = new WorkspaceRepository(join(data, 'workspaces.json'))
    await workspaces.initialize()
    const project = await workspaces.activatePath(projectPath)
    workspaces.setPinned(project.id, true)
    // No test-userData or Pi-directory override: this must use the real portable default.
    const environment: NodeJS.ProcessEnv = { ...process.env, ...fixture.env }
    for (const key of Object.keys(environment)) {
      if (key.startsWith('PIPILOT_E2E_') || key.startsWith('PORTABLE_') || key.toLowerCase() === 'path'
        || key === 'PI_CODING_AGENT_DIR' || key === 'ELECTRON_RUN_AS_NODE') delete environment[key]
    }
    environment.PATH = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
    // Also cover a present but broken npm/npx, as with an expired fnm shell PATH.
    if (extension === 'zip') {
      const stale = join(root, 'stale fnm multishell')
      await mkdir(stale)
      for (const command of ['npm', 'npx']) await writeFile(join(stale, `${command}.cmd`), '@echo stale fnm runtime >&2\r\n@exit /b 91\r\n')
      environment.Path = `${stale};${environment.PATH}`
      delete environment.PATH
    }
    let child: ChildProcess | undefined
    let browser: Browser | undefined
    let page: Page | undefined
    let debuggingPort: number
    let output = ''
    const launch = async () => {
      page = undefined
      browser = undefined
      debuggingPort = await freePort()
      child = spawn(executable, [`--remote-debugging-port=${debuggingPort}`], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
      const capture = (chunk: Buffer) => { output = `${output}${chunk.toString('utf8')}`.slice(-64_000) }
      child.stdout?.on('data', capture)
      child.stderr?.on('data', capture)
      child.on('error', (error) => { output += String(error) })
      await expect.poll(async () => {
        if (child!.exitCode !== null) throw new Error(`Portable launcher exited ${child!.exitCode}: ${output}`)
        try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debuggingPort}`); return true } catch { return false }
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
    }
    const quit = async () => {
      // Exercise File > Quit, not the close button (which intentionally hides
      // to the tray). Send native keys to this fixture's actual GUI process;
      // the self-extracting launcher PID does not own the window.
      await powershell(`$candidate = Get-CimInstance Win32_Process -Filter "Name='PiPilot.exe'" |
        Where-Object { $_.CommandLine -like "*--remote-debugging-port=$env:PIPILOT_TEST_DEBUG_PORT*" } |
        ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1;
        if (-not $candidate) { throw 'Portable fixture window not found' };
        $shell = New-Object -ComObject WScript.Shell;
        if (-not $shell.AppActivate($candidate.Id)) { throw 'Portable fixture window could not be activated' };
        $shell.SendKeys('{F10}{DOWN}{END}{ENTER}')`,
      { ...process.env, PIPILOT_TEST_DEBUG_PORT: String(debuggingPort) })
      await expect.poll(() => child!.exitCode, { timeout: 60_000, message: 'File > Quit must cleanly exit the portable app before overwrite.' }).toBe(0)
      await expect.poll(async () => (await portableProcesses()).filter((process) => !preexistingPids.has(process.ProcessId)),
        { timeout: 30_000 }).toEqual([])
      await browser!.close().catch(() => undefined)
    }
    const conversation = () => page!.getByRole('log', { name: 'Conversation', exact: true })
    const nameSession = async (name: string) => {
      await expect(page!.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
      expect(await page!.evaluate((name) => window.pipilot!.localPi.runtime.command({ type: 'set_session_name', name }), name)).toMatchObject({ success: true })
      const sessionFile = (await page!.evaluate(() => window.pipilot!.localPi.runtime.status())).sessionFile
      expect(sessionFile).toBeTruthy()
      await expect(page!.getByRole('button', { name, exact: true })).toBeVisible()
      return sessionFile!
    }
    try {
      await launch()
      await page!.evaluate(() => window.pipilot!.settings.update({ composer: { sendShortcut: 'mod-enter' } }))
      await expect.poll(async () => JSON.parse(await readFile(join(data, 'settings.json'), 'utf8')).settings.composer.sendShortcut).toBe('mod-enter')
      // Persist through the real IPC save path, without reloading a running
      // Runtime or replacing the provider used by the conversation fixture.
      const savedModels = await page!.evaluate(async () => {
        const current = await window.pipilot!.modelsConfig.load({ kind: 'global' })
        const document = JSON.parse(current.content) as {
          providers: Record<string, { models: Array<{ id: string; name?: string }> }>
        }
        document.providers.fixture.models.push({ id: 'portable-retained-model', name: 'Portable Retained Model' })
        return window.pipilot!.modelsConfig.save({ kind: 'global' }, `${JSON.stringify(document, null, 2)}\n`, current.fingerprint)
      })
      expect(savedModels).toMatchObject({ apply: 'saved', snapshot: { path: join(agent, 'models.json'), valid: true } })
      expect(savedModels.snapshot.providers.find(({ id }) => id === 'fixture')?.models)
        .toContainEqual(expect.objectContaining({ id: 'portable-retained-model', name: 'Portable Retained Model' }))
      expect(await readFile(join(agent, 'models.json'), 'utf8')).toBe(savedModels.snapshot.content)
      await page!.getByRole('button', { name: 'New chat', exact: true }).click()
      await expect.poll(() => page!.evaluate(() => window.pipilot!.localPi.runtime.status()), { timeout: 60_000 }).toMatchObject({ state: 'ready' })
      await expect.poll(() => npxFixture.hasCall('tools/list'), { timeout: 60_000 }).toBe(true)
      await page!.getByRole('textbox', { name: 'Message input' }).fill(prompt)
      await page!.getByRole('button', { name: 'Send', exact: true }).click()
      await expect.poll(() => fixture.codemodeResults).toEqual([expect.stringContaining(NPX_MCP_CANARY_TEXT)])
      expect(await npxFixture.hasCall('tools/call')).toBe(true)
      await expect(conversation()).toContainText(`Fixture response: ${prompt}`)
      const chatName = 'Portable retained chat'
      const chatFile = await nameSession(chatName)
      await page!.getByRole('button', { name: `New task in ${project.name}`, exact: true }).click()
      await expect.poll(() => page!.evaluate(() => window.pipilot!.localPi.runtime.status()), { timeout: 60_000 })
        .toMatchObject({ state: 'ready', cwd: project.path })
      const projectPrompt = 'Keep this project conversation after overwriting the portable program'
      await page!.getByRole('textbox', { name: 'Message input' }).fill(projectPrompt)
      await page!.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(conversation()).toContainText(`Fixture response: ${projectPrompt}`)
      const taskName = 'Portable retained project task'
      const projectFile = await nameSession(taskName)
      await page!.screenshot({ path: testInfo.outputPath(`portable-${extension}.png`) })
      await quit()

      // The user's update procedure: overwrite the program in the same folder,
      // keeping every byte of the adjacent data directory. No test path override,
      // re-seeded settings or synthetic session records are involved at restart.
      const before = await dataManifest(data)
      expect(Object.keys(before)).toContain('workspaces.json')
      const settingsBefore = await readFile(join(data, 'settings.json'), 'utf8')
      const workspacesBefore = await readFile(join(data, 'workspaces.json'), 'utf8')
      for (const file of [chatFile, projectFile]) expect(await readFile(file, 'utf8')).toContain('"type":"session"')
      await installProgram()
      expect(await dataManifest(data), 'Overwriting the portable program must not touch data.').toEqual(before)

      await launch()
      expect(await readFile(join(data, 'settings.json'), 'utf8')).toBe(settingsBefore)
      expect(await readFile(join(data, 'workspaces.json'), 'utf8')).toBe(workspacesBefore)
      expect(await readFile(join(agent, 'models.json'), 'utf8')).toBe(savedModels.snapshot.content)
      const restoredModels = await page!.evaluate(() => window.pipilot!.modelsConfig.load({ kind: 'global' }))
      expect(restoredModels).toMatchObject({
        path: join(agent, 'models.json'), valid: true, content: savedModels.snapshot.content,
        fingerprint: savedModels.snapshot.fingerprint,
      })
      expect(restoredModels.providers.find(({ id }) => id === 'fixture')?.models)
        .toContainEqual(expect.objectContaining({ id: 'portable-retained-model', name: 'Portable Retained Model' }))
      expect((await page!.evaluate(() => window.pipilot!.settings.get())).settings.composer.sendShortcut).toBe('mod-enter')
      expect((await page!.evaluate(() => window.pipilot!.workspace.get())).recent).toContainEqual(expect.objectContaining({
        id: project.id, name: project.name, pinned: true, available: true,
      }))
      await expect(page!.getByRole('button', { name: `Project actions for ${project.name}`, exact: true })).toBeVisible()
      await page!.getByRole('button', { name: chatName, exact: true }).click()
      await expect(conversation()).toContainText(prompt)
      await expect(conversation()).toContainText(`Fixture response: ${prompt}`)
      await page!.getByRole('button', { name: taskName, exact: true }).click()
      await expect(conversation()).toContainText(projectPrompt)
      await expect(conversation()).toContainText(`Fixture response: ${projectPrompt}`)
      await expect.poll(() => page!.evaluate(() => window.pipilot!.localPi.runtime.status()), { timeout: 60_000 })
        .toMatchObject({ state: 'ready', cwd: project.path, sessionFile: projectFile })
      await page!.screenshot({ path: testInfo.outputPath(`portable-${extension}-after-overwrite.png`) })
      await quit()
    } finally {
      try {
        await stopPortableProcesses(preexistingPids)
      } finally {
        await browser?.close().catch(() => undefined)
        await fixture.close()
        await writeFile(testInfo.outputPath('application.log'), output)
        await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
      }
    }
  })
}
