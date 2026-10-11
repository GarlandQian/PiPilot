import { execFile } from 'node:child_process'
import { chmod, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { closeFixtureApplication } from './close-fixture-application'
import { startPiSdkFixture } from './pi-sdk-fixture'

const git = promisify(execFile)
const check = (name: string, conclusion: string, url: string) => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion, detailsUrl: url })
const pr = (number: number, title: string, author: string, branch: string, checks: object[]) => ({
  number, title, url: `https://github.com/octo/shop/pull/${number}`, author: { login: author }, headRefName: branch, baseRefName: 'main',
  isDraft: false, updatedAt: `2026-10-0${number - 5}T00:00:00Z`, reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: checks, isCrossRepository: false,
})
const MINE = pr(7, 'Speed up checkout', 'octocat', 'speed', [check('test', 'SUCCESS', 'https://github.com/octo/shop/actions/runs/100/job/1')])
const REQUESTED = pr(8, 'Fix the cart total', 'hubot', 'fix-cart', [check('lint', 'SUCCESS', 'https://github.com/octo/shop/actions/runs/123/job/455'), check('test', 'FAILURE', 'https://github.com/octo/shop/actions/runs/123/job/456')])

// A stand-in for GitHub CLI: canned answers, and a log of what was asked.
function fakeGh(log: string) {
  const json = (value: unknown) => JSON.stringify(JSON.stringify(value))
  return `#!/bin/sh
echo "$*" >> ${JSON.stringify(log)}
case "$*" in
  "--version") echo "gh version 2.60.0" ;;
  "api user --jq .login") echo octocat ;;
  "repo view --json nameWithOwner") echo '{"nameWithOwner":"octo/shop"}' ;;
  *"pr list"*"--author @me"*) printf '%s' ${json([MINE])} ;;
  *"pr list"*"review-requested:@me"*) printf '%s' ${json([REQUESTED])} ;;
  *"pr list"*) printf '%s' ${json([MINE, REQUESTED])} ;;
  *"pr view 8"*) printf '%s' ${json({ ...REQUESTED, body: 'The total ignores discounts.', reviews: [], reviewRequests: [{ login: 'octocat' }] })} ;;
  *"pr view 7"*) printf '%s' ${json({ ...MINE, body: '', reviews: [], reviewRequests: [] })} ;;
  *"pr review 8"*) ;;
  *"run view 123 --job 456 --log-failed"*) printf 'test\\tFAIL src/cart.test.ts\\ntest\\tExpected total 90, received 100\\n' ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`
}

test('lists pull requests through gh, submits a confirmed review, and fixes failing checks in a working copy', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const userData = testInfo.outputPath('user-data'), agentDir = testInfo.outputPath('pi-agent'), bin = testInfo.outputPath('bin')
  const projectPath = testInfo.outputPath('Shop'), origin = testInfo.outputPath('origin.git'), log = testInfo.outputPath('gh.log')
  await Promise.all([userData, bin, projectPath].map((path) => mkdir(path, { recursive: true })))
  await writeFile(join(bin, 'gh'), fakeGh(log))
  await chmod(join(bin, 'gh'), 0o755)
  const run = (cwd: string, ...args: string[]) => git('git', args, { cwd })
  await run(testInfo.outputPath(), 'init', '--bare', '-b', 'main', origin)
  await run(projectPath, 'init', '-b', 'main')
  await run(projectPath, 'config', 'user.email', 'pipilot@example.invalid')
  await run(projectPath, 'config', 'user.name', 'PiPilot fixture')
  await writeFile(join(projectPath, 'cart.ts'), 'export const total = (items: number[]) => items.reduce((a, b) => a + b, 0)\n')
  await run(projectPath, 'add', '.')
  await run(projectPath, 'commit', '-m', 'cart')
  await run(projectPath, 'remote', 'add', 'origin', origin)
  await run(projectPath, 'push', 'origin', 'main', 'main:fix-cart')
  const project = await realpath(projectPath)
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, settings: {
    ...DEFAULT_SETTINGS, locale: 'en-US', notifications: { desktop: false, sound: false } } }))
  const fixture = await startPiSdkFixture({ agentDir })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: {
    ...process.env, ...fixture.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' } })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await app.evaluate(({ dialog }, directory) => { Object.defineProperty(dialog, 'showOpenDialog', { configurable: true, value: async () => ({ canceled: false, filePaths: [directory] }) }) }, project)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).first().click()
    await expect(page.getByRole('textbox', { name: 'Message input', exact: true })).toBeEditable({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Expand panel', exact: true }).click()
    await page.getByRole('button', { name: 'New tab', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Pull Requests', exact: true }).click()

    const panel = page.locator('[data-pull-requests]')
    await expect(panel.locator('[data-pull-request]')).toHaveCount(2, { timeout: 20_000 })
    await expect(panel.locator('[data-pull-request="8"]')).toContainText('review requested')
    await expect(panel.locator('[data-pull-request="8"] [data-pull-request-checks="failing"]')).toBeVisible()

    // A review is posted only after confirming who it is posted as.
    await panel.locator('[data-pull-request="8"]').click()
    const detail = panel.locator('[data-pull-request-detail="8"]')
    await expect(detail.locator('[data-check-state="failing"]')).toContainText('test')
    await detail.getByRole('button', { name: 'Approve…', exact: true }).click()
    await detail.getByRole('textbox', { name: 'Review comment' }).fill('Looks right')
    await detail.getByRole('button', { name: 'Approve', exact: true }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('posted to GitHub as octocat')
    await confirm.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect.poll(async () => (await readFile(log, 'utf8')).includes('pr review 8 --approve --body Looks right')).toBe(true)

    // Fix: a working copy of the branch, and a conversation that already has the failing output.
    await detail.locator('[data-pull-request-fix]').click()
    const transcript = page.getByRole('log', { name: 'Conversation', exact: true })
    await expect(transcript).toContainText('Fixture response: Pull request #8 "Fix the cart total"', { timeout: 30_000 })
    await expect(transcript).toContainText('Expected total 90, received 100')
    const worktrees = (await run(project, 'worktree', 'list', '--porcelain')).stdout
    expect(worktrees).toContain('branch refs/heads/fix-cart')
    await expect(page.locator('[data-session-list="project"]')).toContainText('Fix checks of PR #8', { timeout: 20_000 })
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
