import { execFile } from 'node:child_process'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron, expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { closeFixtureApplication } from './close-fixture-application'
import { startPiSdkFixture } from './pi-sdk-fixture'

const execute = promisify(execFile)
const git = async (cwd: string, args: string[]) => (await execute('git', args, { cwd })).stdout
const quotedNode = process.platform === 'win32' ? `"${process.execPath}"` : `'${process.execPath.replace(/'/gu, `'"'"'`)}'`
const composer = (page: Page) => page.getByRole('textbox', { name: 'Message input', exact: true })
const commandField = (dialog: Locator) => dialog.getByRole('textbox', { name: /^Command(?:\s|$)/u })
const snapshot = (page: Page, id: string) => page.evaluate((workspaceId) => window.pipilot!.projectWorkflows.get(workspaceId), id)

async function launch(testInfo: TestInfo) {
  const userData = testInfo.outputPath('user-data'), projectPath = testInfo.outputPath('Workflow project'), agentDir = testInfo.outputPath('pi-agent')
  await Promise.all([userData, join(projectPath, 'commands')].map((path) => mkdir(path, { recursive: true })))
  const project = await realpath(projectPath)
  await writeFile(join(project, 'tracked.txt'), 'original\n')
  await writeFile(join(project, '.gitignore'), 'ignored.bin\nsetup-output.txt\n')
  await writeFile(join(project, 'commands', '.gitkeep'), '')
  await writeFile(join(project, 'setup.cjs'), "require('node:fs').writeFileSync('setup-output.txt',process.cwd());console.log('SETUP_COMPLETE')")
  await writeFile(join(project, 'fixture-action.cjs'), [
    "const mode=process.argv[2];console.log('ACTION_MODE:'+mode);console.log('ACTION_CWD:'+process.cwd());console.error('ACTION_STDERR');",
    "console.log('LONG_OUTPUT:'+ 'x'.repeat(2000));",
    "if(mode==='hold'){console.log('ACTION_READY');setInterval(()=>{},1000)}",
  ].join('\n'))
  await git(project, ['init', '-b', 'main'])
  await git(project, ['add', '.'])
  await git(project, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Workflow fixture'])
  await writeFile(join(project, 'tracked.txt'), 'source checkout remains dirty\n')
  await writeFile(join(project, 'parent-only.txt'), 'source untracked file\n')
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, settings: {
    ...DEFAULT_SETTINGS, locale: 'en-US', notifications: { desktop: false, sound: false },
    appearance: { ...DEFAULT_SETTINGS.appearance, reducedMotion: true, theme: 'light' },
  } }))
  const fixture = await startPiSdkFixture({ agentDir })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: { ...process.env, ...fixture.env,
    PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1',
    ...(process.platform === 'win32' ? {} : { PIPILOT_E2E_TERMINAL_SHELL: '/bin/sh' }),
  } })
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
  await app.evaluate(({ dialog }, path) => { Object.defineProperty(dialog, 'showOpenDialog', {
    configurable: true, value: async () => ({ canceled: false, filePaths: [path] }),
  }) }, project)
  await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
  await expect(composer(page)).toBeEditable()
  const workspace = await page.evaluate(() => window.pipilot!.workspace.get())
  const projectId = workspace.recent.find((entry) => entry.name === basename(project))!.id
  return { app, page, fixture, project, projectId, agentDir, errors }
}

/** Settings › Local Environment, for the project it shows (the active one unless chosen). */
async function openLocalEnvironment(page: Page, projectId?: string) {
  if (!await page.locator('[data-local-environment]').isVisible()) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('region', { name: 'Settings', exact: true }).getByRole('button', { name: 'Local Environment', exact: true }).click()
  }
  const settings = page.locator('[data-local-environment]')
  if (projectId) await settings.getByRole('combobox', { name: 'Project', exact: true }).selectOption(projectId)
  await expect(settings.locator('[data-project-actions]')).toBeVisible()
  return settings
}

