import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'
import { closeFixtureApplication } from './close-fixture-application'

const HISTORY_REPLIES = 1_000
const prompt = 'Measure a long live response'
const liveMarkdown = Array.from({ length: 110 }, (_, index) => (
  `## Live section ${index}\n\nParagraph **${index}** links to [the shared reference][shared] and explains that completed history must remain responsive while this answer streams.\n\n` +
  '| Field | Value |\n| --- | --- |\n| result | preserved |\n\n' +
  '```typescript\nconst retained = "whole-document Markdown semantics";\n```\n\n'
)).join('') + '[shared]: https://example.com/reference\n\nPERFORMANCE_RESPONSE_COMPLETE\n'

function entries(cwd: string, name: string, count: number) {
  const timestamp = Date.parse('2026-08-09T00:00:00Z')
  const identity = name.replace(/ /g, '-')
  const result: unknown[] = [{ type: 'session', version: 3, id: identity, cwd, timestamp: new Date(timestamp).toISOString() }]
  let parentId: string | null = null
  for (let index = 0; index < count * 2; index += 1) {
    const id = `${identity}-${index}`
    result.push({ type: 'message', id, parentId, timestamp: new Date(timestamp + index).toISOString(), message: index % 2 === 0
      ? { role: 'user', content: `${name} question ${index / 2}`, timestamp: timestamp + index }
      : { role: 'assistant', content: [{ type: 'text', text: `### Completed ${Math.floor(index / 2)}\n\nA stable historical answer with **Markdown**.` }],
          api: 'openai-completions', provider: 'fixture', model: 'fake-chat', timestamp: timestamp + index, stopReason: 'stop',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
    })
    parentId = id
  }
  result.push({ type: 'session_info', id: `${identity}-name`, parentId, timestamp: new Date(timestamp + count * 2).toISOString(), name })
  return result.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
}

test('measures input, frame gaps and session switches with 1000 replies and 32KB live Markdown', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const projectPath = testInfo.outputPath('workspace')
  await Promise.all([userData, projectPath].map((path) => mkdir(path, { recursive: true })))
  const cwd = await realpath(projectPath)
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US', appearance: { ...DEFAULT_SETTINGS.appearance, reducedMotion: true } } }))
  const directory = join(agentDir, 'sessions', `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'long.jsonl'), entries(cwd, 'Performance long', HISTORY_REPLIES))
  await writeFile(join(directory, 'short.jsonl'), entries(cwd, 'Performance short', 1))
  let release!: () => void
  const gate = new Promise<void>((resolveGate) => { release = resolveGate })
  const chunks = [liveMarkdown.slice(0, 20_000), ...liveMarkdown.slice(20_000).match(/[^]{1,250}/g)!]
  const fixture = await startPiSdkFixture({ agentDir, promptGates: { [prompt]: gate },
    responseChunks: { [prompt]: { chunks, intervalMs: 70 } } })
  const app = await electron.launch({ args: [resolve(process.cwd())], env: { ...process.env, ...fixture.env,
    PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' } })
  let previousClipboard: string | undefined
  try {
    const page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await app.evaluate(({ dialog }, path) => { Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true, value: async () => ({ canceled: false, filePaths: [path] }),
    }) }, cwd)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
    const projects = page.getByRole('region', { name: 'Projects', exact: true })
    const long = projects.getByRole('button', { name: 'Performance long', exact: true })
    const short = projects.getByRole('button', { name: 'Performance short', exact: true })
    await expect(long).toBeVisible()
    const switches: number[] = []
    for (const target of [long, short, long]) {
      const start = performance.now()
      await target.click()
      await expect(target).toHaveAttribute('aria-current', 'page')
      await expect(page.locator('[data-conversation-response]')).toHaveCount(target === long ? HISTORY_REPLIES : 1)
      switches.push(performance.now() - start)
    }
    const input = page.getByRole('textbox', { name: 'Message input', exact: true })
    await input.fill(prompt)
    await page.locator('[data-composer-submit]').click()
    await expect(input).toHaveText('')
    const probe = await page.evaluateHandle(() => {
      const frameGaps: number[] = [], inputPaint: number[] = [], longTasks: number[] = []
      let last = performance.now(), active = true, frame = 0
      const tick = (time: number) => { frameGaps.push(time - last); last = time; if (active) frame = requestAnimationFrame(tick) }
      frame = requestAnimationFrame(tick)
      const input = (event: Event) => {
        if (!(event.target instanceof Element) || !event.target.closest('[contenteditable="true"]')) return
        const start = performance.now()
        requestAnimationFrame(() => { setTimeout(() => { inputPaint.push(performance.now() - start) }, 0) })
      }
      document.addEventListener('input', input, true)
      const observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries().map((entry) => entry.duration)))
      observer.observe({ type: 'longtask', buffered: false })
      return { finish() { active = false; cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener('input', input, true); return { frameGaps, inputPaint, longTasks } } }
    })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.start')
    release()
    await expect(page.locator('.conversation-answer-content').last()).toContainText('Live section 0')
    await input.pressSequentially('typing during the live answer', { delay: 80 })
    await expect(input).toHaveText('typing during the live answer')
    await expect(page.locator('.conversation-answer-content').last()).toContainText('PERFORMANCE_RESPONSE_COMPLETE', { timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    const { profile } = await cdp.send('Profiler.stop')
    const profilePath = testInfo.outputPath('renderer.cpuprofile')
    await writeFile(profilePath, JSON.stringify(profile))
    await testInfo.attach('renderer-cpu-profile', { path: profilePath, contentType: 'application/json' })
    const measurements = await probe.evaluate((value) => value.finish())
    const stats = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return {
      count: values.length, p50: sorted[Math.floor(sorted.length * .5)] ?? 0, p95: sorted[Math.floor(sorted.length * .95)] ?? 0, max: sorted[sorted.length - 1] ?? 0,
    } }
    const metrics = { historyReplies: HISTORY_REPLIES, liveBytes: Buffer.byteLength(liveMarkdown),
      inputToPaintMs: stats(measurements.inputPaint), frameGapMs: stats(measurements.frameGaps), longTasks: stats(measurements.longTasks), switchMs: switches }
    console.log('RENDERER_PERFORMANCE', JSON.stringify(metrics))
    const metricsPath = testInfo.outputPath('renderer-performance.json')
    await writeFile(metricsPath, JSON.stringify(metrics, null, 2))
    await testInfo.attach('renderer-performance', { path: metricsPath, contentType: 'application/json' })
    // Timing is reported rather than asserted against machine-dependent thresholds.
    expect(measurements.inputPaint.length).toBeGreaterThan(10)
    const answer = page.locator('.conversation-answer-content').last()
    await expect(answer.locator('table')).toHaveCount(110)
    await expect(answer.getByRole('link', { name: 'the shared reference', exact: true })).toHaveCount(110)
    await expect(answer.getByRole('link', { name: 'the shared reference', exact: true }).first()).toHaveAttribute('href', 'https://example.com/reference')
    const viewport = page.getByRole('log', { name: 'Conversation', exact: true }).locator('.overflow-y-auto').first()
    await expect.poll(() => viewport.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(4)
    previousClipboard = await app.evaluate(({ clipboard }) => clipboard.readText())
    await page.locator('[data-conversation-response]').last().getByRole('button', { name: 'Copy response', exact: true }).click()
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe(liveMarkdown)
    await page.getByRole('button', { name: 'Navigate conversation', exact: true }).click()
    const navigation = page.getByRole('dialog', { name: 'Navigate conversation', exact: true })
    await navigation.getByRole('combobox', { name: 'Find a turn…', exact: true }).fill('Performance long question 0')
    await navigation.locator('[data-conversation-navigation-entry="Performance-long-0"]').click()
    await expect(page.locator('[data-conversation-outline-entry="Performance-long-0"]')).toHaveAttribute('data-outline-highlighted', 'true')
    await expect(page.getByRole('button', { name: 'Jump to latest', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Jump to latest', exact: true }).click()
    await expect.poll(() => viewport.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(4)
    expect(errors).toEqual([])
    await input.fill('')
  } finally {
    release()
    if (previousClipboard !== undefined) await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), previousClipboard).catch(() => {})
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
