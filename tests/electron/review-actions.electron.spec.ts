import { execFile } from 'node:child_process'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'
import { closeFixtureApplication } from './close-fixture-application'
import { selectInspectorView } from './select-inspector-view'

const run = promisify(execFile)
const git = (cwd: string, args: string[]) => run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd })

test('stages, unstages and discards from the review, file by file and hunk by hunk', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userData = testInfo.outputPath('user-data')
  const projectPath = testInfo.outputPath('Review project')
  await mkdir(userData, { recursive: true })
  await mkdir(projectPath, { recursive: true })
  const lines = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`)
  await writeFile(join(projectPath, 'a.txt'), 'alpha\n')
  await writeFile(join(projectPath, 'b.txt'), 'bravo\n')
  await writeFile(join(projectPath, 'long.txt'), `${lines.join('\n')}\n`)
  await git(projectPath, ['init', '-q', '-b', 'main'])
  await git(projectPath, ['add', '.'])
  await git(projectPath, ['commit', '-qm', 'Fixture'])
  await writeFile(join(projectPath, 'a.txt'), 'alpha edited\n')
  await writeFile(join(projectPath, 'b.txt'), 'bravo edited\n')
  const edited = [...lines]
  edited[1] = 'line 2 edited'
  edited[26] = 'line 27 edited'
  await writeFile(join(projectPath, 'long.txt'), `${edited.join('\n')}\n`)
  const project = await realpath(projectPath)
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, settings: {
    ...DEFAULT_SETTINGS, locale: 'en-US', appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true },
  } }))
  const fixture = await startPiSdkFixture({ agentDir: testInfo.outputPath('pi-agent') })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: {
    ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1',
  } })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await app.evaluate(({ dialog }, directory) => {
      Object.defineProperty(dialog, 'showOpenDialog', { configurable: true, value: async () => ({ canceled: false, filePaths: [directory] }) })
    }, project)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
    const inspector = page.getByRole('complementary', { name: 'Inspector', exact: true })
    await selectInspectorView(page, 'Review')
    const section = (id: string) => inspector.locator(`[data-diff-id="${id}"]`)
    const scope = inspector.getByRole('button', { name: 'Review scope', exact: true })
    const showScope = async (name: RegExp) => {
      await scope.click()
      await page.getByRole('menuitemradio', { name }).click()
    }
    // Codex opens on the unstaged changes.
    await expect(scope).toHaveAttribute('data-diff-scope', 'unstaged')
    await expect(section('unstaged:a.txt')).toBeVisible()

    // File-level: stage, then unstage from the Staged scope.
    await section('unstaged:a.txt').getByRole('button', { name: 'Stage file', exact: true }).click()
    await expect(section('unstaged:a.txt')).toHaveCount(0)
    await showScope(/^Staged/)
    await expect(scope).toHaveAttribute('data-diff-scope', 'staged')
    await expect(inspector.locator('[data-diff-id]')).toHaveCount(1)
    await section('staged:a.txt').getByRole('button', { name: 'Unstage file', exact: true }).click()
    await expect(inspector.getByText('Nothing staged yet', { exact: true })).toBeVisible()
    await showScope(/^Unstaged/)
    await expect(section('unstaged:a.txt')).toBeVisible()

    // Discard asks first, then restores the committed text.
    await section('unstaged:b.txt').getByRole('button', { name: 'Discard changes', exact: true }).click()
    const confirm = page.getByRole('alertdialog', { name: 'Discard changes to “b.txt”?', exact: true })
    await confirm.getByRole('button', { name: 'Discard', exact: true }).click()
    await expect(section('unstaged:b.txt')).toHaveCount(0)
    expect(await readFile(join(project, 'b.txt'), 'utf8')).toBe('bravo\n')

    // Hunk-level: stage only the second edit of long.txt, from its "Line N" row.
    const long = section('unstaged:long.txt')
    await long.scrollIntoViewIfNeeded()
    await expect(long.locator('[data-diff-hunk-actions]')).toHaveCount(2)
    await expect(long.locator('[data-diff-hunk-actions]').nth(1)).toContainText('Line 27')
    await long.locator('[data-diff-hunk-actions]').nth(1).getByRole('button', { name: 'Stage hunk', exact: true }).click()
    await expect.poll(async () => (await git(project, ['diff', '--cached'])).stdout).toContain('+line 27 edited')
    const staged = (await git(project, ['diff', '--cached'])).stdout
    expect(staged).toContain('+line 27 edited')
    expect(staged).not.toContain('+line 2 edited')
    await showScope(/^Staged/)
    await expect(section('staged:long.txt')).toBeVisible()

    // Branch: on main there is nothing to compare with.
    await showScope(/^Branch/)
    await expect(inspector.getByText('There is no default branch (such as main or origin/main) to compare with.', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('review-actions.png'), animations: 'disabled' })
    expect(errors).toEqual([])
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
