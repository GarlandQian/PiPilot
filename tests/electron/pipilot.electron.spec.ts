import { execFile } from 'node:child_process'
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
} from '@playwright/test'
import {
  MIN_WINDOW_SIZE,
  normalizeWindowBounds,
} from '../../src/main/windows/window-state'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'

const execFileAsync = promisify(execFile)

async function selectWorkspaceFromSystemDialog(
  electronApp: ElectronApplication,
  workspacePath: string,
) {
  await electronApp.evaluate(({ dialog }, selectedPath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      writable: true,
      value: async () => ({ canceled: false, filePaths: [selectedPath] }),
    })
  }, workspacePath)
}

test('waits for renderer subscriptions before starting configured Pi', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const userDataPath = testInfo.outputPath('user-data')
  const fakeAgentDir = testInfo.outputPath('pi-agent')
  await mkdir(userDataPath, { recursive: true })
  await writeFile(
    join(userDataPath, 'settings.json'),
    `${JSON.stringify({
      version: SETTINGS_SCHEMA_VERSION,
      settings: {
        ...DEFAULT_SETTINGS,
        locale: 'en-US',
      },
    }, null, 2)}\n`,
  )
  const piFixture = await startPiSdkFixture({ agentDir: fakeAgentDir })

  const electronApp = await electron.launch({
    args: [resolve(process.cwd())],
    env: {
      ...process.env,
      ...piFixture.env,
      PIPILOT_E2E_STARTUP_SURFACES: '1',
      PIPILOT_E2E_USER_DATA: userDataPath,
    },
  })
  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect.poll(async () => {
      const status = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
      if (status.state === 'error' || status.state === 'crashed') {
        throw new Error(`Pi Runtime startup failed: ${JSON.stringify(status)}`)
      }
      return status.state
    }).toBe('ready')
    await expect(page.evaluate(() => window.pipilot!.localPi.runtime.status()))
      .resolves.toMatchObject({ generation: 1 })
    const notificationButton = page.getByRole('button', {
      name: /^Notifications/,
    })
    await notificationButton.click()
    await expect(page.getByText('Startup fixture notification', { exact: true }))
      .toBeVisible()
    await expect(page.getByText(/Startup fixture widget/)).toBeVisible()
    await expect(page.getByText(/startup: ready/)).toBeVisible()
    await notificationButton.click()
    await expect(page).toHaveTitle('Startup fixture title')
    await expect(page.getByRole('textbox', { name: 'Message input' }))
      .toHaveText('startup extension draft')

    const runtimeBeforeRemountHandshake = await page.evaluate(() =>
      window.pipilot!.localPi.runtime.status())
    await page.evaluate(async () => {
      await Promise.all([
        window.pipilot!.localPi.runtime.rendererReady(),
        window.pipilot!.localPi.runtime.rendererReady(),
      ])
    })
    await expect(page.evaluate(() => window.pipilot!.localPi.runtime.status()))
      .resolves.toMatchObject({
        generation: runtimeBeforeRemountHandshake.generation,
        sessionFile: runtimeBeforeRemountHandshake.sessionFile,
        state: 'ready',
      })
  } finally {
    await electronApp.close()
    await piFixture.close()
  }
})

test('keeps the active Session ready after the official write result omits details', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const userDataPath = testInfo.outputPath('user-data')
  const fakeAgentDir = testInfo.outputPath('pi-agent')
  const writeTarget = testInfo.outputPath('workspace', 'official-write.txt')
  const writePrompt = 'exercise the official write result projection'
  const followUpPrompt = 'continue after the official write result'
  const writeContent = 'PiPilot write projection regression\n'
  await Promise.all([
    mkdir(userDataPath, { recursive: true }),
    mkdir(testInfo.outputPath('workspace'), { recursive: true }),
  ])
  await writeFile(
    join(userDataPath, 'settings.json'),
    `${JSON.stringify({
      version: SETTINGS_SCHEMA_VERSION,
      settings: {
        ...DEFAULT_SETTINGS,
        locale: 'en-US',
      },
    }, null, 2)}\n`,
  )
  const piFixture = await startPiSdkFixture({
    agentDir: fakeAgentDir,
    writeToolPrompts: {
      [writePrompt]: { path: writeTarget, content: writeContent },
    },
  })
  const electronApp = await electron.launch({
    args: [resolve(process.cwd())],
    env: {
      ...process.env,
      ...piFixture.env,
      PIPILOT_E2E_DISABLE_AUTO_RESTART: '1',
      PIPILOT_E2E_USER_DATA: userDataPath,
    },
  })

  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const composer = page.getByRole('textbox', { name: 'Message input' })
    await expect.poll(async () => (
      await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    ).state).toBe('ready')
    const before = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    expect(before.sessionState?.sessionId).toEqual(expect.any(String))

    await composer.fill(writePrompt)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(
      () => readFile(writeTarget, 'utf8').catch(() => ''),
      { timeout: 20_000 },
    ).toBe(writeContent)
    await expect(page.getByText(
      `Fixture response: ${writePrompt}`,
      { exact: true },
    )).toBeVisible({ timeout: 20_000 })
    await expect.poll(async () => {
      const runtime = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
      return {
        isStreaming: runtime.sessionState?.isStreaming,
        sessionId: runtime.sessionState?.sessionId,
        state: runtime.state,
      }
    }).toEqual({
      isStreaming: false,
      sessionId: before.sessionState?.sessionId,
      state: 'ready',
    })
    const afterWrite = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    expect(afterWrite.sessionFile).toEqual(expect.any(String))
    await expect(page.getByText('No session selected', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Operation failed', { exact: true })).toHaveCount(0)
    expect(piFixture.prompts.filter((prompt) => prompt === writePrompt)).toHaveLength(2)

    await composer.fill(followUpPrompt)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByText(
      `Fixture response: ${followUpPrompt}`,
      { exact: true },
    )).toBeVisible({ timeout: 20_000 })
    await expect(page.evaluate(() => window.pipilot!.localPi.runtime.status()))
      .resolves.toMatchObject({
        state: 'ready',
        sessionFile: afterWrite.sessionFile,
        sessionState: {
          isStreaming: false,
          sessionId: before.sessionState?.sessionId,
        },
      })
    await expect(page.getByText('No session selected', { exact: true })).toHaveCount(0)
    expect(piFixture.prompts).toContain(followUpPrompt)
  } finally {
    await electronApp.close()
    await piFixture.close()
  }
})

test('releases prompt acceptance after authoritative progress without allowing a double submit', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const userDataPath = testInfo.outputPath('user-data')
  const fakeAgentDir = testInfo.outputPath('pi-agent')
  const doubleSubmitPrompt = 'double submit acceptance guard'
  const afterCommandPrompt = 'prompt after immediate extension command'
  const streamingPrompt = 'stream while accepting follow-up'
  const followUpPrompt = 'queued while first prompt streams'
  await mkdir(userDataPath, { recursive: true })
  await writeFile(
    join(userDataPath, 'settings.json'),
    `${JSON.stringify({
      version: SETTINGS_SCHEMA_VERSION,
      settings: {
        ...DEFAULT_SETTINGS,
        locale: 'en-US',
      },
    }, null, 2)}\n`,
  )
  const piFixture = await startPiSdkFixture({
    agentDir: fakeAgentDir,
    promptDelays: { [streamingPrompt]: 2_000 },
  })
  const electronApp = await electron.launch({
    args: [resolve(process.cwd())],
    env: {
      ...process.env,
      ...piFixture.env,
      PIPILOT_E2E_ACCEPTANCE_DELAY_PROMPT: doubleSubmitPrompt,
      PIPILOT_E2E_ACCEPTANCE_DELAY_MS: '500',
      PIPILOT_E2E_USER_DATA: userDataPath,
    },
  })

  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const composer = page.getByRole('textbox', { name: 'Message input' })
    const sendButton = page.getByRole('button', { name: 'Send', exact: true })
    await expect.poll(async () => (
      await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    ).state).toBe('ready')

    await composer.fill('/fixture-options-command r')
    const argumentMenu = page.locator(
      '[data-slot="command"][aria-label="Command options"]',
    )
    await expect(argumentMenu).toBeVisible()
    await expect(argumentMenu.getByText('Options', { exact: true })).toBeVisible()
    await expect(argumentMenu.getByText('Resume', { exact: true })).toBeVisible()
    await expect(argumentMenu.getByText('Restart', { exact: true })).toBeVisible()
    await composer.press('Home')
    await composer.press('Enter')
    await expect(composer).toHaveText('/fixture-options-command resume')
    await expect(argumentMenu).toBeHidden()
    await composer.fill('')

    await composer.fill('/fixture-command')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(composer).toHaveText('')
    await expect(page.getByText('Fixture command ran', { exact: true }))
      .toBeVisible({ timeout: 20_000 })
    await page.keyboard.press('Escape')
    await expect(page.getByText('Fixture command ran', { exact: true })).toBeHidden()
    await page.waitForTimeout(150)
    await expect(page.getByText('Fixture command ran', { exact: true })).toBeHidden()

    await composer.fill(doubleSubmitPrompt)
    await expect(sendButton).toBeEnabled({ timeout: 20_000 })
    await composer.press('Enter')
    await composer.press('Enter')
    await expect.poll(() => piFixture.prompts.filter(
      (prompt) => prompt === doubleSubmitPrompt,
    ).length).toBe(1)
    await expect(page.getByText(
      `Fixture response: ${doubleSubmitPrompt}`,
      { exact: true },
    )).toBeVisible({ timeout: 20_000 })

    await composer.fill('/fixture-silent-command')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(composer).toHaveText('')
    await composer.fill(afterCommandPrompt)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => piFixture.prompts.includes(afterCommandPrompt)).toBe(true)
    await expect(page.getByText(
      `Fixture response: ${afterCommandPrompt}`,
      { exact: true },
    )).toBeVisible({ timeout: 20_000 })

    await composer.fill(streamingPrompt)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await composer.fill(followUpPrompt)
    await page.getByRole('button', { name: 'Queue', exact: true }).click()
    await expect.poll(() => piFixture.prompts.includes(followUpPrompt), {
      timeout: 20_000,
    }).toBe(true)
    await expect(page.getByText('Pi is still accepting the previous prompt.'))
      .toHaveCount(0)
  } finally {
    await electronApp.close()
    await piFixture.close()
  }
})

test('keeps rich-editor text and images visible across Steer, Follow-up, and queue promotion', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const userDataPath = testInfo.outputPath('user-data')
  const fakeAgentDir = testInfo.outputPath('pi-agent')
  const runningPrompt = 'hold the turn while queue payloads are inspected'
  const steerText = 'steer with this exact screenshot context'
  const followUpText = 'queue this screenshot for the next turn'
  const pixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=',
    'base64',
  )
  await mkdir(userDataPath, { recursive: true })
  await writeFile(
    join(userDataPath, 'settings.json'),
    `${JSON.stringify({
      version: SETTINGS_SCHEMA_VERSION,
      settings: { ...DEFAULT_SETTINGS, locale: 'en-US' },
    }, null, 2)}\n`,
  )
  const piFixture = await startPiSdkFixture({
    agentDir: fakeAgentDir,
    promptDelays: { [runningPrompt]: 15_000 },
  })
  const electronApp = await electron.launch({
    args: [resolve(process.cwd())],
    env: {
      ...process.env,
      ...piFixture.env,
      PIPILOT_E2E_USER_DATA: userDataPath,
    },
  })

  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect.poll(async () => (
      await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    ).state).toBe('ready')
    const composer = page.getByRole('textbox', { name: 'Message input' })
    const fileInput = page.locator('input[type="file"]')

    await composer.fill(runningPrompt)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()

    await fileInput.setInputFiles({
      name: 'steer.png',
      mimeType: 'image/png',
      buffer: pixelPng,
    })
    const pendingSteerImage = page.getByRole('button', {
      name: 'Remove image steer.png',
      exact: true,
    })
    await page.getByRole('button', { name: 'Queue', exact: true }).click()
    await expect(page.getByText('Add text before queuing or steering images.', { exact: true }))
      .toBeVisible()
    await expect(pendingSteerImage).toBeAttached()

    await composer.fill(steerText)
    await page.getByRole('button', { name: 'More submit actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Steer current task', exact: true }).click()
    await expect(composer).toHaveText('')
    await expect(pendingSteerImage).toHaveCount(0)
    const onePending = page.getByRole('button', {
      name: 'View 1 pending messages',
      exact: true,
    })
    await expect(onePending).toBeVisible()
    await onePending.click()
    let queuePopover = page.locator('[data-slot="popover-content"]')
    await expect(queuePopover.getByText(steerText, { exact: true })).toBeVisible()
    await expect(queuePopover.getByRole('img', { name: 'Queued image 1', exact: true }))
      .toHaveAttribute('src', `data:image/png;base64,${pixelPng.toString('base64')}`)

    await composer.fill(followUpText)
    await fileInput.setInputFiles({
      name: 'follow-up.png',
      mimeType: 'image/png',
      buffer: pixelPng,
    })
    await page.getByRole('button', { name: 'Queue', exact: true }).click()
    const twoPending = page.getByRole('button', {
      name: 'View 2 pending messages',
      exact: true,
    })
    await expect(twoPending).toBeVisible()
    await twoPending.click()
    queuePopover = page.locator('[data-slot="popover-content"]')
    const queuedRow = queuePopover.getByRole('listitem').filter({ hasText: followUpText })
    await expect(queuedRow).toBeVisible()
    await expect(queuedRow.getByRole('img', { name: 'Queued image 1', exact: true }))
      .toBeVisible()
    await queuedRow.getByRole('button', { name: 'Move to Steer', exact: true }).click()
    await expect(queuedRow.getByRole('button', { name: 'Move to Steer', exact: true }))
      .toHaveCount(0)
    const steerSection = queuePopover.locator('section').filter({
      has: page.getByRole('heading', { name: 'Steer', exact: true }),
    })
    await expect(steerSection).toContainText(steerText)
    await expect(steerSection).toContainText(followUpText)
    await expect(steerSection.locator('[data-queue-image]')).toHaveCount(2)
  } finally {
    await electronApp.close()
    await piFixture.close()
  }
})

