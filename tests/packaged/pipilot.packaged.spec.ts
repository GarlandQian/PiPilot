import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, readdirSync } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import {
  chromium,
  expect,
  test,
  type Browser,
  type Page,
} from '@playwright/test'
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses'
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/server'
import { PIPILOT_VERSION } from '../../src/shared/build-info'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { createWindowsUserPathAdapter } from '../../src/main/external-control/launcher-service'
import { startPiSdkFixture } from '../electron/pi-sdk-fixture'

const require = createRequire(import.meta.url)
const packagedWorkspaceId = '11111111-1111-4111-8111-111111111111'

function readWindowsPeSubsystem(executable: Buffer) {
  if (executable.length < 0x40) throw new Error('PE executable is too small.')
  const peOffset = executable.readUInt32LE(0x3c)
  const optionalHeaderOffset = peOffset + 4 + 20
  const optionalHeaderSize = peOffset + 22 <= executable.length
    ? executable.readUInt16LE(peOffset + 4 + 16)
    : 0
  if (
    peOffset + 24 > executable.length ||
    executable.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0' ||
    optionalHeaderSize < 70 ||
    optionalHeaderOffset + optionalHeaderSize > executable.length
  ) {
    throw new Error('PE executable header is invalid.')
  }
  return executable.readUInt16LE(optionalHeaderOffset + 68)
}

function officialSessionDirectory(agentDirectory: string, cwd: string) {
  const encodedCwd = `--${resolve(cwd)
    .replace(/^[/\\]/u, '')
    .replace(/[/\\:]/gu, '-')}--`
  return join(agentDirectory, 'sessions', encodedCwd)
}

