import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'
import { closeFixtureApplication } from './close-fixture-application'
import { installFixtureTrash } from './fixture-trash'

function taskRow(page: Page, name: string) {
  return page.locator('[data-session-list="project"]')
    .getByRole('button', { name, exact: true })
}

async function taskMenu(page: Page, name: string) {
  const row = taskRow(page, name)
  await row.hover()
  await row.locator('..').getByRole('button', { name: 'More actions', exact: true }).click()
}

async function addProject(app: ElectronApplication, page: Page, path: string) {
  await app.evaluate(({ dialog }, selectedPath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      writable: true,
      value: async () => ({ canceled: false, filePaths: [selectedPath] }),
    })
  }, path)
  await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
  await expect.poll(async () => {
    const runtime = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    return { cwd: runtime.cwd, state: runtime.state }
  }).toEqual({ cwd: path, state: 'ready' })
  await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat')
}

async function seedTask(page: Page, prompt: string, title: string) {
  await page.getByRole('textbox', { name: 'Message input', exact: true }).fill(prompt)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('log', { name: 'Conversation' }).getByText(
    `Fixture response: ${prompt}`, { exact: true },
  )).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  const result = await page.evaluate((name) => window.pipilot!.localPi.runtime.command({
    type: 'set_session_name', name,
  }), title)
  expect(result.success).toBe(true)
  await expect(taskRow(page, title)).toBeVisible()
  return page.evaluate(() => window.pipilot!.localPi.runtime.status())
}