test('keeps active Pi work running when the main window closes to the tray', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const userDataPath = testInfo.outputPath('user-data')
  const fakeAgentDir = testInfo.outputPath('pi-agent')
  const prompt = 'continue while the window is hidden'
  await mkdir(userDataPath, { recursive: true })
  await writeFile(
    join(userDataPath, 'settings.json'),
    `${JSON.stringify({
      version: SETTINGS_SCHEMA_VERSION,
      settings: {
        ...DEFAULT_SETTINGS,
        locale: 'en-US',
      },
    }, null, 2)}\n`,
  )
  const piFixture = await startPiSdkFixture({
    agentDir: fakeAgentDir,
    promptDelays: { [prompt]: 2_500 },
  })
  const electronApp = await electron.launch({
    args: [resolve(process.cwd())],
    env: {
      ...process.env,
      ...piFixture.env,
      PIPILOT_E2E_USER_DATA: userDataPath,
    },
  })

  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect.poll(async () => (
      await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    ).state).toBe('ready')
    const before = await page.evaluate(() => window.pipilot!.localPi.runtime.status())

    await page.evaluate((message) => {
      void window.pipilot!.localPi.runtime.command({ type: 'prompt', message })
    }, prompt)
    await expect.poll(() => piFixture.prompts.includes(prompt)).toBe(true)

    const hidden = await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.close()
      return {
        destroyed: window.isDestroyed(),
        visible: window.isVisible(),
      }
    })
    expect(hidden).toEqual({ destroyed: false, visible: false })

    await expect.poll(async () => (
      await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    ).sessionState?.isStreaming).toBe(false)
    const after = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    expect(after).toMatchObject({
      state: 'ready',
      sessionState: { sessionId: before.sessionState?.sessionId },
    })

    await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.show()
      window.focus()
    })
    await expect(page.getByText(`Fixture response: ${prompt}`, { exact: true }))
      .toBeVisible()
  } finally {
    await electronApp.close()
    await piFixture.close()
  }
})

test('recovers a projectless Pi Host after a one-shot fatal extension shutdown', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const userDataPath = testInfo.outputPath('user-data')
  const fakeAgentDir = testInfo.outputPath('pi-agent')
  const failureMarker = testInfo.outputPath('host-failure.marker')
  await mkdir(userDataPath, { recursive: true })
  await writeFile(
    join(userDataPath, 'settings.json'),
    `${JSON.stringify({
      version: SETTINGS_SCHEMA_VERSION,
      settings: {
        ...DEFAULT_SETTINGS,
        locale: 'en-US',
      },
    }, null, 2)}\n`,
  )
  const piFixture = await startPiSdkFixture({ agentDir: fakeAgentDir })
  const electronApp = await electron.launch({
    args: [resolve(process.cwd())],
    env: {
      ...process.env,
      ...piFixture.env,
      PIPILOT_E2E_HOST_FAILURE_MARKER: failureMarker,
      PIPILOT_E2E_USER_DATA: userDataPath,
    },
  })

  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect.poll(async () => (
      await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    ).state).toBe('ready')

    const before = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    await page.evaluate(async () => {
      await window.pipilot!.localPi.runtime.command({
        type: 'prompt',
        message: '/fixture-host-failure',
      }).catch(() => undefined)
    })
    await expect.poll(async () => (
      await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    ).state).toBe('crashed')

    const recovery = await page.evaluate(async () => {
      try {
        await window.pipilot!.localPi.runtime.command({ type: 'abort' })
        return {
          ok: true as const,
          snapshot: await window.pipilot!.localPi.runtime.status(),
        }
      } catch (error) {
        return { ok: false as const, error }
      }
    })
    if (!recovery.ok) throw new Error(JSON.stringify(recovery.error))
    expect(recovery).toMatchObject({ ok: true })
    const recovered = recovery.snapshot
    expect(recovered).toMatchObject({
      state: 'ready',
      sessionFile: before.sessionFile,
      sessionState: {
        isStreaming: false,
      },
    })
    expect(recovered.generation).toBeGreaterThanOrEqual(before.generation)

    const continuation = 'Continue after recovered abort.'
    await page.evaluate(async (message) => {
      await window.pipilot!.localPi.runtime.command({ type: 'prompt', message })
    }, continuation)
    await expect(page.getByText(`Fixture response: ${continuation}`, { exact: true }))
      .toBeVisible()
  } finally {
    await electronApp.close()
    await piFixture.close()
  }
})

test('gates Files, Changes, and Conversation outline when no session is selected', async ({}, testInfo) => {
  test.setTimeout(30_000)
  const userDataPath = testInfo.outputPath('user-data')
  await mkdir(userDataPath, { recursive: true })
  await writeFile(
    join(userDataPath, 'settings.json'),
    `${JSON.stringify({
      version: SETTINGS_SCHEMA_VERSION,
      settings: {
        ...DEFAULT_SETTINGS,
        locale: 'en-US',
      },
    }, null, 2)}\n`,
  )

  const electronApp = await electron.launch({
    args: [resolve(process.cwd())],
    env: {
      ...process.env,
      PIPILOT_E2E_USER_DATA: userDataPath,
    },
  })
  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const inspector = page.getByRole('complementary', { name: 'Inspector' })
    for (const tab of ['Files', 'Changes', 'Conversation outline']) {
      await inspector.getByRole('tab', { name: tab, exact: true }).click()
      await expect(inspector.getByText('No Pi session selected', { exact: true }))
        .toBeVisible()
    }
    await expect(inspector.getByText('Working tree', { exact: true })).toHaveCount(0)
  } finally {
    await electronApp.close()
  }
})

test('navigates from the outline and inserts file-tree references into the composer', async ({}, testInfo) => {
  test.setTimeout(45_000)
  const userDataPath = testInfo.outputPath('user-data')
  const workspacePath = testInfo.outputPath('workspace')
  const fakeAgentDir = testInfo.outputPath('pi-agent')
  await mkdir(join(workspacePath, 'src'), { recursive: true })
  await mkdir(userDataPath, { recursive: true })
  await writeFile(join(workspacePath, 'src', 'example.ts'), 'export const example = true\n')
  await writeFile(
    join(userDataPath, 'settings.json'),
    `${JSON.stringify({
      version: SETTINGS_SCHEMA_VERSION,
      settings: {
        ...DEFAULT_SETTINGS,
        locale: 'en-US',
      },
    }, null, 2)}\n`,
  )

  const canonicalWorkspacePath = await realpath(workspacePath)
  const encodedWorkspacePath = `--${canonicalWorkspacePath
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}--`
  const selectedSessionDirectory = join(
    fakeAgentDir,
    'sessions',
    encodedWorkspacePath,
  )
  const selectedSessionFile = join(selectedSessionDirectory, 'fake.jsonl')
  const sessionTimestamp = '2026-08-09T00:00:00.000Z'
  await mkdir(selectedSessionDirectory, { recursive: true })
  await writeFile(selectedSessionFile, [
    {
      type: 'session',
      version: 3,
      id: 'fake-session',
      timestamp: sessionTimestamp,
      cwd: canonicalWorkspacePath,
    },
    {
      type: 'message',
      id: '00000000-0000-4000-8000-000000000101',
      parentId: null,
      timestamp: sessionTimestamp,
      message: {
        role: 'user',
        content: 'Selected session history prompt',
        timestamp: Date.parse(sessionTimestamp),
      },
    },
    {
      type: 'message',
      id: '00000000-0000-4000-8000-000000000103',
      parentId: '00000000-0000-4000-8000-000000000101',
      timestamp: '2026-08-09T00:00:01.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Selected session history response' }],
        api: 'openai-completions',
        provider: 'fixture',
        model: 'fake-chat',
        usage: {
          input: 12,
          output: 8,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 20,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.parse('2026-08-09T00:00:01.000Z'),
      },
    },
    {
      type: 'session_info',
      id: '00000000-0000-4000-8000-000000000102',
      parentId: '00000000-0000-4000-8000-000000000103',
      timestamp: sessionTimestamp,
      name: 'Existing project session',
    },
  ].map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  const piFixture = await startPiSdkFixture({ agentDir: fakeAgentDir })

  const electronApp = await electron.launch({
    args: [resolve(process.cwd())],
    env: {
      ...process.env,
      ...piFixture.env,
      PIPILOT_E2E_DISABLE_AUTO_RESTART: '1',
      PIPILOT_E2E_USER_DATA: userDataPath,
    },
  })
  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await selectWorkspaceFromSystemDialog(electronApp, workspacePath)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
    const projectSession = page.getByRole('button', {
      name: 'Existing project session',
      exact: true,
    })
    await expect(projectSession).toBeVisible()
    await projectSession.click()
    await expect(page.getByText('Selected session history response', { exact: true }))
      .toBeVisible()

    const inspector = page.getByRole('complementary', { name: 'Inspector' })
    const composer = page.getByRole('textbox', { name: 'Message input' })
    const promptsBeforeInspectorMentions = [...piFixture.prompts]
    const sourceFolder = inspector.getByRole('button').filter({ hasText: /^src$/u })
    await expect(sourceFolder).toBeVisible()
    await expect(sourceFolder).toHaveAttribute('aria-expanded', 'false')
    await sourceFolder.click({ button: 'right' })
    const addToComposerItem = page.getByRole('menuitem', { name: 'Add to composer' })
    await expect(addToComposerItem).toBeVisible()
    await addToComposerItem.click()
    await expect(composer).toBeFocused()
    await expect(page.locator('[data-composer-mention-kind="directory"]')).toHaveCount(1)
    await expect(composer).toContainText('@src/')
    await expect(sourceFolder).toHaveAttribute('aria-expanded', 'false')
    expect(piFixture.prompts).toEqual(promptsBeforeInspectorMentions)

    await sourceFolder.click()
    const sourceFile = inspector.getByRole('button').filter({ hasText: /^example\.ts$/u })
    await expect(sourceFile).toBeVisible()
    await sourceFile.click({ button: 'right' })
    await expect(addToComposerItem).toBeVisible()
    await addToComposerItem.click()
    await expect(composer).toBeFocused()
    await expect(page.locator('[data-composer-mention-kind="file"]')).toHaveCount(1)
    await expect(composer).toContainText('@src/example.ts')
    await expect(inspector.getByRole('region', { name: 'src/example.ts' })).toHaveCount(0)

    await sourceFile.click({ button: 'right' })
    await addToComposerItem.click()
    await expect(page.locator('[data-composer-mention-kind="file"]')).toHaveCount(1)
    expect(piFixture.prompts).toEqual(promptsBeforeInspectorMentions)

    await composer.click()
    await composer.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await composer.press('Backspace')
    await expect(page.locator('[data-composer-mention-kind]')).toHaveCount(0)
    await expect(composer).toHaveText('')
    await composer.type('@draft')
    await expect(composer).toHaveAttribute('aria-expanded', 'true')
    await sourceFile.click({ button: 'right' })
    await addToComposerItem.click()
    await expect(composer).toHaveText('@src/example.ts')
    await expect(page.locator('[data-composer-mention-kind="file"]')).toHaveCount(1)

    await composer.click()
    await composer.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await composer.press('Backspace')
    await composer.type('draft')
    await sourceFile.click({ button: 'right' })
    await addToComposerItem.click()
    await expect(composer).toHaveText('draft @src/example.ts')
    await expect(page.locator('[data-composer-mention-kind="file"]')).toHaveCount(1)

    await composer.click()
    await composer.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await composer.press('Backspace')
    await composer.type('@draft')
    await expect(composer).toHaveAttribute('aria-expanded', 'true')
    await composer.press('Escape')
    await expect(composer).toHaveAttribute('aria-expanded', 'false')
    await sourceFile.click({ button: 'right' })
    await addToComposerItem.click()
    await expect(composer).toHaveText('@draft @src/example.ts')
    await expect(page.locator('[data-composer-mention-kind="file"]')).toHaveCount(1)

    await sourceFile.focus()
    await sourceFile.press('ContextMenu')
    await expect(addToComposerItem).toBeVisible()
    await expect(addToComposerItem).toBeFocused()
    await addToComposerItem.press('Enter')
    await expect(composer).toBeFocused()
    await expect(composer).toHaveText('@draft @src/example.ts')
    await expect(page.locator('[data-composer-mention-kind="file"]')).toHaveCount(1)

    await sourceFile.focus()
    await sourceFile.press('Shift+F10')
    await expect(addToComposerItem).toBeVisible()
    await expect(addToComposerItem).toBeFocused()
    await addToComposerItem.press('Enter')
    await expect(composer).toBeFocused()
    await expect(composer).toHaveText('@draft @src/example.ts')
    await expect(page.locator('[data-composer-mention-kind="file"]')).toHaveCount(1)
    await expect(inspector.getByRole('region', { name: 'src/example.ts' })).toHaveCount(0)
    expect(piFixture.prompts).toEqual(promptsBeforeInspectorMentions)

    await composer.click()
    await composer.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await composer.press('Backspace')
    await composer.type('review now')
    await composer.press('ArrowLeft')
    await composer.press('ArrowLeft')
    await composer.press('ArrowLeft')
    await sourceFile.click({ button: 'right' })
    await addToComposerItem.click()
    await expect(composer).toHaveText('review @src/example.ts now')
    expect(piFixture.prompts).toEqual(promptsBeforeInspectorMentions)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect.poll(() => piFixture.prompts[piFixture.prompts.length - 1]).toBe(
      'review [@src/example.ts](src/example.ts) now',
    )

    await inspector.getByRole('tab', { name: 'Conversation outline', exact: true }).click()
    const outlineTurn = inspector.getByRole('button', {
      name: /Selected session history prompt/,
    })
    const target = page.locator(
      '[data-conversation-outline-entry="00000000-0000-4000-8000-000000000101"]',
    )
    await expect(outlineTurn).toContainText('Selected session history response')
    await outlineTurn.click()
    await expect(outlineTurn).toBeFocused()
    await expect(target).toHaveAttribute('data-outline-highlighted', 'true')
    await expect(target).not.toHaveAttribute('data-outline-highlighted', 'true', {
      timeout: 3_000,
    })
    await outlineTurn.press('Enter')
    await expect(target).toHaveAttribute('data-outline-highlighted', 'true')
    await expect(target).not.toHaveAttribute('data-outline-highlighted', 'true', {
      timeout: 3_000,
    })
    await outlineTurn.press('Space')
    await expect(target).toHaveAttribute('data-outline-highlighted', 'true')
    await expect(inspector.getByRole('tab', { name: 'Raw history' })).toHaveCount(0)
    await expect(inspector.getByRole('tab', { name: 'Pi shell' })).toHaveCount(0)

    await expect(page.evaluate(() => window.pipilot!.localPi.runtime.command({
      type: 'get_entries',
    }))).resolves.toMatchObject({ success: true, command: 'get_entries' })
  } finally {
    await electronApp.close()
    await piFixture.close()
  }
})

