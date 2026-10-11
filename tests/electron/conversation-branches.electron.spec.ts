import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { closeFixtureApplication } from './close-fixture-application'
import { startPiSdkFixture } from './pi-sdk-fixture'

const assistant = { api: 'openai-completions', provider: 'fixture', model: 'fake-chat', stopReason: 'stop', timestamp: 2,
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }

function branchedSession(cwd: string) {
  const timestamp = '2026-10-01T01:00:00Z'
  const entry = (id: string, parentId: string | null, message: object) => ({ type: 'message', id, parentId, timestamp, message })
  return [
    { type: 'session', version: 3, id: 'branched-fixture', timestamp, cwd },
    entry('q1', null, { role: 'user', timestamp: 1, content: 'Name a color.' }),
    entry('a1', 'q1', { ...assistant, role: 'assistant', content: [{ type: 'text', text: 'Blue.' }] }),
    entry('q2a', 'a1', { role: 'user', timestamp: 3, content: 'Name a fruit.' }),
    entry('a2a', 'q2a', { ...assistant, role: 'assistant', content: [{ type: 'text', text: 'Apple, the first answer.' }] }),
    entry('q2b', 'a1', { role: 'user', timestamp: 4, content: 'Name a vegetable.' }),
    entry('a2b', 'q2b', { ...assistant, role: 'assistant', content: [{ type: 'text', text: 'Carrot, the second answer.' }] }),
    { type: 'session_info', id: 'name', parentId: 'a2b', timestamp, name: 'Branched chat' },
  ]
}

test('switches between edited questions and edits a question into a new branch', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userData = testInfo.outputPath('user-data'), agentDir = testInfo.outputPath('pi-agent'), projectPath = testInfo.outputPath('Branch project')
  await Promise.all([userData, projectPath].map((path) => mkdir(path, { recursive: true })))
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, settings: {
    ...DEFAULT_SETTINGS, locale: 'en-US', notifications: { desktop: false, sound: false } } }))
  const cwd = await realpath(projectPath)
  const sessions = join(agentDir, 'sessions', `--${cwd.replace(/^[/\\]/u, '').replace(/[/\\:]/gu, '-')}--`)
  await mkdir(sessions, { recursive: true })
  const sessionPath = join(sessions, 'branched.jsonl')
  await writeFile(sessionPath, branchedSession(cwd).map((line) => JSON.stringify(line)).join('\n') + '\n')
  const fixture = await startPiSdkFixture({ agentDir })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' } })
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await app.evaluate(({ dialog }, directory) => { Object.defineProperty(dialog, 'showOpenDialog', { configurable: true, value: async () => ({ canceled: false, filePaths: [directory] }) }) }, cwd)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).first().click()
    await page.locator('[data-session-list="project"]').getByRole('button', { name: 'Branched chat', exact: true }).click()
    const transcript = page.getByRole('log', { name: 'Conversation', exact: true })
    await expect(transcript).toContainText('Carrot, the second answer.')

    // The edited question shows which version it is, and switches to the other.
    const branch = transcript.locator('[data-question-branch]')
    await expect(branch).toHaveAttribute('data-question-branch', '2/2')
    await branch.getByRole('button', { name: 'Previous version', exact: true }).click()
    await expect(transcript).toContainText('Apple, the first answer.')
    await expect(transcript).not.toContainText('Carrot, the second answer.')
    await expect(branch).toHaveAttribute('data-question-branch', '1/2')

    // The Branches tab lists both versions; switching back keeps everything.
    await page.getByRole('button', { name: 'Expand panel', exact: true }).click()
    await page.getByRole('button', { name: 'New tab', exact: true }).first().click()
    await page.getByRole('menuitem', { name: 'Branches', exact: true }).click()
    const tree = page.locator('[data-conversation-tree]')
    await expect(tree.locator('[data-tree-node]')).toHaveCount(3)
    await tree.locator('[data-tree-node="q2b"] button').first().click()
    await expect(transcript).toContainText('Carrot, the second answer.')

    // Editing a question puts it back in the composer, before that question.
    await transcript.locator('[data-conversation-question]').filter({ hasText: 'Name a vegetable.' }).hover()
    await transcript.locator('[data-conversation-question]').filter({ hasText: 'Name a vegetable.' }).locator('[data-question-edit]').click()
    await expect(page.getByRole('textbox', { name: 'Message input', exact: true })).toHaveText('Name a vegetable.')
    await expect(transcript).not.toContainText('Carrot, the second answer.')
    await expect(transcript).toContainText('Blue.')
    // Nothing was deleted: the session file still has every entry.
    expect((await readFile(sessionPath, 'utf8'))).toContain('Carrot, the second answer.')
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
