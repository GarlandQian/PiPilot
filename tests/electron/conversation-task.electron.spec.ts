import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { PI_GOAL_PACKAGE, PI_GOAL_VERSION, PI_PLAN_MODE_PACKAGE, PI_PLAN_MODE_VERSION } from '../../src/shared/pi-package-adapters'
import { PNG_FIXTURE_BASE64 } from '../helpers/image-fixture'
import { closeFixtureApplication } from './close-fixture-application'
import { startPiSdkFixture } from './pi-sdk-fixture'

const plan = '# Publish a checked report\n\nVerify the report and record the result.'
const nextActions = [{ id: 'review', label: 'Review the report', prompt: 'Review REPORT.md and suggest improvements.' }]
const task = { version: 2, updatedAt: Date.parse('2026-10-01T01:00:00Z'), summary: '**Report ready.** Review the plan before proceeding.', blockers: [], nextActions }

/** Deterministic plugin protocols loaded by the real SDK from isolated npm packages. */
async function installOverviewPluginFixtures(agentDir: string) {
  const planDirectory = join(agentDir, 'npm', 'node_modules', PI_PLAN_MODE_PACKAGE)
  const goalDirectory = join(agentDir, 'npm', 'node_modules', PI_GOAL_PACKAGE)
  await Promise.all([planDirectory, goalDirectory].map((directory) => mkdir(directory, { recursive: true })))
  await Promise.all([
    writeFile(join(planDirectory, 'package.json'), JSON.stringify({ name: PI_PLAN_MODE_PACKAGE, version: PI_PLAN_MODE_VERSION, type: 'module', pi: { extensions: ['./index.js'] } })),
    writeFile(join(goalDirectory, 'package.json'), JSON.stringify({ name: PI_GOAL_PACKAGE, version: PI_GOAL_VERSION, type: 'module', pi: { extensions: ['./index.js'] } })),
    writeFile(join(planDirectory, 'index.js'), `
export default function overviewPlanFixture(pi) {
  const read = (ctx) => [...ctx.sessionManager.getBranch()].reverse().find((entry) => entry.type === 'custom' && entry.customType === 'plan-mode-state')?.data;
  const restore = (_event, ctx) => {
    const state = read(ctx);
    const status = state?.enabled ? (state.latestPlan ? 'plan ready' : 'plan active') : state?.activeImplementation ? 'plan implementing' : undefined;
    ctx.ui.setStatus('plan-mode', status);
    ctx.ui.setWidget('plan-mode-plan', undefined);
  };
  pi.on('session_start', restore);
  pi.on('session_tree', restore);
  pi.registerCommand('plan', { description: 'Isolated Plan UI protocol fixture', handler: async (args, ctx) => {
    const state = read(ctx);
    if (args === 'exit') {
      pi.appendEntry('plan-mode-state', { enabled: false, awaitingAction: false });
      return restore(null, ctx);
    }
    if (args && !['implement', 'show', 'finalize', 'save', 'export'].includes(args)) {
      pi.appendEntry('fixture-plan-request', { args });
      pi.appendEntry('plan-mode-state', { enabled: true, awaitingAction: false });
      return restore(null, ctx);
    }
    if (args !== 'implement' || !state?.enabled || !state.latestPlan) throw new Error('Unsupported fixture plan action');
    pi.appendEntry('plan-mode-state', { enabled: false, awaitingAction: false, activeImplementation: {
      id: 'fixture-implementation', plan: state.latestPlan, source: 'plan_mode_complete', startedAt: Date.now(), retention: 'keep',
    } });
    restore(null, ctx);
    pi.sendUserMessage('Implement the approved plan.\\n\\n' + state.latestPlan);
  } });
}
`, 'utf8'),
    writeFile(join(goalDirectory, 'index.js'), `
export default function overviewGoalFixture(pi) {
  const read = (ctx) => [...ctx.sessionManager.getBranch()].reverse().find((entry) => entry.type === 'custom' && entry.customType === 'goal-state')?.data?.goal;
  const restore = (_event, ctx) => {
    const goal = read(ctx);
    ctx.ui.setStatus('goal', goal ? goal.status + ' 1' : undefined);
  };
  pi.on('session_start', restore);
  pi.on('session_tree', restore);
  pi.registerCommand('goal', { description: 'Isolated Goal UI protocol fixture', handler: async (args, ctx) => {
    const goal = read(ctx);
    if (args && !['pause', 'resume', 'clear', 'status'].includes(args)) {
      pi.appendEntry('goal-state', { goal: { id: 'fixture-started-goal', text: args, status: 'active', iteration: 0, tokensUsed: 0, timeUsedSeconds: 0, automaticModelTurns: 0 } });
      return restore(null, ctx);
    }
    if (!goal || !['pause', 'resume', 'clear'].includes(args)) throw new Error('Unsupported fixture goal action');
    pi.appendEntry('goal-state', { goal: args === 'clear' ? null : { ...goal, status: args === 'pause' ? 'paused' : 'active' } });
    restore(null, ctx);
  } });
}
`, 'utf8'),
  ])
  return [`npm:${PI_PLAN_MODE_PACKAGE}@${PI_PLAN_MODE_VERSION}`, `npm:${PI_GOAL_PACKAGE}@${PI_GOAL_VERSION}`]
}