test('restores a populated inactive project and starts a new session from its menu', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const userDataPath = testInfo.outputPath('user-data')
  const workspacePath = testInfo.outputPath('workspace')
  const fakeAgentDir = testInfo.outputPath('pi-agent')
  await Promise.all([
    mkdir(userDataPath, { recursive: true }),
    mkdir(workspacePath, { recursive: true }),
  ])
  await writeFile(
    join(userDataPath, 'settings.json'),
    `${JSON.stringify({
      version: SETTINGS_SCHEMA_VERSION,
      settings: {
        ...DEFAULT_SETTINGS,
        locale: 'en-US',
      },
    }, null, 2)}\n`,
  )

  const canonicalWorkspacePath = await realpath(workspacePath)
  const encodedWorkspacePath = `--${canonicalWorkspacePath
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}--`
  const selectedSessionDirectory = join(
    fakeAgentDir,
    'sessions',
    encodedWorkspacePath,
  )
  const sessionTimestamp = '2026-08-14T00:00:00.000Z'
  await mkdir(selectedSessionDirectory, { recursive: true })
  await writeFile(join(selectedSessionDirectory, 'fake.jsonl'), [
    {
      type: 'session',
      version: 3,
      id: 'project-menu-session',
      timestamp: sessionTimestamp,
      cwd: canonicalWorkspacePath,
    },
    {
      type: 'message',
      id: '00000000-0000-4000-8000-000000000121',
      parentId: null,
      timestamp: sessionTimestamp,
      message: {
        role: 'user',
        content: 'Populated project session preview',
        timestamp: Date.parse(sessionTimestamp),
      },
    },
    {
      type: 'session_info',
      id: '00000000-0000-4000-8000-000000000122',
      parentId: '00000000-0000-4000-8000-000000000121',
      timestamp: sessionTimestamp,
      name: 'Populated project session',
    },
  ].map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  const piFixture = await startPiSdkFixture({ agentDir: fakeAgentDir })

  const launch = () => electron.launch({
    args: [resolve(process.cwd())],
    env: {
      ...process.env,
      ...piFixture.env,
      PIPILOT_E2E_DISABLE_AUTO_RESTART: '1',
      PIPILOT_E2E_USER_DATA: userDataPath,
    },
  })

  const seedApp = await launch()
  try {
    const page = await seedApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await selectWorkspaceFromSystemDialog(seedApp, workspacePath)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
    await expect(page.getByRole('button', {
      name: 'Populated project session',
      exact: true,
    })).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'Quick general chat', exact: true }).click()
    await expect(page.getByRole('button', { name: 'New general chat', exact: true }))
      .toBeVisible()

    await expect.poll(() => page.evaluate(() => {
      const raw = localStorage.getItem('pipilot.layout.project-expansion.v1')
      if (!raw) return false
      const document = JSON.parse(raw) as {
        projects?: Array<{ expanded?: boolean }>
      }
      return document.projects?.some(({ expanded }) => expanded === true) ?? false
    })).toBe(true)
  } finally {
    await seedApp.close()
  }

  const electronApp = await launch()
  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByRole('button', {
      name: 'Populated project session',
      exact: true,
    })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Loading tasks…', { exact: true })).toHaveCount(0)

    const runtimeBefore = await page.evaluate(() => window.pipilot!.localPi.runtime.status())

    const projectActions = page.getByRole('button', {
      name: `Project actions for ${basename(workspacePath)}`,
      exact: true,
    })
    await projectActions.focus()
    await expect(projectActions).toBeFocused()
    await page.keyboard.press('Enter')
    const newSessionItem = page.getByRole('menuitem', { name: 'New session', exact: true })
    await expect(newSessionItem).toBeFocused()
    await page.keyboard.press('Enter')

    await expect.poll(async () => {
      const runtime = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
      return {
        cwd: runtime.cwd,
        sessionId: runtime.sessionState?.sessionId,
        state: runtime.state,
      }
    }).toEqual({
      cwd: canonicalWorkspacePath,
      sessionId: expect.any(String),
      state: 'ready',
    })
    const projectRuntime = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    expect(projectRuntime.sessionState?.sessionId)
      .not.toBe(runtimeBefore.sessionState?.sessionId)

    const composer = page.getByRole('textbox', { name: 'Message input' })
    await expect(composer).toBeEditable()
    await composer.fill('Project menu session is ready')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByText('Fixture response: Project menu session is ready', {
      exact: true,
    })).toBeVisible()
  } finally {
    await electronApp.close()
    await piFixture.close()
  }
})

test('removes an active project without deleting files or stopping its running session', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const userDataPath = testInfo.outputPath('user-data')
  const workspacePath = testInfo.outputPath('workspace')
  const fakeAgentDir = testInfo.outputPath('pi-agent')
  const prompt = 'background survives project removal'
  await Promise.all([
    mkdir(userDataPath, { recursive: true }),
    mkdir(workspacePath, { recursive: true }),
  ])
  await writeFile(join(workspacePath, 'keep.txt'), 'keep project files\n')
  await writeFile(
    join(userDataPath, 'settings.json'),
    `${JSON.stringify({
      version: SETTINGS_SCHEMA_VERSION,
      settings: {
        ...DEFAULT_SETTINGS,
        locale: 'en-US',
      },
    }, null, 2)}\n`,
  )
  const canonicalWorkspacePath = await realpath(workspacePath)
  const piFixture = await startPiSdkFixture({
    agentDir: fakeAgentDir,
    promptDelays: { [prompt]: 2_000 },
  })
  const electronApp = await electron.launch({
    args: [resolve(process.cwd())],
    env: {
      ...process.env,
      ...piFixture.env,
      PIPILOT_E2E_DISABLE_AUTO_RESTART: '1',
      PIPILOT_E2E_USER_DATA: userDataPath,
    },
  })

  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect.poll(async () => (
      await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    ).state).toBe('ready')
    await selectWorkspaceFromSystemDialog(electronApp, workspacePath)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).first().click()

    const projectActions = page.getByRole('button', {
      name: `Project actions for ${basename(workspacePath)}`,
      exact: true,
    })
    await expect(projectActions).toBeVisible({ timeout: 20_000 })
    const composer = page.getByRole('textbox', { name: 'Message input' })
    await expect(composer).toBeEditable()
    await composer.fill(prompt)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop', exact: true }))
      .toBeVisible({ timeout: 20_000 })
    const projectRuntime = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    expect(projectRuntime.cwd).toBe(canonicalWorkspacePath)
    expect(projectRuntime.sessionFile).toEqual(expect.any(String))

    await projectActions.click()
    await page.getByRole('menuitem', { name: 'Remove project', exact: true }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Remove project?' })
    await expect(dialog).toContainText('The project folder and its Pi sessions will remain on disk.')
    await expect(dialog).toContainText('Running background sessions will continue.')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(projectActions).toBeVisible()

    await projectActions.click()
    await page.getByRole('menuitem', { name: 'Remove project', exact: true }).click()
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(projectActions).toHaveCount(0)
    await expect(page.evaluate(() => window.pipilot!.workspace.get()))
      .resolves.toMatchObject({ recent: [] })
    await expect.poll(async () => {
      const runtime = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
      return { cwd: runtime.cwd, state: runtime.state }
    }).toEqual({ cwd: expect.not.stringMatching(canonicalWorkspacePath), state: 'ready' })
    await expect(composer).toBeEditable()
    await expect(page.getByRole('log', { name: 'Conversation' }).getByText(prompt, {
      exact: true,
    })).toHaveCount(0)
    await expect(stat(join(workspacePath, 'keep.txt'))).resolves.toMatchObject({})
    await expect.poll(async () => {
      if (!projectRuntime.sessionFile) return ''
      return readFile(projectRuntime.sessionFile, 'utf8').catch(() => '')
    }, { timeout: 20_000 }).toContain(`Fixture response: ${prompt}`)
  } finally {
    await electronApp.close()
    await piFixture.close()
  }
})