async function createPackagedPersistedSession(
  directory: string,
  cwd: string,
  index: number,
) {
  const suffix = String(index).padStart(2, '0')
  const sessionId = `packaged-session-${suffix}`
  const name = `Packaged retained session ${suffix}`
  const prompt = `Packaged retained prompt ${suffix}`
  const response = `Packaged retained response ${suffix}`
  const timestamp = `2026-08-14T00:${suffix}:00.000Z`
  const file = join(directory, `${sessionId}.jsonl`)
  const entryId = (offset: number) =>
    `00000000-0000-4000-8000-${String(index * 10 + offset).padStart(12, '0')}`
  await writeFile(file, `${[
    {
      type: 'session',
      version: 3,
      id: sessionId,
      timestamp,
      cwd,
    },
    {
      type: 'message',
      id: entryId(1),
      parentId: null,
      timestamp,
      message: {
        role: 'user',
        content: prompt,
        timestamp: Date.parse(timestamp),
      },
    },
    {
      type: 'message',
      id: entryId(2),
      parentId: entryId(1),
      timestamp: `2026-08-14T00:${suffix}:01.000Z`,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: response }],
        api: 'openai-completions',
        provider: 'fixture',
        model: 'fake-chat',
        usage: {
          input: 8,
          output: 6,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 14,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.parse(`2026-08-14T00:${suffix}:01.000Z`),
      },
    },
    {
      type: 'session_info',
      id: entryId(3),
      parentId: entryId(2),
      timestamp: `2026-08-14T00:${suffix}:02.000Z`,
      name,
    },
  ].map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8')
  return { file: await realpath(file), name, prompt, response, sessionId }
}

async function createPackagedPiPackage(root: string) {
  const skillDirectory = join(root, 'skills', 'packaged-fixture-skill')
  const promptsDirectory = join(root, 'prompts')
  await Promise.all([
    mkdir(skillDirectory, { recursive: true }),
    mkdir(promptsDirectory, { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(root, 'package.json'), `${JSON.stringify({
      name: 'packaged-fixture-package',
      version: '1.0.0',
      keywords: ['pi-package'],
      pi: {
        skills: ['./skills'],
        prompts: ['./prompts'],
      },
    }, null, 2)}\n`, 'utf8'),
    writeFile(
      join(skillDirectory, 'SKILL.md'),
      '---\nname: packaged-fixture-skill\ndescription: Packaged application Skill fixture.\n---\n\nUse the packaged fixture.\n',
      'utf8',
    ),
    writeFile(
      join(promptsDirectory, 'packaged-fixture-prompt.md'),
      'Run the packaged fixture prompt.\n',
      'utf8',
    ),
  ])
  return realpath(root)
}

function resolvePackagedExecutable() {
  const explicitPath = process.env.PIPILOT_PACKAGED_APP_PATH
  if (explicitPath) {
    const resolvedPath = resolve(explicitPath)
    if (process.platform === 'darwin' && resolvedPath.endsWith('.app')) {
      const bundledExecutable = join(
        resolvedPath,
        'Contents',
        'MacOS',
        'PiPilot',
      )
      if (!existsSync(bundledExecutable)) {
        throw new Error(`The PiPilot application bundle has no executable: ${resolvedPath}`)
      }
      return bundledExecutable
    }
    return resolvedPath
  }

  const candidates = process.platform === 'darwin'
    ? [
        'release/mac-arm64/PiPilot.app/Contents/MacOS/PiPilot',
        'release/mac/PiPilot.app/Contents/MacOS/PiPilot',
        'release/mac-x64/PiPilot.app/Contents/MacOS/PiPilot',
      ]
    : process.platform === 'win32'
      ? ['release/win-unpacked/PiPilot.exe']
      : ['release/linux-unpacked/pipilot']
  const executable = candidates
    .map((candidate) => resolve(candidate))
    .find((candidate) => existsSync(candidate))

  if (!executable) {
    throw new Error(
      'No unpacked PiPilot application was found. Run the current-platform package:dir command first.',
    )
  }
  return executable
}

function resolveAsarApi() {
  const electronBuilderRequire = createRequire(
    require.resolve('electron-builder/package.json'),
  )
  const appBuilderRequire = createRequire(
    electronBuilderRequire.resolve('app-builder-lib/package.json'),
  )
  const asarRequire = createRequire(
    appBuilderRequire.resolve('@electron/asar/package.json'),
  )
  return asarRequire('@electron/asar') as {
    listPackage(archive: string): string[]
  }
}

function inspectPackagedApplication(executable: string) {
  const resourcesDirectory = process.platform === 'darwin'
    ? resolve(dirname(executable), '../Resources')
    : join(dirname(executable), 'resources')
  const appArchive = join(resourcesDirectory, 'app.asar')
  const entries = resolveAsarApi().listPackage(appArchive)
    .map((entry) => entry.replace(/\\/g, '/').replace(/^\/+/, ''))
  const unpackedPty = join(
    resourcesDirectory,
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
  )
  const unpackedEntries = existsSync(unpackedPty)
    ? readdirSync(unpackedPty, { recursive: true }).map(String)
    : []
  const rootOnlyExclusions = [
    '.agents',
    '.claude',
    '.codex',
    '.env',
    '.mcp.json',
    '.pi',
    '.playwright-mcp',
    '.trellis',
    'AGENTS.md',
    'docs',
    'src',
    'tests',
    'test-results',
  ]

  return {
    hasLegacyAgentWorker: entries.includes('out/main/agent-worker.js'),
    hasMain: entries.includes('out/main/index.js'),
    hasPiHostUtility: entries.includes('out/main/pi-host-utility.js'),
    hasPiManagementHelper: entries.includes('out/main/pi-management-helper.js'),
    hasEmbeddedPiSdk: entries.some((entry) =>
      entry.startsWith('node_modules/@earendil-works/pi-')),
    hasPreload: entries.includes('out/preload/index.cjs'),
    hasRenderer: entries.includes('out/renderer/index.html'),
    hasExcludedRoot: entries.some((entry) =>
      rootOnlyExclusions.some((excluded) =>
        entry === excluded || entry.startsWith(`${excluded}/`))),
    hasTestArtifact: entries.some((entry) =>
      /(^|\/)(__tests__|tests?|coverage)(\/|$)|\.test\./i.test(entry)),
    hasNativePty: unpackedEntries.some((entry) => entry.endsWith('.node')),
  }
}

async function reserveDebugPort() {
  const server = createServer()
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('A local Chromium debugging port could not be reserved.')
  }
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => error ? reject(error) : resolveClose()))
  return address.port
}

function delay(milliseconds: number) {
  return new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds)
  })
}

async function connectToPackagedApp(
  port: number,
  appProcess: ChildProcess,
  getLaunchOutput: () => string,
) {
  const endpoint = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (appProcess.exitCode !== null || appProcess.signalCode !== null) {
      throw new Error(
        `PiPilot exited before CDP was ready (code ${appProcess.exitCode}, signal ${appProcess.signalCode}).\n${getLaunchOutput()}`,
      )
    }
    try {
      return await chromium.connectOverCDP(endpoint)
    } catch {
      await delay(100)
    }
  }
  throw new Error(`PiPilot did not expose CDP in time.\n${getLaunchOutput()}`)
}

async function findPiPilotPage(browser: Browser) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (await page.title().catch(() => '') === 'PiPilot') return page
      }
    }
    await delay(100)
  }
  throw new Error('The packaged PiPilot renderer did not become available.')
}

async function waitForProcessExit(appProcess: ChildProcess, timeoutMs: number) {
  if (appProcess.exitCode !== null || appProcess.signalCode !== null) return true
  return Promise.race([
    once(appProcess, 'exit').then(() => true),
    delay(timeoutMs).then(() => false),
  ])
}

async function settleWithin(task: Promise<unknown>, timeoutMs: number) {
  await Promise.race([
    task.catch(() => undefined),
    delay(timeoutMs),
  ])
}

function unexpectedPackagedMcpStderr(stderr: string) {
  return stderr
    .split(/\r?\n/u)
    .filter(Boolean)
    .filter((line) => !(
      line.includes('dbus/bus.cc:') ||
      line.includes('dbus/object_proxy.cc:') ||
      line.includes('Failed to connect to the bus:') ||
      line.includes('org.freedesktop.DBus')
    ))
    .join('\n')
}

function unexpectedPackagedMcpStdout(stdout: string) {
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !(process.platform === 'win32' && line === '\u00b7'))
    .join('\n')
}

async function stopPackagedApp(
  page: Page | null,
  browser: Browser | null,
  appProcess: ChildProcess,
) {
  // Electron can keep a CDP target alive on Linux while a utility process is
  // draining. Cleanup must not consume the whole Playwright test timeout.
  await settleWithin(
    page?.close({ runBeforeUnload: false }) ?? Promise.resolve(),
    5_000,
  )
  await settleWithin(browser?.close() ?? Promise.resolve(), 5_000)
  if (await waitForProcessExit(appProcess, 5_000)) return

  if (appProcess.exitCode === null && appProcess.signalCode === null) {
    appProcess.kill()
  }
  if (await waitForProcessExit(appProcess, 3_000)) return

  appProcess.kill('SIGKILL')
  if (!await waitForProcessExit(appProcess, 3_000)) {
    throw new Error('The packaged PiPilot process did not exit after forced termination.')
  }
}

test('runs the bundled Pi SDK workflow from the packaged application', async () => {
  test.setTimeout(180_000)
  const executable = resolvePackagedExecutable()
  expect(inspectPackagedApplication(executable)).toEqual({
    hasLegacyAgentWorker: false,
    hasMain: true,
    hasPiHostUtility: true,
    hasPiManagementHelper: true,
    hasEmbeddedPiSdk: true,
    hasPreload: true,
    hasRenderer: true,
    hasExcludedRoot: false,
    hasTestArtifact: false,
    hasNativePty: true,
  })
  const fuseWire = await getCurrentFuseWire(executable)
  expect(fuseWire[FuseV1Options.RunAsNode]).toBe(FuseState.ENABLE)
  expect(fuseWire[FuseV1Options.EnableNodeOptionsEnvironmentVariable])
    .toBe(FuseState.DISABLE)
  expect(fuseWire[FuseV1Options.EnableNodeCliInspectArguments])
    .toBe(FuseState.DISABLE)

  const userDataPath = await mkdtemp(join(tmpdir(), 'pipilot-packaged-smoke-'))
  const workspacePath = await mkdtemp(join(tmpdir(), 'PiPilot 项目 (A) & Notes-'))
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'pipilot-sdk-fixture-'))
  const agentDir = join(fixtureRoot, 'agent-data')
  const hostFailureMarker = join(fixtureRoot, 'host-failure.marker')
  const writeProjectionPrompt = 'Packaged official write result remains live'
  const writeProjectionFollowUp = 'Packaged prompt after official write result'
  const writeProjectionContent = 'Packaged write projection regression\n'
  const writeProjectionTarget = join(workspacePath, 'official-write.txt')
  const globalPackagePath = await createPackagedPiPackage(
    join(fixtureRoot, 'global-package'),
  )
  const piFixture = await startPiSdkFixture({
    agentDir,
    globalPackages: [globalPackagePath],
    promptDelays: {
      'Packaged background session stays alive': 15_000,
    },
    writeToolPrompts: {
      [writeProjectionPrompt]: {
        path: writeProjectionTarget,
        content: writeProjectionContent,
      },
    },
  })
  const canonicalWorkspacePath = await realpath(workspacePath)
  const selectedSessionDirectory = officialSessionDirectory(
    agentDir,
    canonicalWorkspacePath,
  )
  const selectedSessionFile = join(
    selectedSessionDirectory,
    'packaged-existing-session.jsonl',
  )
  const sessionTimestamp = '2026-08-14T00:00:00.000Z'
  const selectedUsage = {
    input: 12,
    output: 8,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 20,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  }
  await mkdir(selectedSessionDirectory, { recursive: true })
  await writeFile(
    selectedSessionFile,
    `${[
      {
        type: 'session',
        version: 3,
        id: 'packaged-existing-session',
        timestamp: sessionTimestamp,
        cwd: canonicalWorkspacePath,
      },
      {
        type: 'message',
        id: '00000000-0000-4000-8000-000000000201',
        parentId: null,
        timestamp: sessionTimestamp,
        message: {
          role: 'user',
          content: 'Selected session history prompt',
          timestamp: Date.parse(sessionTimestamp),
        },
      },
      {
        type: 'message',
        id: '00000000-0000-4000-8000-000000000202',
        parentId: '00000000-0000-4000-8000-000000000201',
        timestamp: '2026-08-14T00:00:01.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Selected session history response' }],
          api: 'openai-completions',
          provider: 'fixture',
          model: 'fake-chat',
          usage: selectedUsage,
          stopReason: 'stop',
          timestamp: Date.parse('2026-08-14T00:00:01.000Z'),
        },
      },
      {
        type: 'session_info',
        id: '00000000-0000-4000-8000-000000000203',
        parentId: '00000000-0000-4000-8000-000000000202',
        timestamp: '2026-08-14T00:00:02.000Z',
        name: 'Packaged existing session',
      },
    ].map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    'utf8',
  )
  const retainedSessions = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      createPackagedPersistedSession(
        selectedSessionDirectory,
        canonicalWorkspacePath,
        index + 1,
      )),
  )
  const canonicalSelectedSessionFile = await realpath(selectedSessionFile)
  await writeFile(
    join(userDataPath, 'workspaces.json'),
    `${JSON.stringify({
      version: 1,
      recent: [{
        id: packagedWorkspaceId,
        name: basename(canonicalWorkspacePath),
        path: canonicalWorkspacePath,
        lastOpenedAt: sessionTimestamp,
        pinned: false,
      }],
    }, null, 2)}\n`,
    'utf8',
  )
  await writeFile(
    join(userDataPath, 'settings.json'),
    `${JSON.stringify({
      version: SETTINGS_SCHEMA_VERSION,
      settings: {
        ...DEFAULT_SETTINGS,
        locale: 'en-US',
      },
    }, null, 2)}\n`,
    'utf8',
  )

  const debugPort = await reserveDebugPort()
  let launchOutput = ''
  const appProcess = spawn(
    executable,
    [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${join(userDataPath, 'browser-data')}`,
    ],
    {
      env: {
        ...process.env,
        ...piFixture.env,
        PIPILOT_PACKAGED_SMOKE: '1',
        PIPILOT_E2E_STARTUP_DELAY_MS: '900',
        PIPILOT_E2E_HOST_FAILURE_MARKER: hostFailureMarker,
        PIPILOT_E2E_USER_DATA: userDataPath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const collectOutput = (chunk: Buffer) => {
    launchOutput = `${launchOutput}${chunk.toString('utf8')}`.slice(-16_384)
  }
  appProcess.stdout?.on('data', collectOutput)
  appProcess.stderr?.on('data', collectOutput)

  let browser: Browser | null = null
  let page: Page | null = null
  try {
    browser = await connectToPackagedApp(debugPort, appProcess, () => launchOutput)
    page = await findPiPilotPage(browser)
    await page.waitForLoadState('domcontentloaded')

    await expect(page).toHaveTitle('PiPilot')
    expect(page.url()).toBe('pipilot://app/')
    await expect(page.evaluate(() => window.pipilot!.app.getInfo()))
      .resolves.toMatchObject({
        name: 'PiPilot',
        version: PIPILOT_VERSION,
        mode: 'production',
      })

    const bridge = await page.evaluate(() => Object.keys(window.pipilot!).sort())
    expect(bridge).toEqual([
      'app',
      'applicationUpdate',
      'changes',
      'conversation',
      'externalControl',
      'files',
      'localPi',
      'mcpConfig',
      'modelsConfig',
      'piIntegrations',
      'sessionCatalog',
      'settings',
      'shell',
      'terminal',
      'window',
      'workspace',
    ])

    await expect.poll(() => page!.evaluate(() => (
      window.pipilot!.localPi.runtime.status()
    ))).toMatchObject({ state: 'ready' })

    const workspaceSnapshot = await page.evaluate(() => window.pipilot!.workspace.get())
    expect(workspaceSnapshot.current).toBeUndefined()
    expect(workspaceSnapshot.recent).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: packagedWorkspaceId,
        name: basename(canonicalWorkspacePath),
        available: true,
      }),
    ]))
    const navigation = await page.evaluate(() => window.pipilot!.conversation.get())
    expect(navigation.activeScope).toEqual({ kind: 'projectless' })

    const projectActions = page.getByRole('button', {
      name: `Project actions for ${basename(canonicalWorkspacePath)}`,
      exact: true,
    })
    await projectActions.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('menuitem', { name: 'Open project', exact: true }).click()
    await expect.poll(() => page!.evaluate(() => window.pipilot!.conversation.get()))
      .toMatchObject({
        activeScope: { kind: 'project', workspaceId: packagedWorkspaceId },
      })
    await expect.poll(() => page!.evaluate(() => (
      window.pipilot!.localPi.runtime.status()
    ))).toMatchObject({ state: 'ready', cwd: canonicalWorkspacePath })

    await page.getByRole('button', { name: 'Show more', exact: true }).click()

    const projectSession = page.getByRole('button', {
      name: 'Packaged existing session',
      exact: true,
    })
    await expect(projectSession).toBeVisible()

    await expect.poll(() => page!.evaluate(() => (
      window.pipilot!.piIntegrations.load({ kind: 'global' })
    ))).toMatchObject({
      state: 'ready',
      executable: { version: '0.84.2' },
      packages: [expect.objectContaining({
        displayName: 'packaged-fixture-package',
        installedVersion: '1.0.0',
        source: globalPackagePath,
        scope: 'global',
      })],
      resources: expect.arrayContaining([
        expect.objectContaining({
          label: 'packaged-fixture-skill',
          kind: 'skill',
          scope: 'global',
        }),
        expect.objectContaining({
          label: 'packaged-fixture-prompt',
          kind: 'prompt',
          scope: 'global',
        }),
      ]),
    })

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page
      .getByRole('region', { name: 'Settings', exact: true })
      .getByRole('button', { name: 'Integrations', exact: true })
      .click()
    const integrationsMain = page.getByRole('main', {
      name: 'Integrations',
      exact: true,
    })
    await expect(integrationsMain.getByRole('heading', {
      name: 'Integrations',
      exact: true,
    })).toBeVisible()
    await expect(integrationsMain.getByText(/Pi 0\.84\.2/u)).toBeVisible()
    await integrationsMain.getByRole('tab', {
      name: 'Packages',
      exact: true,
    }).click()
    await expect(integrationsMain.getByRole('button', {
      name: /packaged-fixture-package/iu,
    }).first()).toBeVisible()
    await page.getByRole('button', { name: 'Sessions', exact: true }).click()

    await page.getByRole('button', { name: 'Quick general chat', exact: true }).click()
    await expect.poll(() => page!.evaluate(() => window.pipilot!.conversation.get()))
      .toMatchObject({ activeScope: { kind: 'projectless' } })
    await expect.poll(() => page!.evaluate(() => (
      window.pipilot!.localPi.runtime.status()
    ))).toMatchObject({ state: 'ready' })
    await expect(projectSession).toBeVisible()

    const runtimeBeforeProjectSession = await page.evaluate(() => (
      window.pipilot!.localPi.runtime.status()
    ))
    await projectActions.focus()
    await page.keyboard.press('Enter')
    const newSessionItem = page.getByRole('menuitem', {
      name: 'New session',
      exact: true,
    })
    await expect(newSessionItem).toBeVisible()
    await expect(newSessionItem).toBeFocused()
    await page.keyboard.press('Enter')

    await expect.poll(() => page!.evaluate(() => {
      const runtime = window.pipilot!.localPi.runtime.status()
      return runtime.then((snapshot) => ({
        cwd: snapshot.cwd,
        sessionId: snapshot.sessionState?.sessionId,
        state: snapshot.state,
      }))
    })).toEqual({
      cwd: canonicalWorkspacePath,
      sessionId: expect.any(String),
      state: 'ready',
    })
    const projectRuntime = await page.evaluate(() => (
      window.pipilot!.localPi.runtime.status()
    ))
    expect(projectRuntime.sessionState?.sessionId)
      .not.toBe(runtimeBeforeProjectSession.sessionState?.sessionId)

    const composer = page.getByRole('textbox', { name: 'Message input' })
    await expect(composer).toBeEditable()
    await composer.fill('Packaged project menu session is ready')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const staleResponse = page.getByText(
      'Fixture response: Packaged project menu session is ready',
      { exact: true },
    )
    await expect(staleResponse).toBeVisible()
    expect(piFixture.prompts).toContain('Packaged project menu session is ready')

    // The delayed-start Electron test owns frame-level loading continuity;
    // packaged hydration can settle before a renderer observer samples it.
    await projectSession.click()

    const inspector = page.getByRole('complementary', { name: 'Inspector' })
    await expect(staleResponse).toHaveCount(0)
    await expect(page.getByText(
      'Selected session history prompt',
      { exact: true },
    )).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(
      'Selected session history response',
      { exact: true },
    )).toBeVisible()

    await expect(page.getByText('Loading conversation…', { exact: true }))
      .toHaveCount(0)
    await expect(inspector.getByText(
      'Loading Pi session data…',
      { exact: true },
    )).toHaveCount(0)
    await expect(page.getByText('No session selected', { exact: true })).toHaveCount(0)
    await expect(inspector.getByText('No Pi session selected', { exact: true }))
      .toHaveCount(0)
    await expect(page.getByText('Operation failed', { exact: true })).toHaveCount(0)
    await expect(page.evaluate(() => window.pipilot!.localPi.runtime.status()))
      .resolves.toMatchObject({
        state: 'ready',
        cwd: canonicalWorkspacePath,
        sessionFile: canonicalSelectedSessionFile,
      })

    await expect(composer).toBeEditable()
    await composer.fill('Packaged selected session is usable')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByText(
      'Fixture response: Packaged selected session is usable',
      { exact: true },
    )).toBeVisible()
    expect(piFixture.prompts).toContain('Packaged selected session is usable')
    await expect.poll(() => page!.evaluate(async () => {
      const state = (await window.pipilot!.localPi.runtime.status()).sessionState
      return {
        isStreaming: state?.isStreaming,
        pendingMessageCount: state?.pendingMessageCount,
      }
    })).toEqual({ isStreaming: false, pendingMessageCount: 0 })

    // Exercise the official SDK write implementation, whose successful result
    // contains `details: undefined`. DTO projection omits that field; the Host
    // and selected Session must stay live for the settlement and next prompt.
    await composer.fill(writeProjectionPrompt)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(
      () => readFile(writeProjectionTarget, 'utf8').catch(() => ''),
      { timeout: 20_000 },
    ).toBe(writeProjectionContent)
    await expect.poll(
      () => page!.evaluate(() => window.pipilot!.localPi.runtime.status()),
      { timeout: 20_000 },
    ).toMatchObject({
      state: 'ready',
      sessionFile: canonicalSelectedSessionFile,
      sessionState: {
        isStreaming: false,
        pendingMessageCount: 0,
        sessionId: 'packaged-existing-session',
      },
    })
    const writeProjectionResponse = page.getByText(
      `Fixture response: ${writeProjectionPrompt}`,
      { exact: true },
    )
    await expect(writeProjectionResponse).toHaveCount(1, { timeout: 20_000 })
    await expect(writeProjectionResponse).toBeVisible()
    await expect(page.getByText('No session selected', { exact: true })).toHaveCount(0)
    expect(piFixture.prompts.filter(
      (prompt) => prompt === writeProjectionPrompt,
    )).toHaveLength(2)

    await composer.fill(writeProjectionFollowUp)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByText(
      `Fixture response: ${writeProjectionFollowUp}`,
      { exact: true },
    )).toBeVisible({ timeout: 20_000 })
    await expect(page.evaluate(() => window.pipilot!.localPi.runtime.status()))
      .resolves.toMatchObject({
        state: 'ready',
        sessionFile: canonicalSelectedSessionFile,
        sessionState: {
          isStreaming: false,
          sessionId: 'packaged-existing-session',
        },
      })

    // Keep one Runtime executing while enough other persisted Sessions are
    // activated to exceed the per-Host idle cache. The executing Runtime must
    // survive in the background, while an evicted idle Session must cold-open
    // from its unchanged JSONL row on one click.
    await composer.fill('Packaged background session stays alive')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => piFixture.prompts.includes(
      'Packaged background session stays alive',
    )).toBe(true)
    await expect(page.getByText(
      'Fixture response: Packaged background session stays alive',
      { exact: true },
    )).toHaveCount(0)

    for (const session of retainedSessions) {
      await page.getByRole('button', { name: session.name, exact: true }).click()
      await expect(page.getByText(session.response, { exact: true }))
        .toBeVisible({ timeout: 20_000 })
      await expect(page.evaluate(() => window.pipilot!.localPi.runtime.status()))
        .resolves.toMatchObject({
          state: 'ready',
          sessionFile: session.file,
          sessionState: { sessionId: session.sessionId },
        })
    }

    await delay(5_000)
    const firstRetained = retainedSessions[0]!
    await page.getByRole('button', { name: firstRetained.name, exact: true }).click()
    await expect(page.getByText(firstRetained.response, { exact: true }))
      .toBeVisible({ timeout: 20_000 })
    await expect(page.evaluate(() => window.pipilot!.localPi.runtime.status()))
      .resolves.toMatchObject({
        state: 'ready',
        sessionFile: firstRetained.file,
        sessionState: { sessionId: firstRetained.sessionId },
      })

    await projectSession.click()
    await expect(page.getByText(
      'Fixture response: Packaged background session stays alive',
      { exact: true },
    )).toBeVisible({ timeout: 20_000 })
    await expect(page.evaluate(() => window.pipilot!.localPi.runtime.status()))
      .resolves.toMatchObject({
        state: 'ready',
        sessionFile: canonicalSelectedSessionFile,
        sessionState: { sessionId: 'packaged-existing-session' },
      })

    // A fatal extension shutdown must become a terminal Host state. Abort is
    // also the recovery control: it creates one fresh Host, hydrates the exact
    // persisted Session, and never replays the interrupted prompt.
    await composer.fill('/fixture-host-failure')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => page!.evaluate(async () => (
      (await window.pipilot!.localPi.runtime.status()).state
    )), { timeout: 20_000 }).toBe('crashed')

    await page.evaluate(async () => {
      await window.pipilot!.localPi.runtime.command({ type: 'abort' })
    })
    await expect(page.evaluate(() => window.pipilot!.localPi.runtime.status()))
      .resolves.toMatchObject({
        state: 'ready',
        sessionFile: canonicalSelectedSessionFile,
        sessionState: { isStreaming: false },
      })
    const recoveredAbortPrompt = 'Packaged prompt after recovered abort'
    await composer.fill(recoveredAbortPrompt)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByText(
      `Fixture response: ${recoveredAbortPrompt}`,
      { exact: true },
    )).toBeVisible({ timeout: 20_000 })

    const recoverySession = retainedSessions[1]!
    await page.getByRole('button', { name: recoverySession.name, exact: true }).click()
    await expect(page.getByText(recoverySession.response, { exact: true }))
      .toBeVisible({ timeout: 20_000 })
    await expect(page.evaluate(() => window.pipilot!.localPi.runtime.status()))
      .resolves.toMatchObject({
        state: 'ready',
        sessionFile: recoverySession.file,
        sessionState: { sessionId: recoverySession.sessionId },
      })
    await projectSession.click()
    await expect(page.getByText(
      'Fixture response: Packaged background session stays alive',
      { exact: true },
    )).toBeVisible({ timeout: 20_000 })

    const productionLog = await readFile(
      join(userDataPath, 'logs', 'main.log'),
      'utf8',
    ).catch(() => '')
    expect(productionLog).toContain('APPLICATION_BOOTSTRAP')
    expect(productionLog).not.toContain('fixture-key')
    expect(productionLog).not.toContain(canonicalSelectedSessionFile)
  } finally {
    await stopPackagedApp(page, browser, appProcess)
    await piFixture.close()
    await Promise.all([
      rm(userDataPath, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      }),
      rm(workspacePath, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      }),
      rm(fixtureRoot, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 200,
      }),
    ])
  }
})

test('runs the installed stable MCP command headlessly through the private bridge', async () => {
  test.setTimeout(180_000)
  const executable = resolvePackagedExecutable()
  const userDataPath = await mkdtemp(join(tmpdir(), 'pipilot-packaged-smoke-mcp-'))
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'pipilot-packaged-mcp-fixture-'))
  const launcherDirectory = process.platform === 'win32'
    ? dirname(executable)
    : join(userDataPath, 'launcher-bin')
  await mkdir(launcherDirectory, { recursive: true, mode: 0o700 })
  const pathKey = Object.keys(process.env)
    .find((key) => key.toLocaleLowerCase('en-US') === 'path') ?? 'PATH'
  const launcherEnvironment = {
    ...process.env,
    PIPILOT_PACKAGED_SMOKE: '1',
    PIPILOT_E2E_USER_DATA: userDataPath,
    [pathKey]: `${launcherDirectory}${delimiter}${process.env[pathKey] ?? ''}`,
  }
  const piFixture = await startPiSdkFixture({
    agentDir: join(fixtureRoot, 'agent-data'),
  })
  await writeFile(
    join(userDataPath, 'settings.json'),
    `${JSON.stringify({
      version: SETTINGS_SCHEMA_VERSION,
      settings: { ...DEFAULT_SETTINGS, locale: 'en-US' },
    }, null, 2)}\n`,
    'utf8',
  )

  const debugPort = await reserveDebugPort()
  let launchOutput = ''
  const appProcess = spawn(executable, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${join(userDataPath, 'browser-data')}`,
  ], {
    env: {
      ...process.env,
      ...piFixture.env,
      PIPILOT_PACKAGED_SMOKE: '1',
      PIPILOT_E2E_EXTERNAL_CONTROL_LAUNCHER_DIRECTORY: launcherDirectory,
      PIPILOT_E2E_USER_DATA: userDataPath,
      [pathKey]: launcherEnvironment[pathKey],
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const collectLaunchOutput = (chunk: Buffer) => {
    launchOutput = `${launchOutput}${chunk.toString('utf8')}`.slice(-16_384)
  }
  appProcess.stdout?.on('data', collectLaunchOutput)
  appProcess.stderr?.on('data', collectLaunchOutput)

  let browser: Browser | null = null
  let page: Page | null = null
  let restoreWindowsPath: (() => void) | null = null
  try {
    browser = await connectToPackagedApp(debugPort, appProcess, () => launchOutput)
    page = await findPiPilotPage(browser)
    await page.waitForLoadState('domcontentloaded')
    if (process.platform === 'win32' && process.env.CI === 'true') {
      const adapter = createWindowsUserPathAdapter(
        process.env,
        join(userDataPath, 'registry-adapter-smoke'),
      )
      const original = adapter.read()
      restoreWindowsPath = () => {
        if (original) adapter.write(original)
        else adapter.remove()
      }
      for (const type of ['REG_SZ', 'REG_EXPAND_SZ'] as const) {
        const value = {
          type,
          value: '  C:\\工具;;%USERPROFILE%\\bin;C:\\Program Files\\PiPilot  ',
        }
        adapter.write(value)
        expect(adapter.read()).toEqual(value)
      }
      restoreWindowsPath()
    }
    const disabled = await page.evaluate(() => window.pipilot!.externalControl.get())
    expect(disabled).toMatchObject({ enabled: false, state: 'disabled' })

    const firstReady = await page.evaluate(() => (
      window.pipilot!.externalControl.setEnabled(true)
    ))
    expect(firstReady).toMatchObject({ enabled: true, state: 'ready' })
    const configuration = firstReady.configuration
    const canonicalUserDataPath = await realpath(userDataPath)
    expect(configuration).toEqual({ command: 'pipilot-mcp', args: [] })
    expect(Object.keys(configuration!)).toEqual(['command', 'args'])
    const descriptorPath = join(
      canonicalUserDataPath,
      'external-control',
      'descriptor.json',
    )
    expect(await realpath(descriptorPath)).toBe(descriptorPath)
    expect(JSON.stringify(configuration)).not.toContain('token')
    if (process.platform === 'win32') {
      const windowsLauncher = join(launcherDirectory, 'pipilot-mcp.exe')
      expect(existsSync(windowsLauncher)).toBe(true)
      expect(readWindowsPeSubsystem(await readFile(windowsLauncher))).toBe(3)
      if (process.env.CI === 'true') {
        const launcher = await page.evaluate(() => (
          window.pipilot!.externalControl.getLauncher()
        ))
        expect(['missing', 'installed']).toContain(launcher.state)
        if (launcher.state === 'missing') {
          expect(await page.evaluate(() => (
            window.pipilot!.externalControl.installLauncher()
          ))).toEqual({ state: 'installed', managed: true, requiresClientRestart: true })
        }
      }
    } else {
      expect(await page.evaluate(() => (
        window.pipilot!.externalControl.getLauncher()
      ))).toMatchObject({ state: 'missing' })
      expect(await page.evaluate(() => (
        window.pipilot!.externalControl.installLauncher()
      ))).toMatchObject({ state: 'installed' })
      expect(existsSync(join(launcherDirectory, 'pipilot-mcp'))).toBe(true)
    }
    const firstDescriptor = JSON.parse(await readFile(descriptorPath, 'utf8')) as {
      endpoint: string
      instanceId: string
      token: string
    }
    const descriptorDetails = await stat(descriptorPath)
    if (process.platform === 'win32') {
      expect(descriptorDetails.isFile()).toBe(true)
      // Windows named pipes are kernel endpoints, not filesystem entries.
      expect(firstDescriptor.endpoint).toMatch(/^\\\\\.\\pipe\\/u)
    } else {
      expect(descriptorDetails.mode & 0o077).toBe(0)
      const [endpointDetails, endpointDirectoryDetails] = await Promise.all([
        stat(firstDescriptor.endpoint),
        stat(dirname(firstDescriptor.endpoint)),
      ])
      expect(endpointDetails.isSocket()).toBe(true)
      expect(endpointDetails.mode & 0o077).toBe(0)
      expect(endpointDirectoryDetails.mode & 0o077).toBe(0)
    }

    const stdioProcess = spawn(configuration!.command, configuration!.args, {
      env: launcherEnvironment,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdoutBuffer = ''
    let stderr = ''
    const messages: Array<Record<string, unknown>> = []
    stdioProcess.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf8')
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() ?? ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue
        messages.push(JSON.parse(line) as Record<string, unknown>)
      }
    })
    stdioProcess.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8_192)
    })
    const waitForMessage = async (id: number) => {
      // Packaged Electron startup is noticeably slower on fresh Windows CI
      // runners. Keep early process failures immediate, but allow the MCP
      // handshake a bounded 90-second startup window.
      for (let attempt = 0; attempt < 1_800; attempt += 1) {
        const message = messages.find((candidate) => candidate.id === id)
        if (message) return message
        if (stdioProcess.exitCode !== null || stdioProcess.signalCode !== null) {
          throw new Error(`Packaged MCP exited before response ${id}: ${stderr}`)
        }
        await delay(50)
      }
      throw new Error(`Packaged MCP response ${id} timed out: ${stderr}`)
    }
    stdioProcess.stdin?.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'PiPilot packaged smoke', version: PIPILOT_VERSION },
      },
    })}\n`)
    const initialized = await waitForMessage(1)
    expect(initialized).toHaveProperty('result.serverInfo', {
      name: 'pipilot-conversations',
      version: PIPILOT_VERSION,
    })
    stdioProcess.stdin?.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })}\n`)
    stdioProcess.stdin?.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    })}\n`)
    const discovery = await waitForMessage(2)
    expect(discovery).not.toHaveProperty('error')
    expect(discovery).toHaveProperty('result.tools')
    expect((discovery.result as { tools: unknown[] }).tools).toHaveLength(6)
    await expect.poll(() => page!.evaluate(() => (
      window.pipilot!.externalControl.get()
    ))).toMatchObject({ connectedClients: 1 })
    expect(messages.every((message) => message.jsonrpc === '2.0')).toBe(true)
    expect(unexpectedPackagedMcpStderr(stderr)).toBe('')

    stdioProcess.stdin?.end()
    expect(await waitForProcessExit(stdioProcess, 10_000)).toBe(true)
    expect(stdioProcess.exitCode).toBe(0)
    await expect.poll(() => page!.evaluate(() => (
      window.pipilot!.externalControl.get()
    ))).toMatchObject({ connectedClients: 0 })

    await page.evaluate(() => window.pipilot!.externalControl.setEnabled(false))
    await expect.poll(() => existsSync(descriptorPath)).toBe(false)
    const secondReady = await page.evaluate(() => (
      window.pipilot!.externalControl.setEnabled(true)
    ))
    expect(secondReady.configuration).toEqual(configuration)
    const secondDescriptor = JSON.parse(await readFile(descriptorPath, 'utf8')) as {
      endpoint: string
      instanceId: string
      token: string
    }
    expect(secondDescriptor.endpoint).not.toBe(firstDescriptor.endpoint)
    expect(secondDescriptor.instanceId).not.toBe(firstDescriptor.instanceId)
    expect(secondDescriptor.token).not.toBe(firstDescriptor.token)

    await page.evaluate(() => window.pipilot!.externalControl.setEnabled(false))
    const unavailable = spawn(configuration!.command, configuration!.args, {
      env: launcherEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let unavailableStdout = ''
    let unavailableStderr = ''
    unavailable.stdout?.on('data', (chunk: Buffer) => {
      unavailableStdout += chunk.toString('utf8')
    })
    unavailable.stderr?.on('data', (chunk: Buffer) => {
      unavailableStderr += chunk.toString('utf8')
    })
    expect(await waitForProcessExit(unavailable, 10_000)).toBe(true)
    expect(unavailable.exitCode).toBe(1)
    expect(unexpectedPackagedMcpStdout(unavailableStdout)).toBe('')
    expect(unexpectedPackagedMcpStderr(unavailableStderr)).toBe(
      '[PiPilot MCP] PiPilot External Control is unavailable.',
    )
    expect(browser.contexts().flatMap((context) => context.pages())).toHaveLength(1)

    const beforeRestart = await page.evaluate(() => (
      window.pipilot!.externalControl.setEnabled(true)
    ))
    expect(beforeRestart.configuration).toEqual(configuration)
    const beforeRestartDescriptor = JSON.parse(
      await readFile(descriptorPath, 'utf8'),
    ) as { endpoint: string; instanceId: string; token: string }
    await stopPackagedApp(page, browser, appProcess)
    page = null
    browser = null

    const stopped = spawn(configuration!.command, configuration!.args, {
      env: launcherEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stoppedStdout = ''
    let stoppedStderr = ''
    stopped.stdout?.on('data', (chunk: Buffer) => {
      stoppedStdout += chunk.toString('utf8')
    })
    stopped.stderr?.on('data', (chunk: Buffer) => {
      stoppedStderr += chunk.toString('utf8')
    })
    expect(await waitForProcessExit(stopped, 10_000)).toBe(true)
    expect(stopped.exitCode).toBe(1)
    expect(unexpectedPackagedMcpStdout(stoppedStdout)).toBe('')
    expect(unexpectedPackagedMcpStderr(stoppedStderr)).toBe(
      '[PiPilot MCP] PiPilot External Control is unavailable.',
    )

    const restartDebugPort = await reserveDebugPort()
    let restartOutput = ''
    const restartedAppProcess = spawn(executable, [
      `--remote-debugging-port=${restartDebugPort}`,
      `--user-data-dir=${join(userDataPath, 'browser-data')}`,
    ], {
      env: {
        ...process.env,
        ...piFixture.env,
        PIPILOT_PACKAGED_SMOKE: '1',
        PIPILOT_E2E_EXTERNAL_CONTROL_LAUNCHER_DIRECTORY: launcherDirectory,
        PIPILOT_E2E_USER_DATA: userDataPath,
        [pathKey]: launcherEnvironment[pathKey],
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const collectRestartOutput = (chunk: Buffer) => {
      restartOutput = `${restartOutput}${chunk.toString('utf8')}`.slice(-16_384)
    }
    restartedAppProcess.stdout?.on('data', collectRestartOutput)
    restartedAppProcess.stderr?.on('data', collectRestartOutput)
    let restartedBrowser: Browser | null = null
    let restartedPage: Page | null = null
    try {
      restartedBrowser = await connectToPackagedApp(
        restartDebugPort,
        restartedAppProcess,
        () => restartOutput,
      )
      restartedPage = await findPiPilotPage(restartedBrowser)
      await restartedPage.waitForLoadState('domcontentloaded')
      await expect.poll(() => restartedPage!.evaluate(() => (
        window.pipilot!.externalControl.get()
      ))).toMatchObject({ enabled: true, state: 'ready' })
      const afterRestart = await restartedPage.evaluate(() => (
        window.pipilot!.externalControl.get()
      ))
      expect(afterRestart.configuration).toEqual(configuration)
      const afterRestartDescriptor = JSON.parse(
        await readFile(descriptorPath, 'utf8'),
      ) as { endpoint: string; instanceId: string; token: string }
      expect(afterRestartDescriptor.endpoint).not.toBe(beforeRestartDescriptor.endpoint)
      expect(afterRestartDescriptor.instanceId).not.toBe(beforeRestartDescriptor.instanceId)
      expect(afterRestartDescriptor.token).not.toBe(beforeRestartDescriptor.token)
      expect(
        restartedBrowser.contexts().flatMap((context) => context.pages()),
      ).toHaveLength(1)
    } finally {
      await stopPackagedApp(restartedPage, restartedBrowser, restartedAppProcess)
    }
  } finally {
    await stopPackagedApp(page, browser, appProcess)
    await piFixture.close()
    restoreWindowsPath?.()
    await Promise.all([
      rm(userDataPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
      rm(fixtureRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
    ])
  }
})
