import { execFile } from 'node:child_process'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { _electron as electron, expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { closeFixtureApplication } from './close-fixture-application'
import { inspectorDetailsSessionEntries } from './inspector-details-fixture'
import { startPiSdkFixture } from './pi-sdk-fixture'
import { selectInspectorView } from './select-inspector-view'

const run = promisify(execFile)
const originalFile = 'export const first = 1\nexport const second = 2\nexport const third = 3\n'
const changedFile = 'export const first = 1\nexport const second = 20\nexport const third = 30\n'
const composer = (page: Page) => page.getByRole('textbox', { name: 'Message input', exact: true })
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector', exact: true })
const session = (page: Page, name: string) => page.getByRole('region', { name: 'Projects', exact: true }).getByRole('button', { name, exact: true })

async function start(testInfo: TestInfo) {
  const userData = testInfo.outputPath('user-data'), project = testInfo.outputPath('Precision project'), agentDir = testInfo.outputPath('pi-agent')
  await Promise.all([userData, project].map((path) => mkdir(path, { recursive: true })))
  await writeFile(join(project, 'example.ts'), originalFile)
  await run('git', ['init'], { cwd: project })
  await run('git', ['add', '.'], { cwd: project })
  await run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture'], { cwd: project })
  await writeFile(join(project, 'example.ts'), changedFile)
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, settings: {
    ...DEFAULT_SETTINGS, locale: 'en-US', appearance: { ...DEFAULT_SETTINGS.appearance, reducedMotion: true },
  } }))
  const cwd = await realpath(project)
  const sessionDirectory = join(agentDir, 'sessions', `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`)
  await mkdir(sessionDirectory, { recursive: true })
  await writeFile(join(sessionDirectory, 'precision-history.jsonl'), inspectorDetailsSessionEntries(cwd).map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  const fixture = await startPiSdkFixture({ agentDir })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: { ...process.env, ...fixture.env,
    PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' } })
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
  await app.evaluate(({ dialog }, path) => { Object.defineProperty(dialog, 'showOpenDialog', {
    configurable: true, value: async () => ({ canceled: false, filePaths: [path] }),
  }) }, project)
  await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
  await session(page, 'Existing project session').click()
  await expect(composer(page)).toBeEditable()
  return { app, page, fixture, project, errors }
}

/** A real browser text selection, ending with the same keyboard event as Shift+Arrow. */
async function selectPassage(element: Locator, passage: string) {
  await element.evaluate((root, text) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    while (walker.nextNode()) nodes.push(walker.currentNode as Text)
    const content = nodes.map((node) => node.data).join(''), start = content.indexOf(text)
    if (start < 0) throw new Error(`Passage not found: ${text}`)
    const point = (offset: number) => {
      let consumed = 0
      for (const node of nodes) {
        if (offset <= consumed + node.length) return { node, offset: offset - consumed }
        consumed += node.length
      }
      throw new Error('Selection outside content')
    }
    const from = point(start), to = point(start + text.length), range = document.createRange()
    range.setStart(from.node, from.offset); range.setEnd(to.node, to.offset)
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range)
    root.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Shift' }))
  }, passage)
}

async function quote(surface: Locator, target: Locator, text: string) {
  await selectPassage(target, text)
  await surface.getByRole('button', { name: 'Quote selection', exact: true }).click()
}