test('opens a persisted project session on the first click while Pi initializes', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const userDataPath = testInfo.outputPath('user-data')
  const workspacePath = testInfo.outputPath('workspace')
  const fakeAgentDir = testInfo.outputPath('pi-agent')
  await Promise.all([
    mkdir(userDataPath, { recursive: true }),
    mkdir(workspacePath, { recursive: true }),
  ])
  await writeFile(
    join(userDataPath, 'settings.json'),
    `${JSON.stringify({
      version: SETTINGS_SCHEMA_VERSION,
      settings: {
        ...DEFAULT_SETTINGS,
        locale: 'en-US',
      },
    }, null, 2)}\n`,
  )

  const canonicalWorkspacePath = await realpath(workspacePath)
  const encodedWorkspacePath = `--${canonicalWorkspacePath
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}--`
  const selectedSessionDirectory = join(
    fakeAgentDir,
    'sessions',
    encodedWorkspacePath,
  )
  const selectedSessionFile = join(selectedSessionDirectory, 'fake.jsonl')
  const secondSessionFile = join(selectedSessionDirectory, 'second.jsonl')
  const sessionTimestamp = '2026-08-10T00:00:00.000Z'
  await mkdir(selectedSessionDirectory, { recursive: true })
  await writeFile(selectedSessionFile, [
    {
      type: 'session',
      version: 3,
      id: 'fake-session',
      timestamp: sessionTimestamp,
      cwd: canonicalWorkspacePath,
    },
    {
      type: 'message',
      id: '00000000-0000-4000-8000-000000000111',
      parentId: null,
      timestamp: sessionTimestamp,
      message: {
        role: 'user',
        content: 'Selected session history prompt',
        timestamp: Date.parse(sessionTimestamp),
      },
    },
    {
      type: 'message',
      id: '00000000-0000-4000-8000-000000000113',
      parentId: '00000000-0000-4000-8000-000000000111',
      timestamp: '2026-08-10T00:00:01.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Selected session history response' }],
        api: 'openai-completions',
        provider: 'fixture',
        model: 'fake-chat',
        usage: {
          input: 12,
          output: 8,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 20,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.parse('2026-08-10T00:00:01.000Z'),
      },
    },
    {
      type: 'custom',
      id: '00000000-0000-4000-8000-000000000114',
      parentId: '00000000-0000-4000-8000-000000000113',
      timestamp: '2026-08-10T00:00:01.500Z',
      customType: 'large-session-regression',
      data: 'x'.repeat(9 * 1_024 * 1_024),
    },
    {
      type: 'session_info',
      id: '00000000-0000-4000-8000-000000000112',
      parentId: '00000000-0000-4000-8000-000000000113',
      timestamp: sessionTimestamp,
      name: 'First click persisted session',
    },
  ].map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  await writeFile(secondSessionFile, [
    {
      type: 'session',
      version: 3,
      id: 'second-session',
      timestamp: '2026-08-10T00:02:00.000Z',
      cwd: canonicalWorkspacePath,
    },
    {
      type: 'message',
      id: '00000000-0000-4000-8000-000000000211',
      parentId: null,
      timestamp: '2026-08-10T00:02:00.000Z',
      message: {
        role: 'user',
        content: `Second session history prompt ${'x'.repeat(2_000)}`,
        timestamp: Date.parse('2026-08-10T00:02:00.000Z'),
      },
    },
    {
      type: 'message',
      id: '00000000-0000-4000-8000-000000000212',
      parentId: '00000000-0000-4000-8000-000000000211',
      timestamp: '2026-08-10T00:02:01.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Second session history response' }],
        api: 'openai-completions',
        provider: 'fixture',
        model: 'fake-chat',
        usage: {
          input: 10,
          output: 6,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 16,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.parse('2026-08-10T00:02:01.000Z'),
      },
    },
    {
      type: 'session_info',
      id: '00000000-0000-4000-8000-000000000213',
      parentId: '00000000-0000-4000-8000-000000000212',
      timestamp: '2026-08-10T00:02:02.000Z',
      name: 'Second persisted session',
    },
  ].map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  const piFixture = await startPiSdkFixture({ agentDir: fakeAgentDir })

  const launch = (startupDelayMs: number) => electron.launch({
    args: [resolve(process.cwd())],
    env: {
      ...process.env,
      ...piFixture.env,
      PIPILOT_E2E_STARTUP_DELAY_MS: String(startupDelayMs),
      PIPILOT_E2E_DISABLE_AUTO_RESTART: '1',
      PIPILOT_E2E_USER_DATA: userDataPath,
    },
  })

  const seedApp = await launch(0)
  try {
    const page = await seedApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await selectWorkspaceFromSystemDialog(seedApp, workspacePath)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
    await expect(page.getByText('Loading tasks…', { exact: true })).toBeHidden({
      timeout: 20_000,
    })
    await expect(page.getByRole('button', {
      name: 'First click persisted session',
      exact: true,
    })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', {
      name: 'Second persisted session',
      exact: true,
    })).toBeVisible({ timeout: 20_000 })
  } finally {
    await seedApp.close()
  }

  const restartedApp = await launch(2_500)
  try {
    const page = await restartedApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const projectSession = page.getByRole('button', {
      name: 'First click persisted session',
      exact: true,
    })
    const secondProjectSession = page.getByRole('button', {
      name: 'Second persisted session',
      exact: true,
    })
    await expect(page.getByText('Loading tasks…', { exact: true })).toBeHidden({
      timeout: 20_000,
    })
    await expect(projectSession).toBeVisible({ timeout: 20_000 })
    await expect(secondProjectSession).toBeVisible({ timeout: 20_000 })
    expect(await page.evaluate(async () =>
      (await window.pipilot!.localPi.runtime.status()).state)).not.toBe('ready')
    await page.evaluate(() => {
      interface SessionTransitionProbe {
        started: boolean
        issues: string[]
        observer?: MutationObserver
      }
      const probeWindow = window as typeof window & {
        __pipilotSessionTransitionProbe?: SessionTransitionProbe
      }
      const visibleExactText = (text: string) =>
        Array.from(document.querySelectorAll<HTMLElement>('body *')).some((element) =>
          element.textContent?.trim() === text &&
          element.getClientRects().length > 0 &&
          window.getComputedStyle(element).visibility !== 'hidden')
      const issues: string[] = []
      const record = (issue: string) => {
        if (!issues.includes(issue)) issues.push(issue)
      }
      const probe: SessionTransitionProbe = {
        started: false,
        issues,
      }
      const inspect = () => {
        const conversationLoading = visibleExactText('Loading conversation…')
        const inspectorLoading = visibleExactText('Loading Pi session data…')
        if (conversationLoading && inspectorLoading) probe.started = true
        if (!probe.started || visibleExactText('Selected session history response')) return
        if (!conversationLoading) record('conversation loading disappeared before ready')
        if (!inspectorLoading) record('inspector loading disappeared before ready')
        if (visibleExactText('No session selected')) record('conversation became empty')
        if (visibleExactText('No Pi session selected')) record('inspector became empty')
      }
      const observer = new MutationObserver(inspect)
      probe.observer = observer
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      probeWindow.__pipilotSessionTransitionProbe = probe
    })
    await projectSession.click()

    await expect(page.getByText('Loading conversation…', { exact: true })).toBeVisible()
    const inspector = page.getByRole('complementary', { name: 'Inspector' })
    await expect(inspector.getByText('Loading Pi session data…', { exact: true }))
      .toBeVisible()

    await expect(page.getByText('Selected session history response', { exact: true }))
      .toBeVisible({ timeout: 20_000 })
    const transition = await page.evaluate(() => {
      const probeWindow = window as typeof window & {
        __pipilotSessionTransitionProbe?: {
          started: boolean
          issues: string[]
          observer?: MutationObserver
        }
      }
      const probe = probeWindow.__pipilotSessionTransitionProbe
      probe?.observer?.disconnect()
      return probe
        ? { started: probe.started, issues: probe.issues }
        : { started: false, issues: ['transition probe was unavailable'] }
    })
    expect(transition.started).toBe(true)
    expect(transition.issues).toEqual([])
    await expect(page.getByText('Loading conversation…', { exact: true })).toHaveCount(0)
    await expect(inspector.getByText('Loading Pi session data…', { exact: true })).toHaveCount(0)
    await expect(page.getByText('No session selected', { exact: true })).toHaveCount(0)
    await expect(inspector.getByText('No Pi session selected', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Operation failed', { exact: true })).toHaveCount(0)

    await expect(page.evaluate(() => window.pipilot!.localPi.runtime.status()))
      .resolves.toMatchObject({
        state: 'ready',
        sessionFile: selectedSessionFile,
        sessionState: { sessionId: 'fake-session' },
      })

    const firstRuntime = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    await page.evaluate(async () => {
      const response = await window.pipilot!.localPi.runtime.command({ type: 'new_session' })
      if (!response.success) throw new Error(response.error)
    })
    await expect.poll(async () => {
      const runtime = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
      return {
        generation: runtime.generation,
        sessionId: runtime.sessionState?.sessionId,
        state: runtime.state,
      }
    }).toEqual({
      generation: expect.any(Number),
      sessionId: expect.not.stringMatching(/^(?:fake-session|second-session)$/),
      state: 'ready',
    })
    const elevatedRuntime = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    expect(elevatedRuntime.generation).toBeGreaterThan(firstRuntime.generation)

    await secondProjectSession.click()
    await expect(page.getByText('Loading conversation…', { exact: true })).toBeVisible()
    await expect(page.getByText('Second session history response', { exact: true }))
      .toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Loading conversation…', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Loading tasks…', { exact: true })).toHaveCount(0)
    await expect(secondProjectSession).toBeEnabled()
    await expect(page.evaluate(() => window.pipilot!.localPi.runtime.status()))
      .resolves.toMatchObject({
        state: 'ready',
        sessionFile: secondSessionFile,
        sessionState: { sessionId: 'second-session' },
      })

    // Re-select the first Session after both Runtimes have been retained. This
    // exercises the cached Runtime path that previously could lose the active
    // conversation when a transient hydration/reconciliation race occurred.
    await projectSession.click()
    await expect(page.getByText('Loading conversation…', { exact: true })).toBeVisible()
    await expect(page.getByText('Selected session history response', { exact: true }))
      .toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Loading conversation…', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Operation failed', { exact: true })).toHaveCount(0)
    await expect(page.evaluate(() => window.pipilot!.localPi.runtime.status()))
      .resolves.toMatchObject({
        state: 'ready',
        sessionFile: selectedSessionFile,
        sessionState: { sessionId: 'fake-session' },
      })
    await page.setViewportSize({ width: 1_024, height: 640 })
    expect(await page.evaluate(() => {
      const visibleMain = Array.from(document.querySelectorAll('main'))
        .find((element) => !(element as HTMLElement).hidden) as HTMLElement | undefined
      const log = document.querySelector<HTMLElement>('[role="log"]')
      const transcriptScroller = log?.querySelector<HTMLElement>('.scroll-slim')
      return {
        documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        mainOverflowX: visibleMain ? getComputedStyle(visibleMain).overflowX : null,
        logOverflowX: log ? getComputedStyle(log).overflowX : null,
        transcriptOverflowX: transcriptScroller
          ? getComputedStyle(transcriptScroller).overflowX
          : null,
      }
    })).toEqual({
      documentFits: true,
      mainOverflowX: 'hidden',
      logOverflowX: 'hidden',
      transcriptOverflowX: 'hidden',
    })
  } finally {
    await restartedApp.close()
    await piFixture.close()
  }
})

