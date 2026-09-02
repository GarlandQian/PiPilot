import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'

async function selectDirectory(
  electronApp: ElectronApplication,
  selectedPath: string,
) {
  await electronApp.evaluate(({ dialog }, path) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      writable: true,
      value: async () => ({ canceled: false, filePaths: [path] }),
    })
  }, selectedPath)
}

async function createLocalPiPackage(
  root: string,
  options: {
    name: string
    promptName: string
    skillName: string
    version: string
  },
) {
  const skillDirectory = join(root, 'skills', options.skillName)
  const promptsDirectory = join(root, 'prompts')
  await Promise.all([
    mkdir(skillDirectory, { recursive: true }),
    mkdir(promptsDirectory, { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(root, 'package.json'), `${JSON.stringify({
      name: options.name,
      version: options.version,
      keywords: ['pi-package'],
      pi: {
        skills: ['./skills'],
        prompts: ['./prompts'],
      },
    }, null, 2)}\n`, 'utf8'),
    writeFile(
      join(skillDirectory, 'SKILL.md'),
      `---\nname: ${options.skillName}\ndescription: ${options.name} integration fixture.\n---\n\nUse the real local package fixture.\n`,
      'utf8',
    ),
    writeFile(
      join(promptsDirectory, `${options.promptName}.md`),
      `Run the ${options.name} prompt.\n`,
      'utf8',
    ),
  ])
  return realpath(root)
}

test('manages bundled Pi SDK integrations and MCP drafts across responsive Settings', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const userDataPath = testInfo.outputPath('user-data')
  const workspacePath = testInfo.outputPath('workspace')
  const agentDir = testInfo.outputPath('pi-agent')
  const globalPackagePath = await createLocalPiPackage(
    testInfo.outputPath('global-package'),
    {
      name: 'fixture-global-package',
      version: '1.2.3',
      skillName: 'global-fixture-skill',
      promptName: 'global-fixture-prompt',
    },
  )
  const projectPackagePath = await createLocalPiPackage(
    testInfo.outputPath('project-package'),
    {
      name: 'fixture-project-package',
      version: '2.0.0',
      skillName: 'project-fixture-skill',
      promptName: 'project-fixture-prompt',
    },
  )
  const addedPackagePath = await createLocalPiPackage(
    testInfo.outputPath('added-package'),
    {
      name: 'fixture-added-package',
      version: '3.0.0',
      skillName: 'added-fixture-skill',
      promptName: 'added-fixture-prompt',
    },
  )
  const mcpPath = join(workspacePath, '.mcp.json')
  await Promise.all([
    mkdir(userDataPath, { recursive: true }),
    mkdir(join(workspacePath, '.pi'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(workspacePath, 'README.md'), '# Integrations fixture\n', 'utf8'),
    writeFile(join(workspacePath, '.pi', 'settings.json'), `${JSON.stringify({
      packages: [projectPackagePath],
      retry: { enabled: false },
    }, null, 2)}\n`, 'utf8'),
    writeFile(mcpPath, `// preserve this comment
{
  "mcpServers": {
    "docs": {
      "command": "node",
      "args": ["server.js"],
      "env": { "TOKEN": "!secret-command" },
      "future": { "keep": true }
    },
    "mux": { "socket": "/tmp/fixture-mux.sock" }
  },
  "futureTop": true
}
`, 'utf8'),
    writeFile(
      join(userDataPath, 'settings.json'),
      `${JSON.stringify({
        version: SETTINGS_SCHEMA_VERSION,
        settings: {
          ...DEFAULT_SETTINGS,
          locale: 'en-US',
        },
      }, null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      join(userDataPath, 'pi-managed-packages.json'),
      `${JSON.stringify({ version: 1, mcpOptedOut: true }, null, 2)}\n`,
      'utf8',
    ),
  ])
  const piFixture = await startPiSdkFixture({
    agentDir,
    globalPackages: [globalPackagePath],
    retryEnabled: true,
  })

  const electronApp = await electron.launch({
    args: [resolve(process.cwd())],
    env: {
      ...process.env,
      ...piFixture.env,
      PIPILOT_E2E_DISABLE_AUTO_RESTART: '1',
      PIPILOT_E2E_USER_DATA: userDataPath,
    },
  })

  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.setViewportSize({ width: 1280, height: 820 })

    await selectDirectory(electronApp, workspacePath)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.pipilot!.conversation.get()))
      .toMatchObject({ activeScope: { kind: 'project' } })
    const activeScope = await page.evaluate(() => window.pipilot!.conversation.get())
    if (activeScope.activeScope.kind !== 'project') {
      throw new Error('Expected the selected project scope.')
    }
    const projectScope = activeScope.activeScope
    await page.getByRole('button', { name: 'New project task', exact: true }).click()
    await expect(page.getByRole('button', {
      name: 'Current model Fake Chat, click to switch',
    })).toBeVisible({ timeout: 15_000 })

    const snapshots = await page.evaluate(async (scope) => ({
      global: await window.pipilot!.piIntegrations.load({ kind: 'global' }),
      project: await window.pipilot!.piIntegrations.load(scope),
    }), projectScope)
    expect(snapshots.global).toMatchObject({
      state: 'ready',
      executable: { version: '0.84.2' },
      packages: [expect.objectContaining({
        displayName: 'fixture-global-package',
        installedVersion: '1.2.3',
        source: globalPackagePath,
        sourceType: 'local',
        scope: 'global',
      })],
    })
    expect(snapshots.global.executable?.path).toMatch(
      /^(?:bundled|.*node_modules\/@earendil-works\/pi-coding-agent)$/u,
    )
    expect(snapshots.global.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'global-fixture-skill',
        kind: 'skill',
        scope: 'global',
        effectiveState: 'enabled',
        invocation: '/skill:global-fixture-skill',
      }),
      expect.objectContaining({
        label: 'global-fixture-prompt',
        kind: 'prompt',
        scope: 'global',
        effectiveState: 'enabled',
        invocation: '/global-fixture-prompt',
      }),
    ]))
    expect(snapshots.project).toMatchObject({
      state: 'ready',
      packages: [expect.objectContaining({
        displayName: 'fixture-project-package',
        installedVersion: '2.0.0',
        source: projectPackagePath,
        sourceType: 'local',
        scope: 'project',
      })],
      resources: expect.arrayContaining([
        expect.objectContaining({
          label: 'project-fixture-prompt',
          kind: 'prompt',
          scope: 'project',
          effectiveState: 'enabled',
        }),
        expect.objectContaining({
          label: 'global-fixture-skill',
          kind: 'skill',
          scope: 'global',
          effectiveState: 'inherited',
        }),
      ]),
      retry: {
        globalEnabled: true,
        effective: expect.objectContaining({ enabled: false }),
      },
    })

    const mutation = await page.evaluate(async ({ scope, source }) => {
      const phases: string[] = []
      const unsubscribe = window.pipilot!.piIntegrations.subscribe((operation) => {
        if (operation.kind === 'install') phases.push(operation.phase)
      })
      const result = await window.pipilot!.piIntegrations.install(scope, source)
      await new Promise((resolveWait) => window.setTimeout(resolveWait, 50))
      unsubscribe()
      return { phases, result }
    }, { scope: projectScope, source: addedPackagePath })
    expect(mutation.phases[0]).toBe('queued')
    expect(mutation.phases).toEqual(expect.arrayContaining([
      'running',
      'succeeded',
    ]))
    expect(mutation.phases).not.toContain('failed')
    expect(mutation.result.snapshot).toMatchObject({
      restartRequired: false,
    })
    expect(mutation.result.runtimeSync).toBe('synchronized')
    const addedPackage = mutation.result.snapshot.packages.find(
      (pkg) => pkg.displayName === 'fixture-added-package',
    )
    expect(addedPackage).toMatchObject({
      installedPath: addedPackagePath,
      scope: 'project',
      sourceType: 'local',
    })
    expect(resolve(workspacePath, '.pi', addedPackage!.source))
      .toBe(addedPackagePath)
    await expect.poll(async () => JSON.parse(
      await readFile(join(workspacePath, '.pi', 'settings.json'), 'utf8'),
    )).toMatchObject({
      packages: expect.arrayContaining([projectPackagePath, addedPackage!.source]),
    })

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const settingsNavigation = page.getByRole('region', { name: 'Settings', exact: true })
    await settingsNavigation.getByRole('button', { name: 'Integrations', exact: true }).click()
    await page.getByRole('button', { name: 'Current project', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Integrations', exact: true })).toBeVisible()
    await expect(page.getByText(/Pi 0\.84\.2/)).toBeVisible()
    await expect(page.getByText(
      'Package changes are saved but not confirmed loaded. Restart Pi to try again.',
    )).toHaveCount(0)
    const overview = page.getByRole('region', { name: 'Overview', exact: true })
    const packageSummary = overview.getByRole('button', { name: /Installed packages/u })
    const resourceSummary = overview.getByRole('button', { name: /Resolved resources/u })
    await expect(packageSummary).toContainText(String(mutation.result.snapshot.packages.length))
    await expect(resourceSummary).toContainText(String(mutation.result.snapshot.resources.length))
    await expect(overview.getByText('Themes', { exact: true })).toHaveCount(0)
    const runtimeSupport = page.getByRole('region', {
      name: 'Active runtime support',
      exact: true,
    })
    await expect(runtimeSupport.getByText(
      'No compatibility problems have been observed in the active Pi runtime.',
      { exact: true },
    )).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('integrations-overview-light.png'),
      fullPage: true,
    })
    await page.evaluate(() => window.pipilot!.settings.update({
      appearance: { theme: 'dark' },
    }))
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.classList.contains('dark')
    ))).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('integrations-overview-dark.png'),
      fullPage: true,
    })
    await page.evaluate(() => window.pipilot!.settings.update({
      appearance: { theme: 'light' },
    }))
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.classList.contains('dark')
    ))).toBe(false)

    const retrySettings = page.getByRole('region', {
      name: 'Automatic provider retry',
      exact: true,
    })
    const globalRetry = retrySettings.getByRole('switch', {
      name: 'Global persisted setting',
      exact: true,
    })
    await expect(globalRetry).toBeChecked()
    await expect(retrySettings.getByText(
      'A project override makes the effective value differ from the persisted global value.',
    )).toBeVisible()
    await globalRetry.click()
    await expect(globalRetry).not.toBeChecked()
    await expect(retrySettings.getByText(
      'Global setting saved and synchronized with the matching Pi process.',
    )).toBeVisible()
    await expect.poll(async () => JSON.parse(
      await readFile(join(agentDir, 'settings.json'), 'utf8'),
    )).toMatchObject({ retry: { enabled: false } })

    await page.getByRole('tab', { name: 'Packages', exact: true }).click()
    const packageRow = page.getByRole('button', {
      name: /fixture-project-package/,
    }).first()
    await expect(packageRow).toBeVisible()
    await packageRow.click()
    await expect(page.getByText('Installed version', { exact: true })).toBeVisible()
    await expect(page.getByRole('definition').filter({ hasText: /^2\.0\.0$/u }))
      .toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('integrations-wide.png'),
      fullPage: true,
    })

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1100, 680)
    })
    await page.setViewportSize({ width: 1100, height: 680 })
    await expect.poll(() => page.evaluate(() => (
      window.innerWidth === 1100 && window.innerHeight === 680
    ))).toBe(true)
    await page
      .getByRole('region', { name: 'Settings', exact: true })
      .getByRole('button', { name: 'Integrations', exact: true })
      .click()
    await expect(page.getByText('Installed version', { exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ))).toBe(true)
    await expect.poll(() => page.evaluate(() => (
      document.getAnimations().every((animation) => animation.playState !== 'running')
    ))).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('integrations-minimum-light.png'),
    })
    await page.evaluate(() => window.pipilot!.settings.update({
      appearance: { theme: 'dark' },
    }))
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.classList.contains('dark')
    ))).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('integrations-minimum-dark.png'),
    })
    await page.evaluate(() => window.pipilot!.settings.update({
      appearance: { theme: 'light' },
    }))
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.classList.contains('dark')
    ))).toBe(false)

    await page.setViewportSize({ width: 960, height: 700 })
    await expect(page.getByRole('button', { name: 'Back', exact: true }).last())
      .toBeVisible()
    await expect(packageRow).not.toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('integrations-narrow-detail.png'),
      fullPage: true,
    })
    await page.getByRole('button', { name: 'Back', exact: true }).last().click()
    await expect(page.getByRole('button', {
      name: /fixture-project-package/,
    }).first()).toBeVisible()

    await page.getByRole('tab', { name: 'Resources', exact: true }).click()
    await page.getByRole('button', { name: /project-fixture-skill/ }).click()
    await expect(page.getByText('/skill:project-fixture-skill', { exact: true }))
      .toBeVisible()
    await expect(page.getByText(
      "Resource state is read-only here. Use Pi's interactive `pi config` flow to change resource filters.",
      { exact: true },
    )).toBeVisible()
    await expect(page.getByRole('switch')).toHaveCount(0)

    await page.setViewportSize({ width: 1100, height: 680 })
    await page.getByRole('tab', { name: 'MCP', exact: true }).click()
    const docsEdit = page.getByRole('button', {
      name: 'Edit server docs',
      exact: true,
    })
    await expect(docsEdit).toBeVisible()
    await docsEdit.click()
    await page.screenshot({
      path: testInfo.outputPath('integrations-mcp-structured-minimum.png'),
    })
    await page.getByRole('button', { name: 'Streamable HTTP', exact: true }).click()
    const urlInput = page.getByLabel('URL', { exact: false })
    await expect(urlInput).toBeVisible()
    await page.getByRole('dialog').getByRole('button', {
      name: 'Save',
      exact: true,
    }).click()
    await expect(urlInput).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByText('URL is required.', { exact: true })).toBeVisible()
    await expect(page.getByText(/exactly one non-empty command/u)).toHaveCount(0)
    await urlInput.fill('https://example.test/mcp')
    await expect(page.getByText('URL is required.', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'stdio', exact: true }).click()
    await page.getByRole('dialog').getByRole('textbox', {
      name: 'Command',
      exact: true,
    }).fill('node-updated')
    await page.getByRole('dialog').getByRole('button', {
      name: 'Save',
      exact: true,
    }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText(
      'Configuration saved. Restart Pi when you are ready to apply it.',
    )).toBeVisible()
    await expect.poll(async () => readFile(mcpPath, 'utf8')).toContain('node-updated')
    const structuredSaved = await readFile(mcpPath, 'utf8')
    expect(structuredSaved).toContain('// preserve this comment')
    expect(structuredSaved).toMatch(/"future"\s*:\s*\{\s*"keep"\s*:\s*true\s*\}/u)
    expect(structuredSaved).toContain('"futureTop": true')

    await expect(page.getByRole('button', {
      name: 'Edit server mux',
      exact: true,
    })).toBeDisabled()
    await page.getByRole('button', { name: 'JSON', exact: true }).click()
    const rawEditor = page.locator('textarea').filter({ visible: true }).last()
    await page.screenshot({
      path: testInfo.outputPath('integrations-mcp-raw-minimum.png'),
    })
    const rawDraft = await rawEditor.inputValue()
    await rawEditor.fill(rawDraft.replace(
      '"futureTop": true',
      '"futureTop": true,\n  "rawRoundTrip": true',
    ))
    await page.getByRole('button', {
      name: 'Save and restart Pi',
      exact: true,
    }).click()
    await expect.poll(async () => readFile(mcpPath, 'utf8'))
      .toContain('"rawRoundTrip": true')
    await expect(page.getByText(
      'Configuration saved and Pi restarted.',
      { exact: true },
    )).toBeVisible()
    await expect.poll(() => page.evaluate(() => (
      window.pipilot!.localPi.runtime.status()
    ))).toMatchObject({ state: 'ready' })

    const restarted = await page.evaluate(
      (scope) => window.pipilot!.piIntegrations.restart(scope),
      projectScope,
    )
    expect(restarted).toMatchObject({
      runtimeSync: 'synchronized',
      snapshot: {
        state: 'ready',
        executable: { version: '0.84.2' },
        restartRequired: false,
      },
    })
  } finally {
    await electronApp.close()
    await piFixture.close()
  }
})