test('quotes message, exact file lines and command output as durable snapshots without sending', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const { app, page, fixture, project, errors } = await start(testInfo)
  try {
    const transcript = page.getByRole('log', { name: 'Conversation', exact: true })
    await composer(page).fill('Please inspect these captured passages.')
    const message = transcript.locator('[data-precision-source="message"]').filter({ hasText: 'Selected session history response' })
    await quote(message, message.locator('p').first(), 'history response')
    await expect(composer(page).locator('[data-precision-reference="message"]')).toHaveCount(1)

    await selectInspectorView(page, 'Files')
    await inspector(page).locator('[data-workspace-tree-row="example.ts"]').click()
    const reader = inspector(page).locator('[data-workspace-file-viewer]:visible')
    // Source files are quoted by their line numbers, as in Codex.
    await reader.locator('[data-column-number="2"]').first().click()
    await reader.locator('[data-file-line-actions]').getByRole('button', { name: 'Quote selection', exact: true }).click()
    await expect(composer(page).locator('[data-precision-reference="file"]')).toContainText('example.ts:2')
    await writeFile(join(project, 'example.ts'), changedFile.replace('second = 20', 'second = 200'))
    await expect(reader).toContainText('second = 200', { timeout: 12_000 })

    const shell = transcript.locator('[data-tool-kind="shell"]').filter({ hasText: 'pnpm test' })
    await shell.getByRole('button').first().click()
    await shell.getByRole('button', { name: 'Open output in workspace', exact: true }).click()
    const command = inspector(page).locator('[data-command-execution-panel]')
    await command.getByRole('button', { name: 'Raw', exact: true }).click()
    await quote(command, command.locator('[data-precision-source="command"] code').first(), '- All checks passed.')
    await expect(composer(page).locator('[data-precision-reference="command"]')).toHaveCount(1)
    await expect(page.locator('[data-composer-root]')).toHaveAttribute('data-draft-storage', 'ready')
    expect(fixture.prompts).toEqual([])

    await page.reload()
    await expect(composer(page).locator('[data-precision-reference]')).toHaveCount(3)
    await expect(composer(page)).toContainText('Please inspect these captured passages.')
    await composer(page).getByRole('button', { name: 'Inspect reference: example.ts:2', exact: true }).click()
    const snapshot = page.locator('[data-slot="popover-content"]')
    await expect(snapshot).toContainText('export const second = 20')
    await expect(snapshot).not.toContainText('second = 200')
    await page.keyboard.press('Escape')
    expect(fixture.prompts).toEqual([])
    await page.locator('[data-composer-submit]').click()
    await expect.poll(() => fixture.prompts.length).toBe(1)
    expect(fixture.prompts[0]).toContain('history response')
    expect(fixture.prompts[0]).toContain('Source: example.ts · lines 2-2')
    expect(fixture.prompts[0]).toContain('export const second = 20')
    expect(fixture.prompts[0]).not.toContain('second = 200')
    expect(fixture.prompts[0]).toContain('lines 3-3')
    expect(fixture.prompts[0]).toContain('- All checks passed.')
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    expect(errors).toEqual([])
  } finally { await closeFixtureApplication(app); await fixture.close() }
})

async function addComment(diff: Locator, side: 'addition' | 'deletion', line: number, comment: string, endLine = line) {
  // Click Pierre's real gutter; never simulate a selected range through application state.
  const from = diff.locator(`[data-column-number="${line}"][data-line-type="change-${side}"]`)
  if (line === endLine) await from.click()
  else {
    const to = diff.locator(`[data-column-number="${endLine}"][data-line-type="change-${side}"]`)
    await from.scrollIntoViewIfNeeded()
    const start = (await from.boundingBox())!, end = (await to.boundingBox())!, mouse = diff.page().mouse
    await mouse.move(start.x + start.width / 2, start.y + start.height / 2)
    await mouse.down(); await mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 5 }); await mouse.up()
  }
  const form = diff.locator('[data-review-new-comment]')
  await form.getByRole('textbox', { name: 'Review comment', exact: true }).fill(comment)
  await form.getByRole('button', { name: 'Save comment', exact: true }).click()
  await expect(diff.page().locator('[data-diff-review-summary]')).toContainText(comment)
  await expect(form).toHaveCount(0)
}