test('runs Composer mentions and the local Pi RPC workflow through the renderer provider with conversation outline navigation, session catalog, and session loading', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const userDataPath = testInfo.outputPath('user-data')
  const workspacePath = testInfo.outputPath('workspace')
  const agentDir = testInfo.outputPath('pi-agent')
  const pixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=',
    'base64',
  )
  await Promise.all([
    mkdir(userDataPath, { recursive: true }),
    mkdir(join(workspacePath, 'src'), { recursive: true }),
    mkdir(join(workspacePath, '.pi', 'skills', 'selected-fixture-skill'), {
      recursive: true,
    }),
  ])
  await writeFile(
    join(userDataPath, 'settings.json'),
    `${JSON.stringify({
      version: SETTINGS_SCHEMA_VERSION,
      settings: {
        ...DEFAULT_SETTINGS,
        locale: 'en-US',
      },
    }, null, 2)}\n`,
    'utf8',
  )
  await writeFile(
    join(workspacePath, '.pi', 'skills', 'selected-fixture-skill', 'SKILL.md'),
    '---\nname: selected-fixture-skill\ndescription: Project-scoped real SDK fixture Skill.\n---\n\nUse the selected project fixture.\n',
    'utf8',
  )
  await writeFile(join(workspacePath, 'src', 'example.ts'), 'export const example = true\n')
  await writeFile(
    join(workspacePath, 'README.md'),
    '# Workspace viewer fixture\n\n- rendered Markdown\n',
  )
  await writeFile(
    join(workspacePath, 'src', 'example-with-an-exceptionally-long-component-name.ts'),
    'export const longExample = true\n',
  )
  const continuousDiffPaths = Array.from(
    { length: 12 },
    (_, index) => `src/change-${String(index + 1).padStart(2, '0')}.ts`,
  )
  await Promise.all(continuousDiffPaths.map((path, index) =>
    writeFile(join(workspacePath, path), `export const change${index + 1} = 0\n`)))
  await execFileAsync('git', ['init'], { cwd: workspacePath })
  await execFileAsync('git', ['config', 'user.email', 'pipilot@example.invalid'], {
    cwd: workspacePath,
  })
  await execFileAsync('git', ['config', 'user.name', 'PiPilot fixture'], {
    cwd: workspacePath,
  })
  await execFileAsync('git', ['add', '.'], { cwd: workspacePath })
  await execFileAsync('git', ['commit', '-m', 'fixture baseline'], { cwd: workspacePath })
  await Promise.all(continuousDiffPaths.map((path, index) =>
    writeFile(join(workspacePath, path), `export const change${index + 1} = 1\n`)))
  const canonicalWorkspacePath = await realpath(workspacePath)
  const encodedWorkspacePath = `--${canonicalWorkspacePath
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}--`
  const selectedSessionFile = join(
    agentDir,
    'sessions',
    encodedWorkspacePath,
    'fake.jsonl',
  )
  await mkdir(join(agentDir, 'sessions', encodedWorkspacePath), { recursive: true })
  const sessionTimestamp = '2026-08-09T00:00:00.000Z'
  await writeFile(selectedSessionFile, [
    {
      type: 'session',
      version: 3,
      id: 'real-sdk-session',
      timestamp: sessionTimestamp,
      cwd: canonicalWorkspacePath,
    },
    {
      type: 'message',
      id: '00000000-0000-4000-8000-000000000101',
      parentId: null,
      timestamp: sessionTimestamp,
      message: {
        role: 'user',
        content: 'Selected session history prompt',
        timestamp: Date.parse(sessionTimestamp),
      },
    },
    {
      type: 'message',
      id: '00000000-0000-4000-8000-000000000103',
      parentId: '00000000-0000-4000-8000-000000000101',
      timestamp: '2026-08-09T00:00:01.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Selected session history response' }],
        api: 'openai-completions',
        provider: 'fixture',
        model: 'fake-fast',
        usage: {
          input: 12,
          output: 8,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 20,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
        stopReason: 'stop',
        timestamp: Date.parse('2026-08-09T00:00:01.000Z'),
      },
    },
    {
      type: 'message',
      id: '00000000-0000-4000-8000-000000000105',
      parentId: '00000000-0000-4000-8000-000000000103',
      timestamp: '2026-08-09T00:00:01.100Z',
      message: {
        role: 'user',
        content: 'Delegate the focused renderer review.',
        timestamp: Date.parse('2026-08-09T00:00:01.100Z'),
      },
    },
    {
      type: 'message',
      id: '00000000-0000-4000-8000-000000000106',
      parentId: '00000000-0000-4000-8000-000000000105',
      timestamp: '2026-08-09T00:00:01.200Z',
      message: {
        role: 'assistant',
        content: [{
          type: 'toolCall',
          id: 'fixture-subagent-call',
          name: 'subagent',
          arguments: {
            agent: 'trellis-implement',
            task: 'Active task: .trellis/tasks/private\n\n## Preserve behavior\n\n- Keep the existing contract.\n- Render **Markdown**.',
          },
        }],
        api: 'openai-completions',
        provider: 'fixture',
        model: 'fake-fast',
        usage: {
          input: 8,
          output: 4,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 12,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'toolUse',
        timestamp: Date.parse('2026-08-09T00:00:01.200Z'),
      },
    },
    {
      type: 'message',
      id: '00000000-0000-4000-8000-000000000107',
      parentId: '00000000-0000-4000-8000-000000000106',
      timestamp: '2026-08-09T00:00:01.300Z',
      message: {
        role: 'toolResult',
        toolCallId: 'fixture-subagent-call',
        toolName: 'subagent',
        content: [{
          type: 'text',
          text: 'Run fan-out: 0/64 used, 64 remaining\nAsync workflow [325bb64b-1779-4163-b44c-9179e8092a26]\n\nThe async run is detached and running in the background.\nDo NOT call subagent_wait merely to wait.',
        }],
        details: {
          results: [{
            agent: 'trellis-implement',
            exitCode: 0,
            messages: [
              {
                role: 'assistant',
                content: [{
                  type: 'toolCall',
                  id: 'fixture-subagent-bash',
                  name: 'bash',
                  arguments: { command: 'pnpm test', cwd: '/workspace', timeout: 30_000 },
                }],
              },
              {
                role: 'toolResult',
                toolCallId: 'fixture-subagent-bash',
                toolName: 'bash',
                isError: false,
                content: [{ type: 'text', text: 'Focused checks passed.' }],
              },
              {
                role: 'assistant',
                content: [{ type: 'text', text: '## Done\n\nEverything is green.' }],
              },
            ],
          }],
        },
        isError: false,
        timestamp: Date.parse('2026-08-09T00:00:01.300Z'),
      },
    },
    {
      type: 'message',
      id: '00000000-0000-4000-8000-000000000108',
      parentId: '00000000-0000-4000-8000-000000000107',
      timestamp: '2026-08-09T00:00:01.400Z',
      message: {
        role: 'bashExecution',
        command: 'pnpm test',
        output: '## Checks\n\n- All checks passed.\n- Markdown output.',
        exitCode: 0,
        cancelled: false,
        truncated: false,
        timestamp: Date.parse('2026-08-09T00:00:01.400Z'),
      },
    },
    {
      type: 'model_change',
      id: '00000000-0000-4000-8000-000000000104',
      parentId: '00000000-0000-4000-8000-000000000108',
      timestamp: '2026-08-09T00:00:02.000Z',
      provider: 'fixture',
      modelId: 'fake-fast',
    },
    {
      type: 'session_info',
      id: '00000000-0000-4000-8000-000000000102',
      parentId: '00000000-0000-4000-8000-000000000104',
      timestamp: '2026-08-09T00:00:03.000Z',
      name: 'Existing project session',
    },
  ].map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  const canonicalSelectedSessionFile = await realpath(selectedSessionFile)
  const typewriterPrompt = `typewriter ${'x'.repeat(240)}`
  const typewriterResponse = `Fixture response: ${typewriterPrompt}`
  const thinkingPrompt = 'thinking lifecycle'
  const piFixture = await startPiSdkFixture({
    agentDir,
    promptDelays: {
      hold: 10_000,
      'background hold': 30_000,
      'accepted revision': 750,
    },
    reasoningDelays: {
      [thinkingPrompt]: 750,
    },
  })

  const electronApp = await electron.launch({
    args: [resolve(process.cwd())],
    env: {
      ...process.env,
      ...piFixture.env,
      PIPILOT_E2E_DISABLE_AUTO_RESTART: '1',
      PIPILOT_E2E_STARTUP_DELAY_MS: '1200',
      PIPILOT_E2E_UI_SURFACES: '1',
      PIPILOT_E2E_USER_DATA: userDataPath,
    },
  })
  let clipboardBefore: string | undefined

  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    clipboardBefore = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    await page.evaluate(() => window.pipilot!.settings.update({ locale: 'en-US' }))

    await expect(page.getByRole('button', {
      name: 'Current model Fake Chat, click to switch',
    })).toBeVisible({ timeout: 20_000 })
    await expect.poll(() => page.evaluate(() => (
      window.pipilot!.localPi.runtime.status()
    ))).toMatchObject({
      state: 'ready',
      sessionState: {
        model: { provider: 'fixture', id: 'fake-chat' },
      },
    })

    await page.getByRole('button', {
      name: 'Current model Fake Chat, click to switch',
    }).click()
    await page.getByRole('option', { name: /Fake Fast/ }).click()
    await expect(page.getByRole('button', {
      name: 'Current model Fake Fast, click to switch',
    })).toBeVisible()
    await expect.poll(() => page.evaluate(() => (
      window.pipilot!.localPi.runtime.command({ type: 'get_state' })
    ))).toMatchObject({
      success: true,
      command: 'get_state',
      data: {
        model: { provider: 'fixture', id: 'fake-fast' },
      },
    })

    const composer = page.getByRole('textbox', { name: 'Message input' })
    const mentionMenu = page.locator('[data-slot="command"][aria-label="Files and Skills"]')
    const slashMenu = page.locator('[data-slot="command"][aria-label="Slash commands"]')
    const mentionAtoms = page.locator('[data-composer-mention-kind]')
    const shortcutModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

    await composer.fill('@')
    await expect(mentionMenu).toBeVisible()
    await expect(mentionMenu.getByText('Files', { exact: true })).toHaveCount(0)
    await expect(mentionMenu.getByText('Skills', { exact: true })).toBeVisible()
    await expect(mentionMenu.getByRole('option').filter({ hasText: 'fixture-skill' }))
      .toBeVisible()
    await expect(composer).toHaveAttribute('aria-expanded', 'true')
    const activeMentionOptionId = await composer.getAttribute('aria-activedescendant')
    expect(activeMentionOptionId).toBeTruthy()
    await expect(page.locator(`[id="${activeMentionOptionId}"]`)).toHaveCount(1)
    const mentionListbox = mentionMenu.getByRole('listbox')
    await expect(composer).toHaveAttribute('aria-controls', 'composer-mention-listbox')
    await expect(mentionListbox).toHaveAttribute('id', 'composer-mention-listbox')
    await composer.press('Escape')
    await expect(mentionMenu).toHaveCount(0)
    await expect(composer).toHaveText('@')
    await expect(composer).toHaveAttribute('aria-expanded', 'false')
    await composer.fill('')

    await composer.fill('first line')
    await composer.press('Shift+Enter')
    await composer.pressSequentially('@')
    await expect(mentionMenu).toBeVisible()
    await composer.press('Escape')
    await composer.fill('')

    await composer.fill('/fixture-command ')
    await composer.pressSequentially('@fixture')
    await expect(mentionMenu).toBeVisible()
    const conflictingSkillOption = mentionMenu.getByRole('option')
      .filter({ hasText: 'fixture-skill' })
    await expect(conflictingSkillOption).toHaveAttribute('aria-disabled', 'true')
    await expect(conflictingSkillOption).toContainText(
      'Remove the slash command or selected Skill before combining them.',
    )
    await expect(page.locator('[data-composer-mention-kind="skill"]')).toHaveCount(0)
    await composer.press('Escape')
    await expect(composer).toHaveText('/fixture-command @fixture')
    await composer.fill('')

    await composer.evaluate((element) => {
      element.dispatchEvent(new CompositionEvent('compositionstart', {
        bubbles: true,
        data: '',
      }))
    })
    await page.keyboard.insertText('@fixture')
    await expect(mentionMenu).toHaveCount(0)
    await composer.evaluate((element) => {
      element.dispatchEvent(new CompositionEvent('compositionend', {
        bubbles: true,
        data: '@fixture',
      }))
    })
    await composer.fill('')

    await composer.fill('composition submit guard')
    await composer.dispatchEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Enter',
      key: 'Enter',
      keyCode: 229,
      which: 229,
    })
    await expect(composer).toContainText('composition submit guard')
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await composer.fill('')

    await composer.fill('hold')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()

    await composer.fill('@fixture')
    await mentionMenu.getByRole('option').filter({ hasText: 'fixture-skill' }).click()
    await expect(mentionAtoms.filter({ has: page.getByText('@fixture-skill', { exact: true }) }))
      .toHaveCount(1)
    await composer.pressSequentially('queued next')
    await page.getByRole('button', { name: 'Queue', exact: true }).click()
    await expect(page.getByRole('button', {
      name: 'View 1 pending messages',
    })).toBeVisible()

    await composer.fill('@fixture')
    await mentionMenu.getByRole('option').filter({ hasText: 'fixture-skill' }).click()
    await composer.pressSequentially('guide current')
    await page.getByRole('button', { name: 'More submit actions' }).click()
    await page.getByRole('menuitem', { name: 'Steer current task' }).click()
    const queueButton = page.getByRole('button', { name: 'View 2 pending messages' })
    await expect(queueButton).toBeVisible()
    await queueButton.click()
    const queueDialog = page.getByRole('dialog')
    const queuedSkill = queueDialog.getByRole('listitem')
      .filter({ hasText: 'queued next' })
    const steeredSkill = queueDialog.getByRole('listitem')
      .filter({ hasText: 'guide current' })
    await expect(queuedSkill)
      .toBeVisible()
    await expect(queuedSkill).toContainText('fixture-skill')
    await expect(steeredSkill)
      .toBeVisible()
    await expect(steeredSkill).toContainText('fixture-skill')
    await page.getByRole('group', { name: 'Queue', exact: true })
      .getByRole('button', { name: 'All', exact: true })
      .click()
    await expect(queuedSkill).toBeVisible()
    await expect(steeredSkill).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)

    await page.getByRole('button', {
      name: 'Current model Fake Fast, click to switch',
    }).click()
    await page.getByRole('option', { name: /Fake Chat/ }).click()
    await expect(page.getByRole('button', {
      name: 'Current model Fake Chat, click to switch',
    })).toBeVisible()

    const transcriptLog = page.getByRole('log', { name: 'Conversation' })
    await transcriptLog.evaluate((element, expectedResponse) => {
      type TypewriterProbeHost = HTMLElement & {
        __pipilotTypewriterProbe?: {
          observer: MutationObserver
          sawStreaming: boolean
          sawTyping: boolean
        }
      }
      const host = element as TypewriterProbeHost
      const probe = {
        observer: null as unknown as MutationObserver,
        sawStreaming: false,
        sawTyping: false,
      }
      const sample = () => {
        if (host.getAttribute('data-transcript-typing') !== 'true') return
        probe.sawTyping = true
        if (!host.textContent?.includes(expectedResponse)) probe.sawStreaming = true
      }
      probe.observer = new MutationObserver(sample)
      probe.observer.observe(host, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      })
      host.__pipilotTypewriterProbe = probe
      sample()
    }, typewriterResponse)
    await composer.fill(typewriterPrompt)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(transcriptLog).toContainText(typewriterResponse, { timeout: 20_000 })
    await expect(transcriptLog).not.toHaveAttribute('data-transcript-typing', {
      timeout: 20_000,
    })
    const typewriterProbe = await transcriptLog.evaluate((element) => {
      type TypewriterProbeHost = HTMLElement & {
        __pipilotTypewriterProbe?: {
          observer: MutationObserver
          sawStreaming: boolean
          sawTyping: boolean
        }
      }
      const probe = (element as TypewriterProbeHost).__pipilotTypewriterProbe
      probe?.observer.disconnect()
      return {
        sawStreaming: probe?.sawStreaming ?? false,
        sawTyping: probe?.sawTyping ?? false,
      }
    })
    expect(typewriterProbe).toEqual({
      sawStreaming: true,
      sawTyping: true,
    })

    await composer.fill(thinkingPrompt)
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const thinkingToggle = transcriptLog.getByRole('button', {
      name: /^(Thinking · \d+s|Thought for \d+s|Thought)$/,
    }).last()
    const thinkingContent = transcriptLog.getByText(
      `Fixture reasoning: ${thinkingPrompt}`,
      { exact: true },
    )
    await expect(thinkingToggle).toHaveAttribute('aria-expanded', 'true', {
      timeout: 20_000,
    })
    await expect(thinkingContent).toBeVisible()
    await thinkingToggle.evaluate((element) => {
      const probeTarget = element as HTMLButtonElement & {
        __pipilotThinkingSettlementProbe?: boolean
      }
      const groupTarget = element.closest('[data-slot="collapsible"]')
        ?.parentElement as (HTMLElement & {
          __pipilotThinkingGroupSettlementProbe?: boolean
        }) | null
      probeTarget.__pipilotThinkingSettlementProbe = true
      if (groupTarget) groupTarget.__pipilotThinkingGroupSettlementProbe = true
    })
    await expect(transcriptLog).toContainText(`Fixture response: ${thinkingPrompt}`, {
      timeout: 20_000,
    })
    expect(await thinkingToggle.evaluate((element) => ({
      groupPreserved: Boolean(
        (element.closest('[data-slot="collapsible"]')?.parentElement as (HTMLElement & {
          __pipilotThinkingGroupSettlementProbe?: boolean
        }) | null)?.__pipilotThinkingGroupSettlementProbe,
      ),
      thinkingPreserved: Boolean(
        (element as HTMLButtonElement & { __pipilotThinkingSettlementProbe?: boolean })
          .__pipilotThinkingSettlementProbe,
      ),
    }))).toEqual({
      groupPreserved: true,
      thinkingPreserved: true,
    })
    await expect(thinkingToggle).toHaveAttribute('aria-expanded', 'false', {
      timeout: 20_000,
    })
    await expect(thinkingContent).toHaveCount(0)
    await thinkingToggle.click()
    await expect(thinkingToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(thinkingContent).toBeVisible()

    await composer.fill('accepted revision')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(composer).toHaveAttribute('contenteditable', 'true')
    await expect(page.getByRole('button', { name: 'Add image', exact: true })).toBeEnabled()
    await composer.fill('surviving draft')
    await page.locator('input[type="file"]').setInputFiles({
      name: 'pending.png',
      mimeType: 'image/png',
      buffer: pixelPng,
    })
    const pendingImage = page.getByRole('button', {
      name: 'Remove image pending.png',
      exact: true,
    })
    await expect(pendingImage).toBeAttached()
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
    await expect(composer).toHaveText('surviving draft')
    await expect(pendingImage).toBeAttached()
    await pendingImage.click()
    await expect(page.getByText('Fixture response: accepted revision', { exact: true }))
      .toBeVisible()
    await expect(composer).toHaveText('surviving draft')

    await composer.fill('ui')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const extensionDialog = page.getByRole('dialog')
    await expect(extensionDialog.getByRole('heading', { name: 'Continue?' })).toBeVisible()
    await extensionDialog.getByRole('button', { name: 'Yes', exact: true }).click()
    await expect(extensionDialog).toHaveCount(0)
    const uiTranscript = page.getByRole('log', { name: 'Conversation' })
    await expect(uiTranscript.getByText('Fixture notification', { exact: true })).toBeVisible()
    const fixtureWidget = uiTranscript.getByText('Fixture widget', { exact: true })
    await expect(fixtureWidget).toBeVisible()
    const notificationButton = page.getByRole('button', {
      name: 'Notifications',
      exact: true,
    })
    await notificationButton.click()
    await expect(page.getByText('No notifications', { exact: true })).toBeVisible()
    await notificationButton.click()
    await expect(page).toHaveTitle('PiPilot')
    await expect(page.getByText('Fixture response: ui', { exact: true })).toBeVisible()

    const previousRuntime = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    await selectWorkspaceFromSystemDialog(electronApp, workspacePath)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.pipilot!.conversation.get()))
      .toMatchObject({ activeScope: { kind: 'project' } })
    await expect(page.getByText('Fixture response: ui', { exact: true })).toHaveCount(0)
    await notificationButton.click()
    await expect(page.getByText('No notifications', { exact: true })).toBeVisible()
    await notificationButton.click()
    await expect(page.getByText('Fixture widget', { exact: true })).toHaveCount(0)
    await expect(page.getByText('fixture: ready', { exact: true })).toHaveCount(0)
    await expect(page).toHaveTitle('PiPilot')
    const projectSession = page.getByRole('button', {
      name: 'Existing project session',
      exact: true,
    })
    await expect(projectSession).toBeVisible()

    await expect.poll(() => page.evaluate(async () => {
      const runtime = await window.pipilot!.localPi.runtime.status()
      return { state: runtime.state, cwd: runtime.cwd }
    }), { timeout: 20_000 }).toEqual({
      state: 'ready',
      cwd: canonicalWorkspacePath,
    })
    const projectRuntime = await page.evaluate(() => (
      window.pipilot!.localPi.runtime.status()
    ))
    expect(projectRuntime.cwd).toBe(canonicalWorkspacePath)
    expect(projectRuntime.sessionState?.sessionId)
      .not.toBe(previousRuntime.sessionState?.sessionId)
    await expect(page.getByRole('button', {
      name: /Current model Fake (?:Chat|Fast), click to switch/u,
    })).toBeVisible({ timeout: 20_000 })
    await expect(page.evaluate(() => window.pipilot!.localPi.runtime.command({
      type: 'get_state',
    }))).resolves.toMatchObject({
      success: true,
      command: 'get_state',
      data: {
        model: {
          provider: 'fixture',
          id: expect.stringMatching(/^fake-(?:chat|fast)$/u),
        },
      },
    })
    const promptsBeforeSkillSelection = [...piFixture.prompts]
    await composer.fill('/')
    await expect(slashMenu).toBeVisible()
    await expect(slashMenu.getByText('Commands', { exact: true })).toBeVisible()
    await expect(slashMenu.getByText('Skills', { exact: true })).toBeVisible()
    await expect(slashMenu.getByRole('option').filter({ hasText: '/fixture-command' }))
      .toBeVisible()
    const fixtureSkillOption = slashMenu.getByRole('option')
      .filter({ hasText: '/skill:fixture-skill' })
    await expect(fixtureSkillOption).toBeVisible()
    await fixtureSkillOption.click()
    await expect(composer).toBeFocused()
    await expect(composer).toHaveText('@fixture-skill')
    await expect(page.locator('[data-composer-mention-kind="skill"]')).toHaveCount(1)
    expect(piFixture.prompts).toEqual(promptsBeforeSkillSelection)
    await composer.pressSequentially('exact arguments')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(composer).toHaveText('')

    const desktopViewport = page.viewportSize() ?? { width: 1280, height: 800 }
    await composer.fill('@')
    await expect(mentionMenu.getByText('Files', { exact: true })).toBeVisible()
    await expect(mentionMenu.getByText('Skills', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('composer-mentions-desktop-light.png') })
    await expect(composer).toBeFocused()
    await page.keyboard.type('example')
    const shortFileOption = mentionMenu.getByRole('option', { name: /src\/example\.ts/ })
    const longFileOption = mentionMenu.getByRole('option', {
      name: /example-with-an-exceptionally-long-component-name\.ts/,
    })
    await expect(shortFileOption).toBeVisible()
    await expect(longFileOption).toBeVisible()
    await page.setViewportSize({ width: 640, height: 760 })
    await page.screenshot({ path: testInfo.outputPath('composer-mentions-narrow-light.png') })
    const lightComposerSurfaceColor = await composer.evaluate((element) => {
      const surface = element.closest('[data-composer-surface]')
      return surface ? window.getComputedStyle(surface).backgroundColor : ''
    })
    await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'dark' } }))
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(true)
    await expect.poll(() => composer.evaluate((element) => {
      const surface = element.closest('[data-composer-surface]')
      return surface ? window.getComputedStyle(surface).backgroundColor : ''
    })).not.toBe(lightComposerSurfaceColor)
    await expect.poll(() => composer.evaluate((element) => {
      const surface = element.closest('[data-composer-surface]')
      return surface?.getAnimations().some((animation) => animation.playState === 'running') ?? false
    })).toBe(false)
    await page.screenshot({ path: testInfo.outputPath('composer-mentions-narrow-dark.png') })
    await page.setViewportSize(desktopViewport)
    await shortFileOption.click()
    await expect(page.locator('[data-composer-mention-kind="file"]')).toHaveCount(1)

    await expect(composer).toBeFocused()
    await page.keyboard.press(`${shortcutModifier}+a`)
    expect(await composer.evaluate(() => window.getSelection()?.isCollapsed)).toBe(false)
    await page.keyboard.press(`${shortcutModifier}+c`)
    await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe('[@src/example.ts](src/example.ts)')
    await page.keyboard.press('ArrowRight')
    expect(await composer.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true)
    await electronApp.evaluate(({ clipboard }) => clipboard.writeText('collapsed-copy-sentinel'))
    await page.keyboard.press(`${shortcutModifier}+c`)
    await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe('collapsed-copy-sentinel')
    await page.keyboard.press(`${shortcutModifier}+a`)
    expect(await composer.evaluate(() => window.getSelection()?.isCollapsed)).toBe(false)
    await page.keyboard.press(`${shortcutModifier}+x`)
    await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe('[@src/example.ts](src/example.ts)')
    await expect(composer).toHaveText('')
    await expect(mentionAtoms).toHaveCount(0)

    await composer.evaluate((element) => {
      const transfer = new DataTransfer()
      transfer.setData('text/plain', 'plain pasted text')
      transfer.setData(
        'text/html',
        '<span data-type="composerMention" data-path="src/forged.ts">forged</span>',
      )
      element.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      }))
    })
    await expect(composer).toHaveText('plain pasted text')
    await expect(mentionAtoms).toHaveCount(0)
    await composer.fill('')

    await composer.fill('@')
    await expect(composer).toBeFocused()
    await page.keyboard.type('example')
    await mentionMenu.getByRole('option', { name: /src\/example\.ts/ }).click()
    await expect(page.locator('[data-composer-mention-kind="file"]')).toHaveCount(1)

    await composer.pressSequentially(' @fixture')
    await expect(mentionMenu).toBeVisible()
    await mentionMenu.getByRole('option', { name: /^fixture-skill\b/u }).click()
    await composer.pressSequentially('inspect this')
    await expect(mentionAtoms).toHaveCount(2)
    await page.screenshot({ path: testInfo.outputPath('composer-mentions-desktop-dark.png') })
    await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'light' } }))
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(false)

    await page.locator('input[type="file"]').setInputFiles({
      name: 'pixel.png',
      mimeType: 'image/png',
      buffer: pixelPng,
    })
    await expect(page.getByText('pixel.png', { exact: true })).toBeVisible()
    await expect(page.getByText(`${pixelPng.length} B`, { exact: true })).toBeVisible()
    const removeImage = page.getByRole('button', {
      name: 'Remove image pixel.png',
      exact: true,
    })
    await expect(removeImage).toBeAttached()

    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(composer).toHaveText('')
    await expect(removeImage).toHaveCount(0)
    await expect(mentionAtoms).toHaveCount(0)
    const sentTranscriptImage = transcriptLog.locator('[data-user-message-image]').last()
    await expect(sentTranscriptImage).toBeVisible()
    await expect(sentTranscriptImage).toHaveAttribute(
      'src',
      `data:image/png;base64,${pixelPng.toString('base64')}`,
    )
    await page.screenshot({ path: testInfo.outputPath('user-message-image-desktop-light.png') })
    await expect.poll(() => piFixture.prompts.some((prompt) => (
      prompt.includes('inspect this')
    ))).toBe(true)
    const imageHistory = await page.evaluate(() => (
      window.pipilot!.localPi.runtime.command({ type: 'get_messages' })
    ))
    expect(imageHistory).toMatchObject({
      success: true,
      command: 'get_messages',
      data: {
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'text',
                text: expect.stringContaining('inspect this'),
              }),
              expect.objectContaining({
                type: 'image',
                data: pixelPng.toString('base64'),
                mimeType: 'image/png',
              }),
            ]),
          }),
        ]),
      },
    })

    await composer.fill('@fixture')
    await expect(mentionMenu).toBeVisible()
    await mentionMenu.getByRole('option', { name: /^fixture-skill\b/u }).click()
    await composer.pressSequentially('ordinary draft')
    await expect(page.locator('[data-composer-mention-kind="skill"]')).toHaveCount(1)
    await composer.pressSequentially(' @typed stale query')
    await expect(mentionMenu).toBeVisible()
    await projectSession.click()
    await expect(page.getByText('Loading conversation…', { exact: true })).toBeVisible()
    const inspector = page.getByRole('complementary', { name: 'Inspector' })
    await expect(inspector.getByText('Loading Pi session data…', { exact: true }))
      .toBeVisible()
    await expect(inspector.getByText('example.ts', { exact: true })).toHaveCount(0)
    await inspector.getByRole('tab', { name: 'Changes', exact: true }).click()
    await expect(inspector.getByText('Loading Pi session data…', { exact: true }))
      .toBeVisible()
    await expect(inspector.getByRole('region', { name: continuousDiffPaths[0] }))
      .toHaveCount(0)
    await inspector.getByRole('tab', { name: 'Conversation outline', exact: true }).click()
    await expect(inspector.getByText('Loading Pi session data…', { exact: true }))
      .toBeVisible()
    await inspector.getByRole('tab', { name: 'Files', exact: true }).click()
    await expect(mentionMenu).toHaveCount(0)
    await expect(mentionAtoms).toHaveCount(0)
    await expect(composer).toHaveText('ordinary draft @typed stale query')
    await expect(page.getByText('Selected session history response', { exact: true }))
      .toBeVisible()
    await expect(page.getByRole('button', {
      name: 'Current model Fake Fast, click to switch',
    })).toBeVisible()
    await expect(page.getByRole('button', { name: /View \d+ pending messages/u }))
      .toHaveCount(0)
    await expect(page.getByText('Loading conversation…', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('alertdialog', { name: 'Operation failed' }))
      .toHaveCount(0)

    const subagentCall = page.locator(
      '[data-subagent-call-id="fixture-subagent-call"]',
    )
    await expect(subagentCall).toBeVisible()
    await subagentCall.click()
    const subagentPanel = inspector.locator(
      '[data-subagent-execution-panel="fixture-subagent-call"]',
    )
    await expect(subagentPanel).toBeVisible()
    const subagentTaskDisclosure = subagentPanel.getByRole('button', {
      name: /Task.*trellis-implement/u,
    })
    await expect(subagentTaskDisclosure).toHaveAttribute('aria-expanded', 'false')
    await subagentTaskDisclosure.click()
    await expect(subagentPanel.getByRole('heading', {
      name: 'Preserve behavior',
      exact: true,
    }).last())
      .toBeVisible()
    await expect(subagentPanel.getByText('Keep the existing contract.', { exact: true }))
      .toBeVisible()
    await expect(subagentPanel.getByText('Render Markdown.', { exact: true })).toBeVisible()
    await expect(subagentPanel.getByText('Execution', { exact: true })).toBeVisible()
    const execution = subagentPanel.locator('section[aria-label="Execution"]')
    await expect(execution.getByText('pnpm test', { exact: true })).toBeVisible()
    await expect(execution.getByText('Focused checks passed.', { exact: true })).toBeVisible()
    await expect(execution.getByRole('heading', { name: 'Done', exact: true })).toBeVisible()
    await expect(page.getByText(/Run fan-out|Async workflow|subagent_wait/iu)).toHaveCount(0)
    await expect(page.getByText(/\.trellis\/tasks\/private/iu)).toHaveCount(0)
    const shellCard = page.locator('[data-tool-kind="shell"]').filter({ hasText: 'pnpm test' })
    await expect(shellCard).toBeVisible()
    await shellCard.getByRole('button').first().click()
    await expect(shellCard.getByRole('code')).toHaveText('pnpm test')
    await expect(shellCard.getByRole('heading', { name: 'Checks', exact: true })).toBeVisible()
    await expect(shellCard.getByText('All checks passed.', { exact: true })).toBeVisible()
    await shellCard.getByRole('button', { name: 'Raw', exact: true }).click()
    await expect(shellCard.locator('pre code').filter({ hasText: '## Checks' })).toHaveText(
      '## Checks\n\n- All checks passed.\n- Markdown output.',
    )
    await shellCard.getByRole('button', { name: 'Formatted', exact: true }).click()
    await expect(shellCard.getByText('Arguments', { exact: true })).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('subagent-details-desktop-light.png') })
    await page.setViewportSize({ width: 1_100, height: 680 })
    await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'dark' } }))
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(true)
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ))).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('subagent-details-minimum-dark.png') })
    await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'light' } }))
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(false)
    await page.setViewportSize(desktopViewport)
    await subagentCall.click()

    const sourceFolder = inspector.getByRole('button').filter({ hasText: /^src$/u })
    await expect(sourceFolder).toBeVisible()
    if (await sourceFolder.getAttribute('aria-expanded') !== 'true') await sourceFolder.click()
    await inspector.getByRole('button').filter({ hasText: /^example\.ts$/u }).click()
    const sourceViewer = inspector.getByRole('region', { name: 'src/example.ts' })
    await expect(sourceViewer).toBeVisible()
    await expect(sourceViewer).toContainText('typescript')
    await expect(sourceViewer).toContainText('export const example = true')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await sourceViewer.getByRole('button', { name: 'Back', exact: true }).click()

    await inspector.getByRole('button').filter({ hasText: /^README\.md$/u }).click()
    const markdownViewer = inspector.getByRole('region', { name: 'README.md' })
    await expect(markdownViewer.getByRole('heading', {
      name: 'Workspace viewer fixture',
      exact: true,
    })).toBeVisible()
    await markdownViewer.getByRole('tab', { name: 'Source', exact: true }).click()
    await expect(markdownViewer).toContainText('# Workspace viewer fixture')
    await page.screenshot({ path: testInfo.outputPath('workspace-file-viewer-desktop-light.png') })
    await page.setViewportSize({ width: 1_100, height: 680 })
    await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'dark' } }))
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(true)
    expect(await page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ))).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('workspace-file-viewer-minimum-dark.png') })
    await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'light' } }))
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
      .toBe(false)
    await page.setViewportSize(desktopViewport)
    await markdownViewer.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(inspector.getByRole('button').filter({ hasText: /^README\.md$/u }))
      .toBeVisible()

    const selectedFacts = await page.evaluate(async () => ({
      status: await window.pipilot!.localPi.runtime.status(),
      state: await window.pipilot!.localPi.runtime.command({ type: 'get_state' }),
      messages: await window.pipilot!.localPi.runtime.command({ type: 'get_messages' }),
      models: await window.pipilot!.localPi.runtime.command({
        type: 'get_available_models',
      }),
      stats: await window.pipilot!.localPi.runtime.command({
        type: 'get_session_stats',
      }),
      entries: await window.pipilot!.localPi.runtime.command({ type: 'get_entries' }),
      commands: await window.pipilot!.localPi.runtime.command({ type: 'get_commands' }),
    }))
    expect(selectedFacts.status).toMatchObject({
      state: 'ready',
      cwd: canonicalWorkspacePath,
      sessionFile: canonicalSelectedSessionFile,
      sessionState: {
        sessionId: 'real-sdk-session',
        model: { provider: 'fixture', id: 'fake-fast' },
        pendingMessageCount: 0,
      },
    })
    expect(selectedFacts.state).toMatchObject({
      success: true,
      command: 'get_state',
      data: { sessionId: 'real-sdk-session' },
    })
    expect(selectedFacts.messages).toMatchObject({
      success: true,
      command: 'get_messages',
      data: {
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'Selected session history prompt',
          }),
          expect.objectContaining({
            role: 'assistant',
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'text',
                text: 'Selected session history response',
              }),
            ]),
          }),
        ]),
      },
    })
    expect(selectedFacts.models).toMatchObject({
      success: true,
      command: 'get_available_models',
      data: {
        models: expect.arrayContaining([
          expect.objectContaining({ provider: 'fixture', id: 'fake-chat' }),
          expect.objectContaining({ provider: 'fixture', id: 'fake-fast' }),
        ]),
      },
    })
    expect(selectedFacts.stats).toMatchObject({
      success: true,
      command: 'get_session_stats',
      data: {
        sessionFile: canonicalSelectedSessionFile,
        sessionId: 'real-sdk-session',
        userMessages: 2,
        assistantMessages: 2,
        totalMessages: 6,
      },
    })
    expect(selectedFacts.entries).toMatchObject({
      success: true,
      command: 'get_entries',
      data: {
        entries: expect.arrayContaining([
          expect.objectContaining({ id: '00000000-0000-4000-8000-000000000101' }),
          expect.objectContaining({ id: '00000000-0000-4000-8000-000000000103' }),
        ]),
      },
    })
    expect(selectedFacts.commands).toMatchObject({
      success: true,
      command: 'get_commands',
      data: {
        commands: expect.arrayContaining([
          expect.objectContaining({ name: 'fixture-command', source: 'extension' }),
          expect.objectContaining({
            name: 'skill:fixture-skill',
            source: 'skill',
            sourceInfo: expect.objectContaining({
              scope: 'user',
              path: join(agentDir, 'skills', 'fixture-skill', 'SKILL.md'),
            }),
          }),
          expect.objectContaining({
            name: 'skill:selected-fixture-skill',
            source: 'skill',
            sourceInfo: expect.objectContaining({
              scope: 'project',
              path: join(
                canonicalWorkspacePath,
                '.pi',
                'skills',
                'selected-fixture-skill',
                'SKILL.md',
              ),
            }),
          }),
        ]),
      },
    })
    await inspector.getByRole('tab', { name: 'Conversation outline', exact: true }).click()
    const outlineTurn = inspector.getByRole('button', {
      name: /Selected session history prompt/,
    })
    const outlineTarget = page.locator(
      '[data-conversation-outline-entry="00000000-0000-4000-8000-000000000101"]',
    )
    await expect(outlineTurn).toBeVisible()
    await expect(outlineTurn).toContainText('Selected session history response')
    await outlineTurn.click()
    await expect(outlineTurn).toBeFocused()
    await expect(outlineTarget).toHaveAttribute('data-outline-highlighted', 'true')
    await outlineTurn.click()
    await expect(outlineTarget).toHaveAttribute('data-outline-highlighted', 'true')
    await expect(inspector.getByRole('tab', { name: 'Raw history' })).toHaveCount(0)
    await expect(inspector.getByRole('tab', { name: 'Pi shell' })).toHaveCount(0)
    await composer.fill('/')
    await expect(slashMenu).toBeVisible()
    await expect(slashMenu.getByText('Commands', { exact: true })).toBeVisible()
    await expect(slashMenu.getByText('Skills', { exact: true })).toBeVisible()
    await expect(slashMenu.getByRole('option').filter({ hasText: '/skill:fixture-skill' }))
      .toBeVisible()
    await expect(slashMenu.getByRole('option')
      .filter({ hasText: '/skill:selected-fixture-skill' }))
      .toBeVisible()
    await composer.press('Escape')
    await composer.fill('')

    const responseCopy = page.getByRole('button', {
      name: 'Copy response',
      exact: true,
    })
    const responseFork = page.getByRole('button', {
      name: 'Fork from this response',
      exact: true,
    })
    await expect(responseCopy).toBeVisible()
    await expect(responseFork).toBeVisible()
    await responseCopy.click()
    await expect(page.getByRole('button', {
      name: 'Response copied',
      exact: true,
    })).toBeVisible()
    await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe('Selected session history response')

    const projectSessionRow = page.getByRole('listitem')
      .filter({ has: projectSession })
      .last()
    await projectSessionRow.getByRole('button', { name: 'More actions' }).click()
    await expect(page.getByRole('menuitem', { name: 'Fork', exact: true })).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
    const deleteDialog = page.getByRole('alertdialog', { name: 'Delete session?' })
    await expect(deleteDialog).toContainText('move it to Trash')
    await deleteDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(deleteDialog).toHaveCount(0)

    await responseFork.click()
    await expect(page.getByText('Loading conversation…', { exact: true })).toBeVisible()
    await expect(page.getByText('Loading conversation…', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', {
      name: 'Current model Fake Chat, click to switch',
    })).toBeVisible()
    await expect(page.getByText('Selected session history response', { exact: true }))
      .toHaveCount(0)
    const forkFacts = await page.evaluate(async () => ({
      status: await window.pipilot!.localPi.runtime.status(),
      messages: await window.pipilot!.localPi.runtime.command({ type: 'get_messages' }),
      entries: await window.pipilot!.localPi.runtime.command({ type: 'get_entries' }),
    }))
    expect(forkFacts.status).toMatchObject({
      state: 'ready',
      cwd: canonicalWorkspacePath,
      sessionState: {
        model: { provider: 'fixture', id: 'fake-chat' },
      },
    })
    expect(forkFacts.status.sessionState?.sessionId).not.toBe('real-sdk-session')
    expect(forkFacts.messages).toMatchObject({
      success: true,
      command: 'get_messages',
      data: { messages: [] },
    })
    expect(forkFacts.entries).toMatchObject({
      success: true,
      command: 'get_entries',
      data: {
        entries: expect.arrayContaining([
          expect.objectContaining({
            type: 'model_change',
            provider: 'fixture',
            modelId: 'fake-chat',
          }),
          expect.objectContaining({
            type: 'thinking_level_change',
            thinkingLevel: 'off',
          }),
        ]),
      },
    })
    if (!forkFacts.entries.success || forkFacts.entries.command !== 'get_entries') {
      throw new Error('The forked Session entries were unavailable.')
    }
    expect(forkFacts.entries.data.entries.some((entry) => entry.type === 'message'))
      .toBe(false)
    await expect(composer).toBeEditable()
    await expect(composer).toHaveText('Selected session history prompt')

    await projectSession.click()
    await expect(page.getByRole('log', { name: 'Conversation' }).getByText(
      'Selected session history response',
      { exact: true },
    ))
      .toBeVisible({ timeout: 20_000 })
    await composer.fill('background hold')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop', exact: true }))
      .toBeVisible({ timeout: 20_000 })

    const projectName = basename(workspacePath)
    await page.getByRole('button', {
      name: `Project actions for ${projectName}`,
      exact: true,
    }).click()
    await page.getByRole('menuitem', { name: 'New session', exact: true }).click()
    await expect.poll(() => page.evaluate(async () => (
      (await window.pipilot!.localPi.runtime.status()).sessionState?.sessionId
    )), { timeout: 20_000 }).not.toBe('real-sdk-session')
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)

    await projectSession.click()
    await expect(page.getByText('Fixture response: background hold', { exact: true }))
      .toHaveCount(0)
    await expect(page.getByRole('log', { name: 'Conversation' }).getByText(
      'background hold',
      { exact: true },
    ))
      .toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Stop', exact: true }))
      .toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Stop', exact: true }))
      .toHaveCount(0, { timeout: 20_000 })

    const runningSessionRow = page.getByRole('listitem')
      .filter({ has: projectSession })
      .last()
    await runningSessionRow.getByRole('button', { name: 'More actions' }).click()
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
    const renameInput = page.getByRole('textbox', { name: 'Rename session' })
    await renameInput.fill('Renamed project session')
    await renameInput.press('Enter')
    const renamedProjectSession = page.getByRole('button', {
      name: 'Renamed project session',
      exact: true,
    })
    await expect(renamedProjectSession).toBeVisible({ timeout: 20_000 })

    await page.getByRole('tab', { name: 'Changes', exact: true }).click()
    const firstChangedFile = page.getByRole('region', { name: continuousDiffPaths[0] })
    const lastChangedFile = page.getByRole('region', {
      name: continuousDiffPaths[continuousDiffPaths.length - 1],
    })
    await expect(firstChangedFile).toBeAttached()
    await expect(lastChangedFile).toBeAttached()
    await expect(firstChangedFile).toContainText('export const change1 = 1')
    await lastChangedFile.scrollIntoViewIfNeeded()
    await expect(lastChangedFile).toBeVisible()
    await expect(lastChangedFile).toContainText('export const change12 = 1')

    expect(piFixture.prompts).toEqual(expect.arrayContaining([
      'hold',
      'background hold',
      'accepted revision',
      'ui',
    ]))
    expect(piFixture.prompts.some((prompt) => prompt.includes('exact arguments')))
      .toBe(true)
    expect(piFixture.prompts.some((prompt) => prompt.includes('inspect this')))
      .toBe(true)
    await expect(page.evaluate(() => window.pipilot!.localPi.runtime.status()))
      .resolves.toMatchObject({
        state: 'ready',
        cwd: canonicalWorkspacePath,
        sessionState: {
          model: { provider: 'fixture', id: 'fake-fast' },
        },
      })
  } finally {
    if (clipboardBefore !== undefined) {
      await electronApp.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboardBefore)
        .catch(() => undefined)
    }
    await electronApp.close()
    await piFixture.close()
  }
})