async function backToApp(page: Page) {
  await page.getByRole('button', { name: 'Back to app', exact: true }).click()
  await expect(page.locator('[data-local-environment]')).toBeHidden()
}

/** The action sheet: Add Action… or a row's Edit. */
async function editAction(page: Page, settings: Locator, name?: string) {
  if (name) await settings.getByRole('button', { name: `Edit ${name}`, exact: true }).click()
  else await settings.getByRole('button', { name: 'Add Action…', exact: true }).click()
  const sheet = page.locator('[data-project-action-sheet]')
  await expect(sheet).toBeVisible()
  return sheet
}

async function rowMenu(page: Page, settings: Locator, name: string, item: string) {
  await settings.getByRole('button', { name: `Actions for ${name}`, exact: true }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

/** Sidebar ⋯ › Archive Working Copy… then Archive; returns the confirmation for its outcome. */
async function archiveFromSidebar(page: Page, childName: string, taskName: string) {
  await page.getByRole('button', { name: `Project actions for ${childName}`, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Archive Working Copy…', exact: true }).click()
  const confirm = page.getByRole('alertdialog', { name: `Archive ${taskName}?`, exact: true })
  await confirm.getByRole('button', { name: 'Archive', exact: true }).click()
  return confirm
}

const output = (page: Page) => page.getByRole('region', { name: 'Command output', exact: true })
const runButton = (page: Page) => page.locator('[data-project-run]')

test('creates a managed branch with confirmed setup and preserves dirty files and official sessions through guarded archive and restore', async ({}, testInfo) => {
  test.setTimeout(150_000)
  const f = await launch(testInfo), { app, page, fixture, project, projectId, agentDir, errors } = f
  const taskName = 'Independent task', branch = 'feature/managed-workflow', childName = `${taskName} · ${branch}`
  try {
    const parentDirtyStatus = await git(project, ['status', '--porcelain'])
    let settings = await openLocalEnvironment(page)
    let sheet = await editAction(page, settings)
    await sheet.getByLabel('Action name', { exact: true }).fill('Fixture setup')
    await commandField(sheet).fill(`${quotedNode} setup.cjs`)
    await sheet.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await expect.poll(async () => (await snapshot(page, projectId)).actions[0]?.name).toBe('Fixture setup')
    await expect(settings.locator('[data-project-action="Fixture setup"]')).toBeVisible()
    await backToApp(page)

    // Project ⋯ › New Working Copy…: the branch follows the task name until it is edited.
    await page.getByRole('button', { name: `Project actions for ${basename(project)}`, exact: true }).click()
    await page.getByRole('menuitem', { name: 'New Working Copy…', exact: true }).click()
    sheet = page.locator('[data-new-worktree-sheet]')
    await expect(sheet.getByRole('status')).toHaveCount(0)
    await sheet.getByLabel('Task name', { exact: true }).fill(taskName)
    await expect(sheet.getByLabel('New branch', { exact: true })).toHaveValue('feature/independent-task')
    await sheet.getByLabel('New branch', { exact: true }).fill(branch)
    await sheet.getByRole('combobox', { name: /^Start from local branch/u }).selectOption('main')
    await sheet.getByRole('combobox', { name: /^Run setup after creation/u }).selectOption({ label: 'Fixture setup' })
    await expect(sheet).toContainText('Creating this working copy will also run this saved command:')
    await expect(sheet.locator('pre')).toContainText(`${quotedNode} setup.cjs`)
    await sheet.getByRole('button', { name: 'Create working copy', exact: true }).click()
    await expect(sheet).toHaveCount(0, { timeout: 15_000 })
    const created = (await snapshot(page, projectId)).worktrees[0]!
    expect(created).toMatchObject({ name: taskName, branch, baseBranch: 'main', state: 'active', projectId })
    // It opens as its own project, with the setup output in the bottom panel.
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.localPi.runtime.status()).cwd)).toBe(created.path)
    await expect(output(page)).toContainText('SETUP_COMPLETE', { timeout: 15_000 })
    await expect.poll(() => readFile(join(created.path, 'setup-output.txt'), 'utf8').catch(() => '')).toBe(created.path)
    await expect.poll(async () => (await snapshot(page, created.workspaceId!)).runs[0]?.status).toBe('completed')
    await expect(output(page)).toContainText('Completed · Exit code 0')
    await expect(page.locator(`[data-worktree-project="${branch}"]`)).toContainText(taskName)
    expect((await git(project, ['branch', '--show-current'])).trim()).toBe('main')
    expect((await git(created.path, ['branch', '--show-current'])).trim()).toBe(branch)
    expect(await readFile(join(created.path, 'tracked.txt'), 'utf8')).toBe('original\n')
    await expect(readFile(join(created.path, 'parent-only.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    await composer(page).fill('Persist managed working-copy conversation')
    await page.locator('[data-composer-submit]').click()
    await expect(page.getByRole('log', { name: 'Conversation', exact: true })).toContainText('Fixture response: Persist managed working-copy conversation')
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => window.pipilot!.localPi.runtime.command({ type: 'set_session_name', name: 'Managed conversation' }))).toMatchObject({ success: true })
    const sessionFile = (await page.evaluate(() => window.pipilot!.localPi.runtime.status())).sessionFile!
    expect(relative(await realpath(agentDir), sessionFile).startsWith('..')).toBe(false)
    await writeFile(join(created.path, 'tracked.txt'), 'staged content\n')
    await git(created.path, ['add', 'tracked.txt'])
    await writeFile(join(created.path, 'tracked.txt'), 'unstaged content\n')
    await writeFile(join(created.path, 'untracked.txt'), 'untracked bytes\n')
    const ignored = Buffer.from([0, 17, 255, 9]); await writeFile(join(created.path, 'ignored.bin'), ignored)
    const treeCommands = [['status', '--porcelain', '--ignored'], ['diff', '--cached', '--binary'], ['diff', '--binary']]
    const dirtyState = await Promise.all(treeCommands.map((args) => git(created.path, args)))
    let confirm = await archiveFromSidebar(page, childName, taskName)
    await expect(confirm.getByRole('alert')).toContainText('Switch to another project')
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()

    // The working copy keeps its own actions, copied from the source when it was made.
    settings = await openLocalEnvironment(page)
    await expect(settings.getByRole('combobox', { name: 'Project', exact: true })).toHaveValue(created.workspaceId!)
    await expect(settings).toContainText('Working copy of Workflow project')
    sheet = await editAction(page, settings, 'Fixture setup')
    await commandField(sheet).fill(`${quotedNode} fixture-action.cjs hold`)
    await sheet.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await expect.poll(async () => (await snapshot(page, created.workspaceId!)).actions[0]?.command).toContain(' hold')
    expect((await snapshot(page, projectId)).actions[0]?.command).toBe(`${quotedNode} setup.cjs`)
    await backToApp(page)
    await runButton(page).getByRole('button', { name: 'Run Fixture setup', exact: true }).click()
    await expect(output(page)).toContainText('ACTION_READY', { timeout: 15_000 })
    await expect(runButton(page)).toHaveAttribute('data-project-run', 'running')

    // A real PTY remains attached to the working copy while another project is selected.
    const terminalToggle = page.getByRole('button', { name: 'Terminal', exact: true })
    await terminalToggle.click()
    const drawer = page.locator('#workspace-terminal-drawer[data-terminal-drawer]')
    await expect(drawer.locator('[data-terminal-status="running"]')).toBeVisible()
    await drawer.getByRole('button', { name: 'Hide terminal (keep running)', exact: true }).click()
    await page.getByRole('button', { name: 'New task in Workflow project', exact: true }).click()
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.localPi.runtime.status()).cwd)).toBe(project)
    confirm = await archiveFromSidebar(page, childName, taskName)
    await expect(confirm.getByRole('alert')).toContainText('Stop the project action')
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await snapshot(page, projectId)).worktrees[0]?.state).toBe('active')
    // Settings shows any project's actions and working copies, so the action stops from there.
    settings = await openLocalEnvironment(page, created.workspaceId!)
    await expect(settings.locator('[data-project-action="Fixture setup"]')).toContainText('Running')
    await rowMenu(page, settings, 'Fixture setup', 'Stop')
    await expect.poll(async () => (await snapshot(page, created.workspaceId!)).runs[0]?.status).toBe('stopped')
    await rowMenu(page, settings, taskName, 'Archive…')
    confirm = page.getByRole('alertdialog', { name: `Archive ${taskName}?`, exact: true })
    await confirm.getByRole('button', { name: 'Archive', exact: true }).click()
    await expect(confirm.getByRole('alert')).toContainText('Close the project terminals')
    await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await snapshot(page, projectId)).worktrees[0]?.state).toBe('active')
    await backToApp(page)
    await page.getByRole('region', { name: 'Projects', exact: true }).getByRole('button', { name: 'Managed conversation', exact: true }).click()
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.localPi.runtime.status()).cwd)).toBe(created.path)
    if (await terminalToggle.getAttribute('aria-expanded') !== 'true') await terminalToggle.click()
    await drawer.getByRole('button', { name: 'More terminal actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'End and close terminal', exact: true }).click()
    await expect.poll(() => page.evaluate((workspaceId) => window.pipilot!.terminal.list({ kind: 'project', workspaceId }), created.workspaceId!)).toEqual([])
    if (await terminalToggle.getAttribute('aria-expanded') === 'true') await terminalToggle.click()
    await page.getByRole('button', { name: 'New task in Workflow project', exact: true }).click()
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.localPi.runtime.status()).cwd)).toBe(project)
    confirm = await archiveFromSidebar(page, childName, taskName)
    await expect(confirm).toHaveCount(0, { timeout: 15_000 })
    await expect.poll(async () => (await snapshot(page, projectId)).worktrees[0]?.state).toBe('archived')
    await expect(readFile(join(created.path, 'tracked.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(created.archivePath, 'tracked.txt'), 'utf8')).toBe('unstaged content\n')
    expect(await git(created.archivePath, ['worktree', 'list', '--porcelain'])).toContain('locked PiPilot archived working copy')
    expect(await readFile(sessionFile, 'utf8')).toContain('Persist managed working-copy conversation')
    await page.reload()
    await expect(composer(page)).toBeEditable()
    settings = await openLocalEnvironment(page)
    const row = settings.locator(`[data-worktree="${taskName}"]`)
    await expect(row).toHaveAttribute('data-worktree-state', 'archived')
    await rowMenu(page, settings, taskName, 'Restore')
    await expect(row).toHaveAttribute('data-worktree-state', 'active', { timeout: 15_000 })
    expect(await Promise.all(treeCommands.map((args) => git(created.path, args)))).toEqual(dirtyState)
    expect(await git(created.path, ['show', ':tracked.txt'])).toBe('staged content\n')
    expect(await readFile(join(created.path, 'untracked.txt'), 'utf8')).toBe('untracked bytes\n')
    expect(await readFile(join(created.path, 'ignored.bin'))).toEqual(ignored)
    expect(await readFile(sessionFile, 'utf8')).toContain('Persist managed working-copy conversation')
    expect((await git(project, ['branch', '--show-current'])).trim()).toBe('main')
    expect(await git(project, ['status', '--porcelain'])).toBe(parentDirtyStatus)
    await page.setViewportSize({ width: 1100, height: 800 })
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => window.pipilot!.settings.update({ appearance: { theme: value } }), theme)
      await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(theme === 'dark')
      await expect.poll(() => settings.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`working-copy-restored-1100-${theme}.png`) })
    }
    expect(errors).toEqual([])
  } finally { await closeFixtureApplication(app); await fixture.close() }
})