function history(cwd: string, withTask = true): Record<string, unknown>[] {
  const timestamp = '2026-10-01T01:00:00Z'
  const entries: Record<string, unknown>[] = [{ type: 'session', version: 3, id: withTask ? 'task-context-fixture' : 'plain-context-fixture', timestamp, cwd }]
  let parentId: string | null = null
  const append = (type: string, id: string, data: Record<string, unknown>) => {
    entries.push({ type, id, parentId, timestamp, ...data }); parentId = id
  }
  const assistant = { api: 'openai-completions', provider: 'fixture', model: 'fake-chat', timestamp: 1,
    usage: { input: 12, output: 8, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }
  append('message', 'question', { message: { role: 'user', timestamp: 1,
    content: withTask ? [{ type: 'text', text: 'Prepare a checked **report**.' }, { type: 'image', mimeType: 'image/png', data: PNG_FIXTURE_BASE64 }] : 'An unrelated question.' } })
  if (withTask) {
    append('message', 'calls', { message: { ...assistant, role: 'assistant', stopReason: 'toolUse', content: [
      { type: 'thinking', thinking: 'Private fixture thought must never be exported.' },
      { type: 'toolCall', id: 'read-call', name: 'read', arguments: { path: 'notes.md' } },
      { type: 'toolCall', id: 'write-call', name: 'write', arguments: { path: 'REPORT.md', content: '# Report' } },
      { type: 'toolCall', id: 'mcp-call', name: 'mcp__docs__lookup', arguments: { query: 'report' } },
    ] } })
    for (const [id, name, text] of [['read-call', 'read', '# Notes'], ['write-call', 'write', 'Wrote REPORT.md'], ['mcp-call', 'mcp__docs__lookup', 'Reference found']]) {
      append('message', `${id}-result`, { message: { role: 'toolResult', toolCallId: id, toolName: name, isError: false, timestamp: 2, content: [{ type: 'text', text }] } })
    }
  }
  append('message', 'answer', { message: { ...assistant, role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: withTask
    ? '## Ready for review\n\nThe report is ready. [Output](REPORT.md) · [Reference](https://example.com/reference)' : 'Unrelated answer without task data.' }] } })
  if (withTask) {
    append('custom', 'task-state', { customType: 'pipilot.task-state', data: task })
    append('custom', 'plugin-plan', { customType: 'plan-mode-state', data: {
      enabled: true, awaitingAction: true, latestPlan: plan, latestPlanSource: 'plan_mode_complete',
    } })
    append('custom', 'plugin-goal', { customType: 'goal-state', data: { goal: {
      id: 'fixture-goal', text: 'Finish the checked report', status: 'paused', iteration: 1, tokensUsed: 0, timeUsedSeconds: 0, automaticModelTurns: 0,
    } } })
  }
  append('model_change', 'model', { provider: 'fixture', modelId: 'fake-chat' })
  append('session_info', 'name', { name: withTask ? 'Context task' : 'Other context' })
  return entries
}