test('applies terminal font settings live without replacing the active PTY', async ({}, testInfo) => {
  const userDataPath = testInfo.outputPath('user-data')
  const electronApp = await electron.launch({
    args: [resolve(process.cwd())],
    env: {
      ...process.env,
      PIPILOT_E2E_USER_DATA: userDataPath,
      PIPILOT_E2E_TERMINAL_SHELL: '/bin/sh',
    },
  })

  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate(() => window.pipilot!.settings.update({ locale: 'en-US' }))
    await page.getByRole('tab', { name: 'Terminal', exact: true }).click()
    const terminalPanel = page.locator('[data-terminal-status]')
    await expect(terminalPanel).toHaveAttribute('data-terminal-status', 'running')

    const activeTerminal = await page.evaluate(async () => {
      const navigation = await window.pipilot!.conversation.get()
      return window.pipilot!.terminal.create(navigation.activeScope, 80, 24)
    })
    expect(activeTerminal.reused).toBe(true)

    await page.evaluate(() => window.pipilot!.settings.update({
      terminal: {
        fontFamily: 'PiPilot Missing Font',
        fontSize: 16,
      },
    }))
    await expect(terminalPanel).toHaveAttribute(
      'data-terminal-font-family',
      'PiPilot Missing Font',
    )
    await expect(terminalPanel).toHaveAttribute('data-terminal-font-size', '16')
    await expect(terminalPanel).toHaveAttribute(
      'data-terminal-effective-font-family',
      /PiPilot Missing Font.*Sarasa Mono SC.*Noto Sans Mono CJK SC/,
    )

    const afterTypography = await page.evaluate(async ({ scope, terminalId }) => {
      const session = await window.pipilot!.terminal.create(scope, 80, 24)
      return {
        sameId: session.terminalId === terminalId,
        reused: session.reused,
      }
    }, {
      scope: activeTerminal.scope,
      terminalId: activeTerminal.terminalId,
    })
    expect(afterTypography).toEqual({ sameId: true, reused: true })
  } finally {
    await electronApp.close()
  }
})

