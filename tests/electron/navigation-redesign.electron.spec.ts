import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'

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