test('keeps overview scoped, preserves drafts and routes plugin actions through the real SDK', async ({}, testInfo) => {
  test.setTimeout(110_000)
  const userData = testInfo.outputPath('user-data'), project = testInfo.outputPath('Task project'), agentDir = testInfo.outputPath('pi-agent')
  await Promise.all([userData, project].map((path) => mkdir(path, { recursive: true })))
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, settings: {
    ...DEFAULT_SETTINGS, locale: 'en-US', notifications: { desktop: false, sound: false },
    appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true },
  } }))
  await writeFile(join(project, 'notes.md'), '# Notes\n\nChecked fixture source.\n')
  await writeFile(join(project, 'REPORT.md'), '# Report\n\nChecked fixture report.\n')
  const cwd = await realpath(project)
  const sessionDirectory = join(agentDir, 'sessions', `--${cwd.replace(/^[/\\]/u, '').replace(/[/\\:]/gu, '-')}--`)
  await mkdir(sessionDirectory, { recursive: true })
  const sessionPath = join(sessionDirectory, 'task.jsonl')
  await writeFile(sessionPath, history(cwd).map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  await writeFile(join(sessionDirectory, 'other.jsonl'), history(cwd, false).map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  const globalPackages = await installOverviewPluginFixtures(agentDir)
  const fixture = await startPiSdkFixture({ agentDir, globalPackages, providerToolCall: ({ prompt, body }) => {
    if (!prompt.startsWith('Implement the approved plan.')) return null
    const messages = (body as { messages?: { role?: string; tool_call_id?: string }[] }).messages ?? []
    if (messages.some((message) => message.role === 'tool' && message.tool_call_id === 'fixture-task-complete')) return null
    return { id: 'fixture-task-complete', name: 'pipilot_update_task', arguments: {
      summary: '**Report verified.** All planned checks passed.', blockers: [], nextActions,
    } }
  } })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: { ...process.env, ...fixture.env,
    PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' } })
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const composer = page.getByRole('textbox', { name: 'Message input', exact: true })
  const transcript = page.getByRole('log', { name: 'Conversation', exact: true })
  const context = page.locator('[data-conversation-context]')
  // The summary is a card over the trailing edge (Codex); it closes when you work elsewhere.
  const summary = page.locator('[data-conversation-summary]')
  const showSummary = async () => {
    if (!await summary.isVisible().catch(() => false)) await page.locator('[data-summary-trigger]').click()
    await expect(summary).toBeVisible()
  }
  // The plan is shown and decided only in the transcript; the summary and the
  // composer capsule just point to it.
  const planCard = transcript.locator('[data-plan-card][data-plan-current="true"]')
  const planCapsule = page.getByRole('status', { name: 'Plan is waiting for your approval', exact: true })
  const startImplementation = planCard.getByRole('button', { name: 'Start implementation', exact: true })
  try {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await app.evaluate(({ dialog }, path) => { Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true, value: async () => ({ canceled: false, filePaths: [path] }),
    }) }, project)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
    const projects = page.getByRole('region', { name: 'Projects', exact: true })
    await projects.getByRole('button', { name: 'Context task', exact: true }).click()
    await expect(transcript).toContainText('Ready for review')
    await showSummary()
    await expect(context).toContainText('Report ready.')
    await expect(context.locator('[data-plan-summary]')).toContainText('Waiting for your approval')
    await expect(context).not.toContainText('Verify the report and record the result.')
    await context.getByRole('button', { name: 'Go to plan: Waiting for your approval', exact: true }).click()
    await expect(planCard).toBeInViewport()
    await expect(planCard).toContainText('Publish a checked report')
    await expect(planCard).toHaveAttribute('data-plan-lifecycle', 'ready')
    // An unfinished Goal withholds starting the plan.
    await expect(startImplementation).toHaveCount(0)
    await expect(planCapsule).toHaveCount(0)
    // Recognised plugins don't also echo their raw status lines above the composer.
    await expect(page.getByText(/^(?:plan-mode|goal): /u)).toHaveCount(0)
    await showSummary()
    await expect(context.getByRole('button', { name: 'Approve and start', exact: true })).toHaveCount(0)
    await expect(context.locator('[data-goal-summary]')).toContainText('Paused')
    await expect(context.getByRole('button', { name: /REPORT\.md Written/ })).toBeVisible()
    await context.getByRole('button', { name: /^Sources/ }).click()
    await expect(context.getByRole('button', { name: /notes\.md Read/ })).toBeVisible()
    await context.getByRole('button', { name: /^Skills & MCP/ }).click()
    await expect(context).toContainText('docs / lookup')
    await expect(context).not.toContainText('fixture-skill')
    await context.getByRole('button', { name: /^Web links/ }).click()
    await expect(context).toContainText('https://example.com/reference')
    await expect(context).toContainText('does not mean it was visited')
    await context.getByRole('button', { name: /notes\.md Read/ }).click()
    await expect(transcript.locator('[data-outline-highlighted="true"]')).toHaveAttribute('data-conversation-outline-entry', 'question')
    await page.screenshot({ path: testInfo.outputPath('conversation-context-desktop-light.png'), animations: 'disabled' })

    // A suggestion appends to the draft, retaining structured file mentions and images.
    await composer.fill('Keep my draft')
    await composer.pressSequentially(' @notes')
    await page.locator('[data-slot="command"][aria-label="Files and Skills"]').getByRole('option', { name: /notes\.md/ }).click()
    await page.locator('input[type="file"]').setInputFiles({ name: 'draft.png', mimeType: 'image/png', buffer: Buffer.from(PNG_FIXTURE_BASE64, 'base64') })
    await showSummary()
    await context.getByRole('button', { name: 'Review the report', exact: true }).click()
    await expect(summary).toBeHidden()
    await expect(composer).toContainText('Keep my draft')
    await expect(composer).toContainText('Review REPORT.md and suggest improvements.')
    await expect(page.locator('[data-composer-mention-kind="file"]')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Remove image draft.png', exact: true })).toBeAttached()
    expect(fixture.prompts).toHaveLength(0)

    // Only the native destination picker is replaced; history, export IPC and writes are real.
    const exportPath = testInfo.outputPath('conversation.md')
    await app.evaluate(({ dialog }, path) => { Object.defineProperty(dialog, 'showSaveDialog', {
      configurable: true, value: async () => ({ canceled: false, filePath: path }),
    }) }, exportPath)
    const sessionRow = (name: string) => page.locator('[data-session-list="project"]').getByRole('listitem')
      .filter({ has: page.getByRole('button', { name, exact: true }) })
    await sessionRow('Context task').getByRole('button', { name: 'More actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Export Markdown…', exact: true }).click()
    let exportDialog = page.getByRole('dialog', { name: 'Export Markdown', exact: true })
    await exportDialog.getByRole('button', { name: 'Choose save location', exact: true }).click()
    await expect(exportDialog).toContainText('Saved conversation.md')
    await expect(exportDialog).toContainText('Image files: 1.')
    await exportDialog.getByRole('button', { name: 'Close', exact: true }).first().click()
    const markdown = await readFile(exportPath, 'utf8')
    expect(markdown).toContain('Prepare a checked **report**.')
    expect(markdown).toContain('## Ready for review')
    expect(markdown).toContain('[Output](REPORT.md)')
    expect(markdown).not.toContain('Private fixture thought')
    expect(markdown).not.toContain('## Tool output')
    const assetDirectory = (await readdir(testInfo.outputDir)).find((name) => name.startsWith('pipilot-assets-'))!
    expect(await readdir(join(testInfo.outputDir, assetDirectory))).toEqual(['image-1.png'])

    // Export the unselected row without activating its runtime or losing this draft.
    const otherExportPath = testInfo.outputPath('other-context.md')
    await app.evaluate(({ dialog }, path) => { Object.defineProperty(dialog, 'showSaveDialog', {
      configurable: true, value: async () => ({ canceled: false, filePath: path }),
    }) }, otherExportPath)
    await sessionRow('Other context').hover()
    await sessionRow('Other context').getByRole('button', { name: 'More actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Export Markdown…', exact: true }).click()
    exportDialog = page.getByRole('dialog', { name: 'Export Markdown', exact: true })
    await expect(exportDialog).toContainText('Other context')
    await exportDialog.getByRole('button', { name: 'Choose save location', exact: true }).click()
    await expect(exportDialog).toContainText('Saved other-context.md')
    await exportDialog.getByRole('button', { name: 'Close', exact: true }).first().click()
    expect(await readFile(otherExportPath, 'utf8')).toContain('Unrelated answer without task data.')
    expect(await readFile(otherExportPath, 'utf8')).not.toContain('Prepare a checked')
    await expect(projects.getByRole('button', { name: 'Context task', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(transcript).toContainText('Ready for review')
    await showSummary()
    await expect(context).toContainText('Report ready.')
    await page.keyboard.press('Escape')
    await expect(composer).toContainText('Keep my draft')
    expect(fixture.prompts).toHaveLength(0)

    const messagePath = testInfo.outputPath('message.md')
    await app.evaluate(({ dialog }, path) => { Object.defineProperty(dialog, 'showSaveDialog', {
      configurable: true, value: async () => ({ canceled: false, filePath: path }),
    }) }, messagePath)
    await transcript.getByRole('button', { name: 'Export message…', exact: true }).click()
    exportDialog = page.getByRole('dialog', { name: 'Export message', exact: true })
    await exportDialog.getByRole('button', { name: 'Choose save location', exact: true }).click()
    await expect(exportDialog).toContainText('Saved message.md')
    await exportDialog.getByRole('button', { name: 'Close', exact: true }).first().click()
    expect(await readFile(messagePath, 'utf8')).toContain('Prepare a checked **report**.')
    expect(await readFile(messagePath, 'utf8')).not.toContain('Ready for review')

    const responsePath = testInfo.outputPath('response.md')
    await app.evaluate(({ dialog }, path) => { Object.defineProperty(dialog, 'showSaveDialog', {
      configurable: true, value: async () => ({ canceled: false, filePath: path }),
    }) }, responsePath)
    await transcript.getByRole('button', { name: 'Export response…', exact: true }).click()
    exportDialog = page.getByRole('dialog', { name: 'Export response', exact: true })
    await exportDialog.getByRole('switch', { name: 'Include tool logs', exact: true }).click()
    await exportDialog.getByRole('button', { name: 'Choose save location', exact: true }).click()
    await expect(exportDialog).toContainText('Saved response.md')
    await exportDialog.getByRole('button', { name: 'Close', exact: true }).first().click()
    expect(await readFile(responsePath, 'utf8')).toContain('## Tool output: read')
    expect(await readFile(responsePath, 'utf8')).not.toContain('Private fixture thought')

    // Selecting another session must clear task details immediately.
    await projects.getByRole('button', { name: 'Other context', exact: true }).click()
    await expect(transcript).toContainText('Unrelated answer without task data.')
    await showSummary()
    await expect(context).not.toContainText('Report ready.')
    await expect(context.getByRole('button', { name: 'Approve and start', exact: true })).toHaveCount(0)
    await expect(context.locator('[data-plan-summary], [data-goal-summary]')).toHaveCount(0)
    await expect(context.getByRole('button', { name: /^Outputs/ })).toHaveCount(0)
    await expect(context).toContainText('No summary yet.')
    await projects.getByRole('button', { name: 'Context task', exact: true }).click()
    await showSummary()
    await expect(context).toContainText('Report ready.')
    await expect(composer).toContainText('Keep my draft')
    await expect(page.locator('[data-composer-mention-kind="file"]')).toHaveCount(1)

    await expect(startImplementation).toHaveCount(0)
    // A paused Goal still owns unfinished work. Its controls remain available,
    // and clearing it releases the Plan handoff without resurrecting old state.
    await context.locator('[data-goal-summary]').click()
    await context.getByRole('button', { name: 'Resume', exact: true }).click()
    await expect(context.locator('[data-goal-summary]')).toContainText('Running')
    await expect(startImplementation).toHaveCount(0)
    await context.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect(context.locator('[data-goal-summary]')).toContainText('Paused')
    await expect(startImplementation).toHaveCount(0)
    await context.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(context.locator('[data-goal-summary]')).toHaveCount(0)
    await expect(context.getByRole('button', { name: 'Resume', exact: true })).toHaveCount(0)
    await expect(startImplementation).toBeEnabled()
    await expect(planCapsule).toBeVisible()
    await planCapsule.getByRole('button', { name: 'View', exact: true }).click()
    await expect(planCard).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath('conversation-plan-ready-light.png'), animations: 'disabled' })
    expect(fixture.prompts).toHaveLength(0)
    await planCapsule.getByRole('button', { name: 'Start implementation', exact: true }).click()
    await showSummary()
    await expect(context).toContainText('Report verified.', { timeout: 20_000 })
    await expect(context.locator('[data-plan-summary]')).toContainText('Following the plan')
    await expect(planCapsule).toHaveCount(0)
    await expect(page.getByText(/^(?:plan-mode|goal): /u)).toHaveCount(0)
    await expect(context.getByRole('status')).toHaveText('Ready', { timeout: 20_000 })
    await expect(context.locator('[data-plan-step-status]')).toHaveCount(0)
    expect(fixture.prompts.length).toBeGreaterThanOrEqual(2)
    expect(fixture.prompts.every((prompt) => prompt.startsWith('Implement the approved plan.'))).toBe(true)
    const savedEntries = (await readFile(sessionPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
    const taskEntries = savedEntries.filter((item) => item.type === 'custom' && item.customType === 'pipilot.task-state')
    expect(taskEntries[taskEntries.length - 1]).toMatchObject({ data: { version: 2, summary: '**Report verified.** All planned checks passed.' } })
    expect((taskEntries[taskEntries.length - 1]!.data as Record<string, unknown>)).not.toHaveProperty('plan')
    expect(savedEntries).toContainEqual(expect.objectContaining({ customType: 'plan-mode-state', data: expect.objectContaining({ activeImplementation: expect.any(Object) }) }))
    const goalEntries = savedEntries.filter((item) => item.type === 'custom' && item.customType === 'goal-state')
    expect(goalEntries[goalEntries.length - 1]).toMatchObject({ data: { goal: null } })
    expect(JSON.stringify(savedEntries)).not.toContain('/pipilot-plan')
    await expect(context.locator('[data-goal-summary]')).toHaveCount(0)
    await expect(composer).toContainText('Keep my draft')
    await expect(page.getByRole('button', { name: 'Remove image draft.png', exact: true })).toBeAttached()
    await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'dark' } }))
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.screenshot({ path: testInfo.outputPath('conversation-context-desktop-dark.png'), animations: 'disabled' })

    // Minimum supported window: the summary card still fits without document overflow.
    await page.setViewportSize({ width: 1100, height: 680 })
    await showSummary()
    await expect(summary.getByRole('region', { name: 'Conversation summary', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('conversation-context-minimum-dark.png'), animations: 'disabled' })
    await summary.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(summary).toBeHidden()
    expect(errors).toEqual([])
  } catch (error) {
    await page.screenshot({ path: testInfo.outputPath('conversation-task-failure.png') }).catch(() => undefined)
    await testInfo.attach('conversation-task-diagnostics', { contentType: 'application/json', body: JSON.stringify({
      errors, prompts: fixture.prompts, context: await context.textContent().catch(() => null),
      runtime: await page.evaluate(() => window.pipilot!.localPi.runtime.status()).catch(() => null),
    }) })
    throw error
  } finally { await closeFixtureApplication(app); await fixture.close() }
})

