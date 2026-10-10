import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { SUPPORTED_PI_VERSION } from '../../src/shared/local-pi'
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
  const mcpPath = join(workspacePath, '.pi', 'mcp.json')
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
    writeFile(mcpPath, `{
  "mcpServers": {
    "docs": {
      "command": "node",
      "args": ["server.js"],
      "env": { "TOKEN": "fixture-only" },
      "enabled": false,
      "future": { "keep": true }
    },
    "mux": { "url": "https://example.test/mcp", "enabled": false }
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
    await page.getByRole('region', { name: 'Projects', exact: true })
      .getByRole('button', { name: 'New task in workspace', exact: true }).click()
    await expect(page.getByRole('button', {
      name: 'Current model Fake Chat, click to switch',
    })).toBeVisible({ timeout: 15_000 })

    const snapshots = await page.evaluate(async (scope) => {
      try {
        return {
          global: await window.pipilot!.piIntegrations.load({ kind: 'global' }),
          project: await window.pipilot!.piIntegrations.load(scope),
        }
      } catch (error) {
        throw new Error(JSON.stringify(error))
      }
    }, projectScope)
    expect(snapshots.global).toMatchObject({
      state: 'ready',
      executable: { version: SUPPORTED_PI_VERSION },
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
    // Packages: global and project packages in one list; project ones are marked.
    await settingsNavigation.getByRole('button', { name: 'Packages', exact: true }).click()
    const packagesPane = page.getByRole('main', { name: 'Packages', exact: true })
    await expect(packagesPane.getByRole('region', { name: 'Installed', exact: true })).toBeVisible()
    await expect(page.getByText(
      'Package changes are saved but not confirmed loaded. Apply changes to try again.',
    )).toHaveCount(0)
    const packageRows = packagesPane.locator('[data-integration-row]')
    await expect(packageRows).toHaveCount(3)
    await expect(packagesPane.locator('[data-package-scope="global"]')).toContainText('fixture-global-package')
    const projectPackageRow = packagesPane.locator('[data-package-scope="project"]').filter({ hasText: 'fixture-project-package' })
    await expect(projectPackageRow).toContainText('Project')
    await expect(projectPackageRow).toContainText('v2.0.0')
    await page.screenshot({
      path: testInfo.outputPath('integrations-packages-light.png'),
      fullPage: true,
    })
    await page.evaluate(() => window.pipilot!.settings.update({
      appearance: { theme: 'dark' },
    }))
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.classList.contains('dark')
    ))).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('integrations-packages-dark.png'),
      fullPage: true,
    })
    await page.evaluate(() => window.pipilot!.settings.update({
      appearance: { theme: 'light' },
    }))
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.classList.contains('dark')
    ))).toBe(false)

    // Retrying failed requests now lives with the models; it changes the global value.
    await settingsNavigation.getByRole('button', { name: 'Models', exact: true }).click()
    const modelsPane = page.getByRole('main', { name: 'Models', exact: true })
    const globalRetry = modelsPane.getByRole('switch', { name: 'Retry failed requests', exact: true })
    await expect(globalRetry).toBeChecked()
    await expect(modelsPane.getByText(
      'A project override makes the effective value differ from the persisted global value.',
    )).toBeVisible()
    await globalRetry.click()
    await expect(globalRetry).not.toBeChecked()
    await expect.poll(async () => JSON.parse(
      await readFile(join(agentDir, 'settings.json'), 'utf8'),
    )).toMatchObject({ retry: { enabled: false } })

    // A package opens as a page of its own.
    await settingsNavigation.getByRole('button', { name: 'Packages', exact: true }).click()
    await projectPackageRow.locator('[data-settings-row-action]').click()
    const packageDetail = packagesPane.locator('[data-package-detail]')
    await expect(packageDetail).toContainText('fixture-project-package')
    await expect(packageDetail.locator('[data-settings-row]').filter({ hasText: 'Installed version' })).toContainText('2.0.0')
    await expect(page.locator('[data-settings-subpage-back]')).toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('integrations-wide.png'),
      fullPage: true,
    })

    // Its skills open the resources pane, narrowed to this package.
    await packageDetail.getByRole('button', { name: 'Skills', exact: true }).click()
    const resourcesPane = page.getByRole('main', { name: 'Skills & Resources', exact: true })
    await expect(resourcesPane.getByText('Resources from fixture-project-package', { exact: true })).toBeVisible()
    await expect(resourcesPane.locator('[data-integration-row]').filter({ hasText: 'global-fixture-skill' })).toHaveCount(0)
    const resourceSearch = resourcesPane.getByRole('searchbox', { name: 'Search skills and resources', exact: true })
    await resourceSearch.fill('/skill:project-fixture-skill')
    await expect(resourcesPane.locator('[data-integration-row]')).toHaveCount(1)
    await resourcesPane.getByRole('button', { name: 'Show all resources', exact: true }).click()
    await resourceSearch.fill('')
    await expect(resourcesPane.locator('[data-integration-row]').filter({ hasText: 'global-fixture-skill' })).toHaveCount(1)

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1100, 680)
    })
    await page.setViewportSize({ width: 1100, height: 680 })
    await expect.poll(() => page.evaluate(() => (
      window.innerWidth === 1100 && window.innerHeight === 680
    ))).toBe(true)
    await settingsNavigation.getByRole('button', { name: 'Packages', exact: true }).click()
    await expect(packageDetail).toBeVisible()
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
    await page.locator('[data-settings-subpage-back]').click()
    await expect(projectPackageRow).toBeVisible()

    // A resource shows its details in a sheet; its state is read-only here.
    await settingsNavigation.getByRole('button', { name: 'Skills & Resources', exact: true }).click()
    await resourcesPane.locator('[data-integration-row]').filter({ hasText: 'project-fixture-skill' }).locator('[data-settings-row-action]').click()
    const resourceSheet = page.locator('[data-resource-sheet]')
    await expect(resourceSheet.getByText('/skill:project-fixture-skill', { exact: true })).toBeVisible()
    await expect(resourceSheet.getByRole('switch')).toHaveCount(0)
    await resourceSheet.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(resourcesPane.getByText(
      "Resource state is read-only here. Use Pi's interactive `pi config` flow to change resource filters.",
      { exact: true },
    )).toBeVisible()

    // MCP servers: the project file's servers, edited on a page of their own.
    await settingsNavigation.getByRole('button', { name: 'MCP Servers', exact: true }).click()
    const mcpPane = page.getByRole('main', { name: 'MCP Servers', exact: true })
    await expect(mcpPane.locator('[data-mcp-server]')).toHaveCount(2)
    await expect(mcpPane.locator('[data-mcp-server="mux"]')).toHaveAttribute('data-mcp-scope', 'project')
    await expect(mcpPane.locator('[data-mcp-server="mux"]')).toContainText('https://example.test/mcp')
    await expect(mcpPane).not.toContainText('fixture-only')
    await mcpPane.getByRole('button', { name: 'Edit docs', exact: true }).click()
    const editor = mcpPane.locator('[data-mcp-server-editor="docs"]')
    await expect(page.locator('[data-settings-subpage-back]')).toBeVisible()
    await expect(editor.getByRole('textbox', { name: 'Server name', exact: true })).toBeDisabled()
    await page.screenshot({ path: testInfo.outputPath('integrations-mcp-structured-minimum.png') })
    await editor.getByRole('radio', { name: 'Online service', exact: true }).click()
    const urlInput = editor.getByRole('textbox', { name: 'URL', exact: true })
    await expect(urlInput).toBeVisible()
    const footer = mcpPane.locator('[data-settings-actions]')
    await footer.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(urlInput).toHaveAttribute('aria-invalid', 'true')
    await expect(editor.getByText('URL is required.', { exact: true })).toBeVisible()
    await expect(editor.getByText(/exactly one non-empty command/u)).toHaveCount(0)
    await urlInput.fill('https://example.test/mcp')
    await expect(editor.getByText('URL is required.', { exact: true })).toHaveCount(0)
    // Back to a program: what it had is still there.
    await editor.getByRole('radio', { name: 'Program on this computer', exact: true }).click()
    await expect(editor.getByRole('textbox', { name: 'Command', exact: true })).toHaveValue('node')
    await expect(editor.getByRole('textbox', { name: 'Arguments', exact: true })).toHaveValue('server.js')
    await editor.getByRole('textbox', { name: 'Command', exact: true }).fill('node-updated')
    await footer.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(mcpPane.locator('[data-mcp-server-list]')).toBeVisible()
    await expect(page.locator('[data-settings-subpage-back]')).toHaveCount(0)
    await expect.poll(async () => readFile(mcpPath, 'utf8')).toContain('node-updated')
    const structuredSaved = await readFile(mcpPath, 'utf8')
    expect(JSON.parse(structuredSaved).mcpServers.docs).toEqual({ command: 'node-updated', args: ['server.js'], env: { TOKEN: 'fixture-only' }, enabled: false, future: { keep: true } })
    expect(structuredSaved).toContain('"futureTop": true')

    // The whole file stays editable for what the pages do not show.
    await mcpPane.locator('[data-mcp-server-list] header').getByRole('button', { name: 'More', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Edit project mcp.json…', exact: true }).click()
    const rawEditor = mcpPane.getByRole('textbox', { name: 'mcp.json', exact: true })
    await page.screenshot({ path: testInfo.outputPath('integrations-mcp-raw-minimum.png') })
    const rawDraft = await rawEditor.inputValue()
    await rawEditor.fill(rawDraft.replace('"futureTop": true', '"futureTop": true,\n  "rawRoundTrip": true'))
    await mcpPane.locator('[data-settings-actions]').getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(async () => readFile(mcpPath, 'utf8')).toContain('"rawRoundTrip": true')
    await expect(page.getByRole('status').filter({ hasText: 'Saved configuration is applied.' })).toBeVisible()
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
        executable: { version: SUPPORTED_PI_VERSION },
        restartRequired: false,
      },
    })
  } finally {
    await electronApp.close()
    await piFixture.close()
  }
})
