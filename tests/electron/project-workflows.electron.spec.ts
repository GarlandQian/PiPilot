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
const workflows = (page: Page, name: string) => page.getByRole('dialog', { name, exact: true })
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
    ...DEFAULT_SETTINGS, locale: 'en-US', notifications: { desktop: false },
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

async function openTools(page: Page, name: string) {
  await page.getByRole('button', { name: `Project actions for ${name}`, exact: true }).click()
  await page.getByRole('menuitem', { name: 'Working copies & actions', exact: true }).click()
  const dialog = workflows(page, name)
  await expect(dialog.getByRole('status', { name: 'Loading project tools…' })).toHaveCount(0)
  await expect(dialog.getByRole('tab', { name: 'Working copies', exact: true })).toBeVisible()
  return dialog
}

test('creates a managed branch with confirmed setup and preserves dirty files and official sessions through guarded archive and restore', async ({}, testInfo) => {
  test.setTimeout(150_000)
  const f = await launch(testInfo), { app, page, fixture, project, projectId, agentDir, errors } = f
  const taskName = 'Independent task', branch = 'feature/managed-workflow', childName = `${taskName} · ${branch}`
  try {
    const parentDirtyStatus = await git(project, ['status', '--porcelain'])
    let dialog = await openTools(page, basename(project))
    await dialog.getByRole('tab', { name: 'Project actions', exact: true }).click()
    await dialog.getByRole('button', { name: 'Add action', exact: true }).click()
    await dialog.getByLabel('Action name', { exact: true }).fill('Fixture setup')
    await commandField(dialog).fill(`${quotedNode} setup.cjs`)
    await dialog.getByRole('button', { name: 'Save actions', exact: true }).click()
    await expect.poll(async () => (await snapshot(page, projectId)).actions[0]?.name).toBe('Fixture setup')
    await dialog.getByRole('tab', { name: 'Working copies', exact: true }).click()
    await dialog.getByLabel('Task name', { exact: true }).fill(taskName)
    await dialog.getByLabel('New branch', { exact: true }).fill(branch)
    await dialog.getByRole('combobox', { name: /^Start from local branch/u }).selectOption('main')
    await dialog.getByRole('combobox', { name: /^Run setup after creation/u }).selectOption({ label: 'Fixture setup' })
    await expect(dialog).toContainText('Creating this working copy will also run this saved command:')
    await expect(dialog.locator('pre')).toContainText(`${quotedNode} setup.cjs`)
    await dialog.getByRole('button', { name: 'Create working copy', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Start a task here', exact: true })).toBeVisible({ timeout: 15_000 })
    const created = (await snapshot(page, projectId)).worktrees[0]!
    expect(created).toMatchObject({ name: taskName, branch, baseBranch: 'main', state: 'active', projectId })
    await expect.poll(() => readFile(join(created.path, 'setup-output.txt'), 'utf8').catch(() => '')).toBe(created.path)
    await expect.poll(async () => (await snapshot(page, created.workspaceId!)).runs[0]?.status).toBe('completed')
    expect((await git(project, ['branch', '--show-current'])).trim()).toBe('main')
    expect((await git(created.path, ['branch', '--show-current'])).trim()).toBe(branch)
    expect(await readFile(join(created.path, 'tracked.txt'), 'utf8')).toBe('original\n')
    await expect(readFile(join(created.path, 'parent-only.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(dialog).toContainText(`Workflow project / ${branch}`)
    await dialog.getByRole('button', { name: 'Start a task here', exact: true }).click()
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.localPi.runtime.status()).cwd)).toBe(created.path)
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
    dialog = await openTools(page, childName)
    await dialog.getByRole('button', { name: 'Archive', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('Switch to another project')
    await dialog.getByRole('tab', { name: 'Project actions', exact: true }).click()
    await commandField(dialog).fill(`${quotedNode} fixture-action.cjs hold`)
    await dialog.getByRole('button', { name: 'Save actions', exact: true }).click()
    await expect.poll(async () => (await snapshot(page, created.workspaceId!)).actions[0]?.command).toContain(' hold')
    await dialog.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(dialog.getByLabel('Command output', { exact: true })).toContainText('ACTION_READY', { timeout: 15_000 })
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0)

    // A real PTY remains attached to the working copy while another project is selected.
    const terminalToggle = page.getByRole('button', { name: 'Terminal', exact: true })
    await terminalToggle.click()
    const drawer = page.locator('#workspace-terminal-drawer[data-terminal-drawer]')
    await expect(drawer.locator('[data-terminal-status="running"]')).toBeVisible()
    await drawer.getByRole('button', { name: 'Hide terminal (keep running)', exact: true }).click()
    await page.getByRole('button', { name: 'New session in Workflow project', exact: true }).click()
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.localPi.runtime.status()).cwd)).toBe(project)
    dialog = await openTools(page, childName)
    await dialog.getByRole('button', { name: 'Archive', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('Stop the project action')
    expect((await snapshot(page, projectId)).worktrees[0]?.state).toBe('active')
    await dialog.getByRole('tab', { name: 'Project actions', exact: true }).click()
    await dialog.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect.poll(async () => (await snapshot(page, created.workspaceId!)).runs[0]?.status).toBe('stopped')
    await dialog.getByRole('tab', { name: 'Working copies', exact: true }).click()
    await dialog.getByRole('button', { name: 'Archive', exact: true }).click()
    await expect(dialog.getByRole('alert')).toContainText('Close the project terminals')
    expect((await snapshot(page, projectId)).worktrees[0]?.state).toBe('active')
    await page.keyboard.press('Escape')
    await page.getByRole('region', { name: 'Projects', exact: true }).getByRole('button', { name: 'Managed conversation', exact: true }).click()
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.localPi.runtime.status()).cwd)).toBe(created.path)
    if (await terminalToggle.getAttribute('aria-expanded') !== 'true') await terminalToggle.click()
    await drawer.getByRole('button', { name: 'More terminal actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Close terminal', exact: true }).click()
    await expect.poll(() => page.evaluate((workspaceId) => window.pipilot!.terminal.list({ kind: 'project', workspaceId }), created.workspaceId!)).toEqual([])
    if (await terminalToggle.getAttribute('aria-expanded') === 'true') await terminalToggle.click()
    await page.getByRole('button', { name: 'New session in Workflow project', exact: true }).click()
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.localPi.runtime.status()).cwd)).toBe(project)
    dialog = await openTools(page, childName)
    await dialog.getByRole('button', { name: 'Archive', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Restore', exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(readFile(join(created.path, 'tracked.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(created.archivePath, 'tracked.txt'), 'utf8')).toBe('unstaged content\n')
    expect(await git(created.archivePath, ['worktree', 'list', '--porcelain'])).toContain('locked PiPilot archived working copy')
    expect(await readFile(sessionFile, 'utf8')).toContain('Persist managed working-copy conversation')
    await page.reload()
    await expect(composer(page)).toBeEditable()
    dialog = await openTools(page, basename(project))
    await expect(dialog.getByRole('button', { name: 'Restore', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Start a task here', exact: true })).toBeVisible({ timeout: 15_000 })
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
      await expect.poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`working-copy-restored-1100-${theme}.png`) })
    }
    expect(errors).toEqual([])
  } finally { await closeFixtureApplication(app); await fixture.close() }
})