test('restores an existing project task and persists pin/archive without deleting official sessions', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userDataPath = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const projectAPath = testInfo.outputPath('navigation-project-a')
  const projectBPath = testInfo.outputPath('navigation-project-b')
  await Promise.all([userDataPath, projectAPath, projectBPath].map((path) => mkdir(path, { recursive: true })))
  const [projectA, projectB] = await Promise.all([realpath(projectAPath), realpath(projectBPath)])
  await writeFile(join(userDataPath, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US' },
  }))
  const fixture = await startPiSdkFixture({ agentDir })
  let app: ElectronApplication | undefined

  try {
    app = await electron.launch({
      args: [resolve(process.cwd())],
      env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userDataPath },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })

    await addProject(app, page, projectA)
    const first = await seedTask(page, 'Keep the original archive needle', 'Remembered task')
    const scopeA = (await page.evaluate(() => window.pipilot!.conversation.get())).activeScope
    await page.getByRole('button', { name: `New session in ${basename(projectA)}`, exact: true }).click()
    await seedTask(page, 'A newer task remains available', 'Newer task')
    await taskRow(page, 'Remembered task').click()
    await expect.poll(async () => (await page.evaluate(() => window.pipilot!.localPi.runtime.status()))
      .sessionState?.sessionId).toBe(first.sessionState!.sessionId)
    const originalCatalog = await page.evaluate((scope) => window.pipilot!.sessionCatalog.list(scope), scopeA)
    expect(originalCatalog.rows).toHaveLength(2)

    await addProject(app, page, projectB)
    await seedTask(page, 'Keep another project selected', 'Other project task')
    await page.getByRole('button', { name: `Resume a task in ${basename(projectA)}`, exact: true }).click()
    await expect.poll(async () => (await page.evaluate(() => window.pipilot!.localPi.runtime.status()))
      .sessionState?.sessionId).toBe(first.sessionState!.sessionId)
    const resumedCatalog = await page.evaluate((scope) => window.pipilot!.sessionCatalog.list(scope), scopeA)
    expect(resumedCatalog.rows.map((row) => row.sessionId).sort())
      .toEqual(originalCatalog.rows.map((row) => row.sessionId).sort())

    await taskMenu(page, 'Remembered task')
    await page.getByRole('menuitem', { name: 'Pin task', exact: true }).click()
    await taskRow(page, 'Newer task').click()
    await taskMenu(page, 'Remembered task')
    await page.getByRole('menuitem', { name: 'Archive task', exact: true }).click()
    await expect(taskRow(page, 'Remembered task')).toHaveCount(0)
    await expect(page.locator('[data-session-list="focus"]').getByRole('button', {
      name: 'Remembered task', exact: true,
    })).toHaveCount(0)

    // Renderer reload preserves organization and the remembered project expansion.
    await page.getByRole('button', { name: `Collapse project ${basename(projectB)}`, exact: true }).click()
    await page.reload()
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await expect(taskRow(page, 'Newer task')).toBeVisible()
    await expect(page.getByText('Loading general chats…', { exact: true })).toHaveCount(0)
    await expect(taskRow(page, 'Remembered task')).toHaveCount(0)
    await expect(page.getByRole('button', { name: `Expand project ${basename(projectB)}`, exact: true }))
      .toHaveAttribute('aria-expanded', 'false')

    await page.getByRole('textbox', { name: 'Search sessions', exact: true }).fill('archive needle')
    await expect(taskRow(page, 'Remembered task')).toBeVisible()
    await taskMenu(page, 'Remembered task')
    await expect(page.getByRole('menuitem', { name: 'Unpin task', exact: true })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Restore task', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('textbox', { name: 'Search sessions', exact: true }).fill('')
    await page.getByRole('button', { name: 'Archived tasks', exact: true }).click()
    await expect(taskRow(page, 'Remembered task')).toBeVisible()
    await taskRow(page, 'Remembered task').click()
    await expect.poll(async () => (await page.evaluate(() => window.pipilot!.localPi.runtime.status()))
      .sessionState?.sessionId).toBe(first.sessionState!.sessionId)
    await taskMenu(page, 'Remembered task')
    await page.getByRole('menuitem', { name: 'Restore task', exact: true }).click()
    await expect(taskRow(page, 'Remembered task')).toHaveCount(0)
    await page.getByRole('button', { name: 'Archived tasks', exact: true }).click()
    await expect(taskRow(page, 'Remembered task')).toHaveAttribute('aria-current', 'page')

    // The task occurs in both Focus and its project, but rename owns one input.
    await taskMenu(page, 'Remembered task')
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
    const rename = page.getByRole('textbox', { name: 'Rename session', exact: true })
    await expect(rename).toHaveCount(1)
    await rename.fill('Restored pinned task')
    await rename.press('Enter')
    await expect(taskRow(page, 'Restored pinned task')).toBeVisible()
    await taskMenu(page, 'Restored pinned task')
    await expect(page.getByRole('menuitem', { name: 'Unpin task', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    const finalCatalog = await page.evaluate((scope) => window.pipilot!.sessionCatalog.list(scope), scopeA)
    expect(finalCatalog.rows.map((row) => row.sessionId).sort())
      .toEqual(originalCatalog.rows.map((row) => row.sessionId).sort())
    await page.screenshot({ path: testInfo.outputPath('navigation-restored-and-pinned.png') })
  } finally {
    await app?.close()
    await fixture.close()
  }
})

test('deletes the named background task while preserving the active task, then clears an explicitly deleted active task', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userDataPath = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const projectPath = testInfo.outputPath('deletion-project')
  await Promise.all([userDataPath, projectPath].map((path) => mkdir(path, { recursive: true })))
  const project = await realpath(projectPath)
  const fixtureRoot = await realpath(testInfo.outputPath())
  await writeFile(join(userDataPath, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US' },
  }))
  const fixture = await startPiSdkFixture({ agentDir })
  let app: ElectronApplication | undefined
  try {
    app = await electron.launch({
      args: [resolve(process.cwd())],
      env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userDataPath },
    })
    const fixtureTrash = await installFixtureTrash(app, testInfo)
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.waitForLoadState('domcontentloaded')
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await addProject(app, page, project)
    const first = await seedTask(page, 'The background A transcript', 'Background task A')
    await page.getByRole('button', { name: `New session in ${basename(project)}`, exact: true }).click()
    const second = await seedTask(page, 'The active B transcript must survive', 'Active task B')
    const scope = (await page.evaluate(() => window.pipilot!.conversation.get())).activeScope
    if (!first.sessionFile || !second.sessionFile) throw new Error('The isolated tasks did not persist their session files.')
    const files = await Promise.all([first.sessionFile, second.sessionFile].map((path) => realpath(path)))
    for (const file of files) {
      const ownedPath = relative(fixtureRoot, file)
      expect(ownedPath).not.toMatch(/^\.\.(?:[\\/]|$)/)
      expect(isAbsolute(ownedPath)).toBe(false)
      expect(file).toMatch(/\.jsonl$/)
    }
    const [firstContents, secondContents] = await Promise.all(files.map((file) => readFile(file, 'utf8')))
    const composer = page.getByRole('textbox', { name: 'Message input', exact: true })
    const conversation = page.getByRole('log', { name: 'Conversation' })
    await composer.fill('Keep the active B draft')
    await expect(taskRow(page, 'Active task B')).toHaveAttribute('aria-current', 'page')
    await taskMenu(page, 'Background task A')
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Delete session?', exact: true })
    await expect(dialog).toContainText('Delete "Background task A"?')
    await expect(dialog).not.toContainText('This is the active session')
    expect((await page.evaluate(() => window.pipilot!.localPi.runtime.status())).sessionFile).toBe(second.sessionFile)
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(taskRow(page, 'Background task A')).toHaveCount(0)
    await expect(taskRow(page, 'Active task B')).toHaveAttribute('aria-current', 'page')
    await expect(composer).toHaveText('Keep the active B draft')
    await expect(conversation.getByText('Fixture response: The active B transcript must survive', { exact: true })).toBeVisible()
    const afterBackgroundDeletion = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    expect(afterBackgroundDeletion).toMatchObject({
      generation: second.generation,
      state: 'ready',
      sessionFile: second.sessionFile,
      sessionState: { sessionId: second.sessionState!.sessionId },
    })
    expect(await readFile(files[1], 'utf8')).toBe(secondContents)
    await expect(access(files[0])).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(fixtureTrash, basename(files[0])), 'utf8')).toBe(firstContents)
    await expect.poll(async () => (await page.evaluate((scope) => window.pipilot!.sessionCatalog.list(scope), scope)).rows.map(({ name }) => name))
      .toEqual(['Active task B'])

    // Delete the active row separately: only this action may clear its transcript.
    await taskMenu(page, 'Active task B')
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    await expect(dialog).toContainText('Delete "Active task B"?')
    await expect(dialog).toContainText('This is the active session')
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(dialog).toBeHidden()
    await expect(taskRow(page, 'Active task B')).toHaveCount(0)
    await expect(page.locator('[data-conversation-welcome]')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start writing', exact: true })).toBeVisible()
    await expect(conversation.getByText('Fixture response: The active B transcript must survive', { exact: true })).toHaveCount(0)
    await expect.poll(async () => (await page.evaluate(() => window.pipilot!.localPi.runtime.status())).sessionFile).toBeNull()
    await expect.poll(async () => (await page.evaluate((scope) => window.pipilot!.sessionCatalog.list(scope), scope)).rows).toEqual([])
    await expect(access(files[1])).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(fixtureTrash, basename(files[1])), 'utf8')).toBe(secondContents)
    expect(errors).toEqual([])
  } finally {
    if (app) await closeFixtureApplication(app)
    await fixture.close()
  }
})