test('launches a sandboxed shell with a narrow validated bridge', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userDataPath = testInfo.outputPath('user-data')
  const launch = () =>
    electron.launch({
      args: [resolve(process.cwd())],
      env: {
        ...process.env,
        PIPILOT_E2E_USER_DATA: userDataPath,
      },
    })

  const electronApp = await launch()
  let expectedWindowState:
    | { bounds: Electron.Rectangle; maximized: boolean }
    | undefined
  let workAreas: Electron.Rectangle[] | undefined

  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    await expect(page).toHaveTitle('PiPilot')
    expect(page.url()).toBe('pipilot://app/')

    const rendererGlobals = await page.evaluate(() => ({
      processType: typeof (globalThis as { process?: unknown }).process,
      requireType: typeof (globalThis as { require?: unknown }).require,
      bridgeKeys: Object.keys(window.pipilot ?? {}).sort(),
      bridgeFrozen: Object.isFrozen(window.pipilot),
    }))
    expect(rendererGlobals).toEqual({
      processType: 'undefined',
      requireType: 'undefined',
      bridgeKeys: [
        'app',
        'applicationUpdate',
        'changes',
        'conversation',
        'externalControl',
        'files',
        'localPi',
        'mcpConfig',
        'modelsConfig',
        'piIntegrations',
        'sessionCatalog',
        'settings',
        'shell',
        'terminal',
        'window',
        'workspace',
      ],
      bridgeFrozen: true,
    })

    const rendererSandboxed = await electronApp.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      const rendererPid = window.webContents.getOSProcessId()
      return app.getAppMetrics().find((metric) => metric.pid === rendererPid)?.sandboxed
    })
    expect(rendererSandboxed).toBe(true)

    const appInfo = await page.evaluate(() => window.pipilot?.app.getInfo())
    expect(appInfo).toMatchObject({
      name: 'PiPilot',
      version: '0.0.1',
      electronVersion: '43.4.1',
      mode: 'development',
    })
    const nativeWindowMode = await electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      return {
        fullScreen: window.isFullScreen(),
        maximized: window.isMaximized(),
      }
    })
    await expect(page.evaluate(() => window.pipilot?.window.getState())).resolves.toMatchObject({
      focused: expect.any(Boolean),
      ...nativeWindowMode,
    })

    const settingsEvent = await page.evaluate(async () => {
      const settingsApi = window.pipilot!.settings
      const eventPromise = new Promise<Awaited<ReturnType<typeof settingsApi.update>>>(
        (resolve) => {
          const unsubscribe = settingsApi.subscribe((snapshot) => {
            if (
              snapshot.settings.locale === 'en-US' &&
              snapshot.settings.appearance.theme === 'dark'
            ) {
              unsubscribe()
              resolve(snapshot)
            }
          })
        },
      )

      await settingsApi.update({ locale: 'en-US', appearance: { theme: 'dark' } })
      return eventPromise
    })
    expect(settingsEvent).toMatchObject({
      revision: expect.any(Number),
      settings: { locale: 'en-US', appearance: { theme: 'dark' } },
    })
    await expect.poll(() => page.evaluate(() => ({
      dark: document.documentElement.classList.contains('dark'),
      locale: document.documentElement.lang,
    }))).toEqual({ dark: true, locale: 'en-US' })
    expect(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem('pipilot.settings.v1') ?? 'null'),
      ),
    ).toMatchObject({ locale: 'en-US', appearance: { theme: 'dark' } })

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(page.getByRole('main', { name: 'Appearance' })).toBeVisible()
    await page.getByRole('button', { name: 'Light', exact: true }).click()
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.classList.contains('dark'))).toBe(false)

    await page.getByRole('button', { name: 'Language', exact: true }).click()
    await page.getByRole('radio', { name: '简体中文', exact: true }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.lang))
      .toBe('zh-CN')
    await expect(page.getByRole('main', { name: '语言' })).toBeVisible()

    await page.getByRole('radio', { name: 'English', exact: true }).click()
    await expect.poll(() => page.evaluate(() => document.documentElement.lang))
      .toBe('en-US')
    await page.getByRole('button', { name: 'Appearance', exact: true }).click()
    await page.getByRole('button', { name: 'Dark', exact: true }).click()
    await expect.poll(() => page.evaluate(() => ({
      dark: document.documentElement.classList.contains('dark'),
      locale: document.documentElement.lang,
    }))).toEqual({ dark: true, locale: 'en-US' })

    await page.getByRole('combobox', { name: 'UI font', exact: true }).click()
    await page.getByRole('option', { name: 'Segoe UI', exact: true }).click()
    await page.getByRole('combobox', { name: 'Monospace font', exact: true }).click()
    await page.getByRole('option', { name: 'Fira Code', exact: true }).click()
    await page.getByRole('slider', { name: 'UI font size', exact: true }).press('End')
    await page.getByRole('slider', { name: 'Code font size', exact: true }).press('End')
    await page.getByRole('radio', { name: 'Comfortable', exact: true }).click()
    await page.getByRole('switch', { name: 'Reduce motion', exact: true }).click()
    await expect.poll(() => page.evaluate(() => {
      const root = document.documentElement
      return {
        uiFont: root.style.getPropertyValue('--font-sans'),
        monoFont: root.style.getPropertyValue('--font-mono'),
        uiSize: root.style.getPropertyValue('--app-font-size'),
        codeSize: root.style.getPropertyValue('--code-font-size'),
        controlHeight: root.style.getPropertyValue('--control-h'),
        density: root.dataset.density,
        reducedMotion: root.dataset.reducedMotion,
      }
    })).toEqual({
      uiFont: expect.stringContaining('Segoe UI'),
      monoFont: expect.stringContaining('Fira Code'),
      uiSize: '18px',
      codeSize: '18px',
      controlHeight: '34px',
      density: 'comfortable',
      reducedMotion: 'true',
    })

    await page.getByRole('button', { name: 'Terminal', exact: true }).click()
    await page.getByRole('combobox', { name: 'Terminal font', exact: true }).click()
    await page.getByRole('option', { name: 'Fira Code', exact: true }).click()
    await page.getByRole('slider', { name: 'Terminal font size', exact: true }).press('End')
    const terminalFontPreview = page.locator('[data-terminal-font-preview]')
    await expect(terminalFontPreview).toHaveAttribute('data-terminal-font-family', 'Fira Code')
    await expect(terminalFontPreview).toHaveAttribute('data-terminal-effective-font-family', /Fira Code/)

    await page.getByRole('button', { name: 'Appearance', exact: true }).click()
    await page.getByRole('button', { name: 'Sessions', exact: true }).click()
    const resizeHandle = page.getByRole('separator', {
      name: 'Resize inspector: arrow keys to adjust, double-click to reset',
    })
    await resizeHandle.focus()
    await resizeHandle.press('ArrowLeft')
    await expect(resizeHandle).toHaveAttribute('aria-valuenow', '376')
    await resizeHandle.press('Home')
    await expect(resizeHandle).toHaveAttribute('aria-valuenow', '360')

    for (const factor of [1.25, 1.5]) {
      await electronApp.evaluate(({ BrowserWindow }, zoomFactor) => {
        BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(zoomFactor)
      }, factor)
      await expect(page.locator('#composer-input')).toBeVisible()
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await expect(page.getByRole('main', { name: 'Appearance' })).toBeVisible()
      await page.getByRole('button', { name: 'Sessions', exact: true }).click()
    }
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)
    })

    const unsafeExternal = await page.evaluate(async () => {
      try {
        await window.pipilot?.shell.openExternal('file:///tmp/secret')
        return { rejected: false }
      } catch (error) {
        const apiError = error as { code?: unknown; message?: unknown }
        return {
          rejected: true,
          code: apiError.code,
          message: apiError.message,
        }
      }
    })
    expect(unsafeExternal).toEqual({
      rejected: true,
      code: 'INVALID_EXTERNAL_URL',
      message: 'Only validated HTTP and HTTPS URLs can be opened.',
    })

    const originalUrl = page.url()
    await page.evaluate(() => {
      window.location.href = 'https://example.com/'
    })
    await page.waitForTimeout(100)
    expect(page.url()).toBe(originalUrl)

    await page.evaluate(() => {
      window.open('data:text/html,blocked', '_blank')
    })
    await expect.poll(() => electronApp.windows().length).toBe(1)

    const establishedWindow = await electronApp.evaluate(
      ({ BrowserWindow, screen }, minimumSize) => {
        const window = BrowserWindow.getAllWindows()[0]
        const primaryDisplay = screen.getPrimaryDisplay()
        const otherDisplays = screen
          .getAllDisplays()
          .filter((display) => display.id !== primaryDisplay.id)
        const availableWorkAreas = [primaryDisplay, ...otherDisplays]
          .map((display) => display.workArea)
        const workArea = availableWorkAreas[0]
        const horizontalMargin = workArea.width >= minimumSize.width + 80 ? 40 : 0
        const verticalMargin = workArea.height >= minimumSize.height + 80 ? 40 : 0
        const bounds = {
          x: workArea.x + horizontalMargin,
          y: workArea.y + verticalMargin,
          width: Math.min(1200, workArea.width - horizontalMargin * 2),
          height: Math.min(760, workArea.height - verticalMargin * 2),
        }
        window.unmaximize()
        window.setBounds(bounds)
        const maximized = window.isMaximized()
        return {
          state: {
            bounds: maximized ? window.getNormalBounds() : window.getBounds(),
            maximized,
          },
          workAreas: availableWorkAreas,
        }
      },
      MIN_WINDOW_SIZE,
    )
    expectedWindowState = establishedWindow.state
    workAreas = establishedWindow.workAreas
  } finally {
    await electronApp.close()
  }

  if (!expectedWindowState || !workAreas) {
    throw new Error('The first window did not establish a persistence snapshot.')
  }
  const persisted = JSON.parse(
    await readFile(join(userDataPath, 'window-state.json'), 'utf8'),
  ) as { version: number; bounds: Electron.Rectangle; maximized: boolean }
  expect(persisted).toEqual({ version: 1, ...expectedWindowState })
  const expectedRestoredWindowState = {
    bounds: normalizeWindowBounds(persisted.bounds, workAreas),
    maximized: persisted.maximized,
  }

  const restartedApp = await launch()
  try {
    const restartedPage = await restartedApp.firstWindow()
    await restartedPage.waitForLoadState('domcontentloaded')
    await expect.poll(() => restartedApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      const maximized = window.isMaximized()
      return {
        bounds: maximized ? window.getNormalBounds() : window.getBounds(),
        maximized,
      }
    })).toEqual(expectedRestoredWindowState)
    await expect(
      restartedPage.evaluate(() => window.pipilot?.settings.get()),
    ).resolves.toMatchObject({
      settings: {
        locale: 'en-US',
        appearance: {
          theme: 'dark',
          uiFontFamily: 'Segoe UI',
          monoFontFamily: 'Fira Code',
          uiFontSize: 18,
          codeFontSize: 18,
          density: 'comfortable',
          reducedMotion: true,
        },
        terminal: {
          fontFamily: 'Fira Code',
          fontSize: 18,
        },
      },
    })
    await expect.poll(() =>
      restartedPage.evaluate(() => document.documentElement.classList.contains('dark')),
    ).toBe(true)
    expect(JSON.parse(await readFile(join(userDataPath, 'settings.json'), 'utf8'))).toMatchObject({
      version: SETTINGS_SCHEMA_VERSION,
      settings: {
        locale: 'en-US',
        appearance: {
          theme: 'dark',
          uiFontFamily: 'Segoe UI',
          monoFontFamily: 'Fira Code',
          uiFontSize: 18,
          codeFontSize: 18,
          density: 'comfortable',
          reducedMotion: true,
        },
        terminal: {
          fontFamily: 'Fira Code',
          fontSize: 18,
        },
      },
    })
  } finally {
    await restartedApp.close()
  }
})