test('edits platform actions, preserves unsaved edits, captures real output and stops a process without horizontal overflow at 1100px', async ({}, testInfo) => {
  test.setTimeout(100_000)
  const { app, page, fixture, project, projectId, errors } = await launch(testInfo)
  const platformLabel = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux'
  try {
    let dialog = await openTools(page, basename(project))
    await dialog.getByRole('tab', { name: 'Project actions', exact: true }).click()
    await dialog.getByRole('button', { name: 'Add action', exact: true }).click()
    const actionName = 'Development command with a deliberately descriptive name'
    await dialog.getByLabel('Action name', { exact: true }).fill(actionName)
    await commandField(dialog).fill(`${quotedNode} ../fixture-action.cjs fallback`)
    await dialog.getByLabel('Working directory (relative to project)', { exact: true }).fill('commands')
    await dialog.locator('summary').filter({ hasText: 'Platform overrides' }).click()
    await dialog.getByLabel(platformLabel, { exact: true }).fill(`${quotedNode} ../fixture-action.cjs platform`)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('alert')).toContainText('Save or discard action edits')
    await expect(commandField(dialog)).toHaveValue(`${quotedNode} ../fixture-action.cjs fallback`)
    await dialog.getByRole('button', { name: 'Save actions', exact: true }).click()
    await expect.poll(async () => (await snapshot(page, projectId)).actions[0]?.name).toBe(actionName)
    await dialog.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(dialog.getByLabel('Command output', { exact: true })).toContainText('ACTION_MODE:platform', { timeout: 15_000 })
    await expect(dialog.getByLabel('Command output', { exact: true })).toContainText('ACTION_STDERR')
    await expect(dialog.getByLabel('Command output', { exact: true })).toContainText(`ACTION_CWD:${join(project, 'commands')}`)
    await expect(dialog).toContainText('Completed · Exit code 0', { timeout: 15_000 })
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0)
    await page.reload()
    await expect(composer(page)).toBeEditable()
    dialog = await openTools(page, basename(project))
    await dialog.getByRole('tab', { name: 'Project actions', exact: true }).click()
    await expect(dialog.getByLabel('Action name', { exact: true })).toHaveValue(actionName)
    await dialog.locator('summary').filter({ hasText: 'Platform overrides' }).click()
    await expect(dialog.getByLabel(platformLabel, { exact: true })).toHaveValue(`${quotedNode} ../fixture-action.cjs platform`)
    await expect(dialog.getByLabel('Command output', { exact: true })).toContainText('ACTION_STDERR')
    await dialog.getByLabel(platformLabel, { exact: true }).fill(`${quotedNode} ../fixture-action.cjs hold`)
    await dialog.getByRole('button', { name: 'Save actions', exact: true }).click()
    await expect.poll(async () => (await snapshot(page, projectId)).actions[0]?.platforms[process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux']).toContain(' hold')
    await dialog.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(dialog.getByLabel('Command output', { exact: true })).toContainText('ACTION_READY', { timeout: 15_000 })
    await expect(dialog.getByRole('button', { name: 'Run', exact: true })).toBeDisabled()
    await page.setViewportSize({ width: 1100, height: 800 })
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => window.pipilot!.settings.update({ appearance: { theme: value } }), theme)
      await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(theme === 'dark')
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
      await expect.poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
      const box = (await dialog.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(1101)
      await page.screenshot({ path: testInfo.outputPath(`project-actions-1100-${theme}.png`) })
    }
    await dialog.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect.poll(async () => (await snapshot(page, projectId)).runs[0]?.status, { timeout: 10_000 }).toBe('stopped')
    await expect(dialog.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Run', exact: true })).toBeEnabled()
    expect(errors).toEqual([])
  } finally { await closeFixtureApplication(app); await fixture.close() }
})