test('starts Plan and Goal from the composer "+" menu through their plugin commands', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userData = testInfo.outputPath('user-data'), project = testInfo.outputPath('Mode project'), agentDir = testInfo.outputPath('pi-agent')
  await Promise.all([userData, project].map((path) => mkdir(path, { recursive: true })))
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, settings: {
    ...DEFAULT_SETTINGS, locale: 'en-US', notifications: { desktop: false, sound: false },
    appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true },
  } }))
  await writeFile(join(project, 'notes.md'), '# Notes\n')
  const cwd = await realpath(project)
  const sessionDirectory = join(agentDir, 'sessions', `--${cwd.replace(/^[/\\]/u, '').replace(/[/\\:]/gu, '-')}--`)
  await mkdir(sessionDirectory, { recursive: true })
  const sessionPath = join(sessionDirectory, 'other.jsonl')
  await writeFile(sessionPath, history(cwd, false).map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  const fixture = await startPiSdkFixture({ agentDir, globalPackages: await installOverviewPluginFixtures(agentDir) })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: { ...process.env, ...fixture.env,
    PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' } })
  const page = await app.firstWindow(), errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const composer = page.getByRole('textbox', { name: 'Message input', exact: true })
  const add = page.getByRole('button', { name: 'Add', exact: true })
  const planChip = page.locator('[data-composer-mode="plan"]')
  const goalChip = page.locator('[data-composer-mode="goal"]')
  const modeItem = (mode: 'plan' | 'goal') => page.locator(`[data-composer-mode-item="${mode}"]`)
  const savedEntries = async () => (await readFile(sessionPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
  try {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await app.evaluate(({ dialog }, path) => { Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true, value: async () => ({ canceled: false, filePaths: [path] }),
    }) }, project)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
    await page.getByRole('region', { name: 'Projects', exact: true }).getByRole('button', { name: 'Other context', exact: true }).click()
    await expect(page.getByRole('log', { name: 'Conversation', exact: true })).toContainText('Unrelated answer without task data.')

    // A mode is a removable token: picked from "+", dropped with Backspace.
    await add.click()
    await expect(modeItem('plan')).toBeEnabled()
    await modeItem('plan').click()
    await expect(planChip).toBeVisible()
    await expect(composer).toBeFocused()
    await expect(page.locator('[data-composer-surface]')).toContainText('Describe what to plan…')
    await composer.press('Backspace')
    await expect(planChip).toHaveCount(0)

    // Shortcuts toggle a mode, and Plan and Goal replace each other.
    await page.keyboard.press('ControlOrMeta+Shift+P')
    await expect(planChip).toBeVisible()
    await page.keyboard.press('ControlOrMeta+Shift+G')
    await expect(goalChip).toBeVisible()
    await expect(planChip).toHaveCount(0)
    await page.keyboard.press('ControlOrMeta+Shift+G')
    await expect(goalChip).toHaveCount(0)

    // Sending with Plan selected runs the plugin's /plan with the typed request.
    await page.keyboard.press('ControlOrMeta+Shift+P')
    await composer.fill('Add export to settings')
    await composer.press('Enter')
    await expect(planChip).toHaveAttribute('data-composer-mode-active', 'true', { timeout: 20_000 })
    await expect(composer).toHaveText('')
    await expect.poll(async () => (await savedEntries()).some((entry) => entry.customType === 'fixture-plan-request' &&
      (entry.data as { args?: string }).args === 'Add export to settings')).toBe(true)
    expect(fixture.prompts).toHaveLength(0)
    await add.click()
    await expect(modeItem('goal')).toBeDisabled()
    await expect(modeItem('goal')).toContainText('Plan mode is on. Exit it first')
    await page.keyboard.press('Escape')
    await page.screenshot({ path: testInfo.outputPath('composer-plan-mode-light.png'), animations: 'disabled' })

    // With no plan written yet, the active chip's ✕ leaves Plan mode at once.
    await planChip.getByRole('button', { name: 'Exit plan mode', exact: true }).click()
    await expect(planChip).toHaveCount(0, { timeout: 20_000 })

    // Goal starts the same way, then lives in the tray rather than as a chip.
    await page.keyboard.press('ControlOrMeta+Shift+G')
    await composer.fill('Ship the checked report')
    await composer.press('Enter')
    await expect(goalChip).toHaveCount(0)
    await expect(page.getByRole('status', { name: 'Goal', exact: true })).toContainText('Running', { timeout: 20_000 })
    await add.click()
    await expect(modeItem('plan')).toBeDisabled()
    await expect(modeItem('plan')).toContainText('A goal is unfinished')

    // "+" also opens the / and @ pickers at the caret.
    await page.getByRole('menuitem', { name: /^Commands & skills/ }).click()
    await expect(page.locator('[data-slot="command"][aria-label="Slash commands"]')).toBeVisible()
    await expect(composer).toHaveText('/')
    await composer.press('Escape')
    await composer.fill('')
    await add.click()
    await page.getByRole('menuitem', { name: /^Reference a file/ }).click()
    await expect(page.locator('[data-slot="command"][aria-label="Files and Skills"]')).toBeVisible()
    await expect(composer).toHaveText('@')
    await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'dark' } }))
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.screenshot({ path: testInfo.outputPath('composer-goal-tray-dark.png'), animations: 'disabled' })
    expect(errors).toEqual([])
  } catch (error) {
    await page.screenshot({ path: testInfo.outputPath('composer-modes-failure.png') }).catch(() => undefined)
    throw error
  } finally { await closeFixtureApplication(app); await fixture.close() }
})