test('reviews actual diff lines with durable isolated comments, stale evidence and retry-safe draft transfer', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const { app, page, fixture, project, errors } = await start(testInfo)
  try {
    await selectInspectorView(page, 'Review')
    const diff = inspector(page).locator('[data-diff-id="unstaged:example.ts"]')
    const summary = inspector(page).locator('[data-diff-review-summary]')
    await expect(diff).not.toHaveAttribute('aria-busy', 'true')
    await addComment(diff, 'addition', 2, 'Keep the second public export stable.', 3)
    await addComment(diff, 'deletion', 2, 'Explain why the old value changed.')
    await addComment(diff, 'addition', 3, 'Temporary comment to delete.')
    await summary.locator('[data-review-comment]').filter({ hasText: 'Temporary comment to delete.' }).getByRole('button', { name: 'Delete review comment', exact: true }).click()
    await expect(summary.locator('[data-review-comment]')).toHaveCount(2)
    const firstId = await summary.locator('[data-review-comment]').filter({ hasText: 'Keep the second public export stable.' }).getAttribute('data-review-comment')
    expect(firstId).toBeTruthy()
    const first = summary.locator(`[data-review-comment="${firstId}"]`)
    await first.getByRole('button', { name: 'Edit review comment', exact: true }).click()
    await first.getByRole('textbox', { name: 'Review comment', exact: true }).fill('Add a compatibility test for the second export.')
    await first.getByRole('button', { name: 'Save comment', exact: true }).click()
    await expect(summary).toContainText('Add a compatibility test for the second export.')
    await composer(page).fill('Please apply this review carefully.')

    await page.getByRole('button', { name: 'New task in Precision project', exact: true }).click()
    await expect(composer(page)).toHaveText('')
    await composer(page).fill('Create isolated review B')
    await page.locator('[data-composer-submit]').click()
    await expect(page.getByRole('log', { name: 'Conversation', exact: true })).toContainText('Fixture response: Create isolated review B')
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => window.pipilot!.localPi.runtime.command({ type: 'set_session_name', name: 'Review B' }))).toMatchObject({ success: true })
    // A new task starts with its own (empty) tabs.
    await selectInspectorView(page, 'Review')
    await expect(summary.locator('[data-review-comment]')).toHaveCount(0)
    await addComment(diff, 'addition', 3, 'Only belongs to review B.')
    await session(page, 'Existing project session').click()
    await expect(summary.locator('[data-review-comment]')).toHaveCount(2)
    await expect(summary).not.toContainText('Only belongs to review B.')
    await expect(composer(page)).toContainText('Please apply this review carefully.')
    await page.reload()
    await selectInspectorView(page, 'Review')
    await expect(summary.locator('[data-review-comment]')).toHaveCount(2)

    // A newer working-tree revision must not silently retarget either old/new-side comment.
    await writeFile(join(project, 'example.ts'), changedFile.replace('second = 20', 'second = 200'))
    await expect(summary.getByText('The file changed after this comment was captured. Check the current changes before applying it.', { exact: true })).toHaveCount(2, { timeout: 12_000 })
    await expect(diff.locator('[data-review-comment]')).toHaveCount(0)

    await page.evaluate(() => {
      const original = IDBObjectStore.prototype.put
      const state = window as unknown as { restorePrecisionWrites?: () => void }
      state.restorePrecisionWrites = () => { IDBObjectStore.prototype.put = original }
      IDBObjectStore.prototype.put = function (...args) {
        const request = original.apply(this, args)
        if (this.transaction.db.name === 'pipilot-composer-drafts') this.transaction.abort()
        return request
      }
    })
    await summary.getByRole('button', { name: 'Add review to draft', exact: true }).click()
    await expect(summary.getByRole('alert')).toContainText('Could not finish adding the review')
    await expect(summary.locator('[data-review-comment]')).toHaveCount(2)
    await expect(composer(page).locator('[data-precision-reference="diff"]')).toHaveCount(2)
    expect(fixture.prompts).toEqual(['Create isolated review B'])
    await page.evaluate(() => (window as unknown as { restorePrecisionWrites(): void }).restorePrecisionWrites())
    await summary.getByRole('button', { name: 'Add review to draft', exact: true }).click()
    await expect(summary.locator('[data-review-comment]')).toHaveCount(0)
    await expect(composer(page).locator('[data-precision-reference="diff"]')).toHaveCount(2)
    await expect(composer(page)).toContainText('Please apply this review carefully.')
    await expect(page.locator('[data-composer-root]')).toHaveAttribute('data-draft-storage', 'ready')
    await page.reload()
    await expect(composer(page).locator('[data-precision-reference="diff"]')).toHaveCount(2)
    await session(page, 'Review B').click()
    await selectInspectorView(page, 'Review')
    await expect(summary.locator('[data-review-comment]')).toHaveCount(1)
    await expect(summary).toContainText('Only belongs to review B.')
    await expect(composer(page).locator('[data-precision-reference]')).toHaveCount(0)
    await session(page, 'Existing project session').click()
    await page.locator('[data-composer-submit]').click()
    await expect.poll(() => fixture.prompts.length).toBe(2)
    expect(fixture.prompts[1]).toContain('Review of project changes')
    expect(fixture.prompts[1]).toContain('Warning: this snapshot is outdated')
    expect(fixture.prompts[1]).toContain('export const second = 20')
    expect(fixture.prompts[1]).not.toContain('export const second = 200')
    expect(fixture.prompts[1]).toContain('export const second = 2')
    expect(fixture.prompts[1]).toContain('old side')
    expect(fixture.prompts[1]).toContain('new side')
    expect(fixture.prompts[1]).not.toContain('Only belongs to review B.')
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    expect(errors).toEqual([])
  } finally { await closeFixtureApplication(app); await fixture.close() }
})