test('edits platform actions, keeps sheet edits on outside clicks, captures real output and stops a process without horizontal overflow at 1100px', async ({}, testInfo) => {
  test.setTimeout(100_000)
  const { app, page, fixture, project, projectId, errors } = await launch(testInfo)
  const platformLabel = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux'
  const platformKey = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
  try {
    // Without actions, ▶ only offers to add one.
    await runButton(page).click()
    await page.getByRole('menuitem', { name: 'Add Action…', exact: true }).click()
    let settings = page.locator('[data-local-environment]')
    await expect(settings.locator('[data-project-actions]')).toBeVisible()
    let sheet = await editAction(page, settings)
    const actionName = 'Development command with a deliberately descriptive name'
    await sheet.getByLabel('Action name', { exact: true }).fill(actionName)
    await commandField(sheet).fill(`${quotedNode} ../fixture-action.cjs fallback`)
    await sheet.getByLabel('Working directory', { exact: true }).fill('commands')
    await sheet.getByRole('button', { name: 'Per-platform commands', exact: true }).click()
    await sheet.getByLabel(platformLabel, { exact: true }).fill(`${quotedNode} ../fixture-action.cjs platform`)
    await page.mouse.click(8, 400)
    await expect(sheet).toBeVisible()
    await expect(commandField(sheet)).toHaveValue(`${quotedNode} ../fixture-action.cjs fallback`)
    await sheet.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await expect.poll(async () => (await snapshot(page, projectId)).actions[0]?.name).toBe(actionName)
    await backToApp(page)
    await runButton(page).getByRole('button', { name: `Run ${actionName}`, exact: true }).click()
    await expect(output(page)).toContainText('ACTION_MODE:platform', { timeout: 15_000 })
    await expect(output(page)).toContainText('ACTION_STDERR')
    await expect(output(page)).toContainText(`ACTION_CWD:${join(project, 'commands')}`)
    await expect(output(page)).toContainText('Completed · Exit code 0', { timeout: 15_000 })
    await page.reload()
    await expect(composer(page)).toBeEditable()
    // The run history survives a reload and reopens its output.
    await runButton(page).getByRole('button', { name: 'More actions', exact: true }).click()
    await page.locator('[data-project-run-history="completed"]').first().click()
    await expect(output(page)).toContainText('ACTION_STDERR')
    settings = await openLocalEnvironment(page)
    sheet = await editAction(page, settings, actionName)
    await expect(sheet.getByLabel('Action name', { exact: true })).toHaveValue(actionName)
    await expect(sheet.getByLabel(platformLabel, { exact: true })).toHaveValue(`${quotedNode} ../fixture-action.cjs platform`)
    await sheet.getByLabel(platformLabel, { exact: true }).fill(`${quotedNode} ../fixture-action.cjs hold`)
    await sheet.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(sheet).toHaveCount(0)
    await expect.poll(async () => (await snapshot(page, projectId)).actions[0]?.platforms[platformKey]).toContain(' hold')
    await backToApp(page)
    await runButton(page).getByRole('button', { name: `Run ${actionName}`, exact: true }).click()
    await expect(output(page)).toContainText('ACTION_READY', { timeout: 15_000 })
    await expect(runButton(page)).toHaveAttribute('data-project-run', 'running')
    await runButton(page).getByRole('button', { name: 'More actions', exact: true }).click()
    await expect(page.locator(`[data-project-run-action="${actionName}"]`)).toHaveAttribute('data-disabled', '')
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 1100, height: 800 })
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => window.pipilot!.settings.update({ appearance: { theme: value } }), theme)
      await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(theme === 'dark')
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
      await expect.poll(() => output(page).evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      const box = (await output(page).boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(1101)
      await page.screenshot({ path: testInfo.outputPath(`project-actions-1100-${theme}.png`) })
    }
    await output(page).getByRole('button', { name: 'Stop', exact: true }).click()
    await expect.poll(async () => (await snapshot(page, projectId)).runs[0]?.status, { timeout: 10_000 }).toBe('stopped')
    await expect(output(page).getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expect(output(page).getByRole('button', { name: 'Run Again', exact: true })).toBeEnabled()
    await expect(runButton(page)).toHaveAttribute('data-project-run', 'idle')
    expect(errors).toEqual([])
  } finally { await closeFixtureApplication(app); await fixture.close() }
})
