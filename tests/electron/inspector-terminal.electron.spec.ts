import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page, type TestInfo } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'
import { closeFixtureApplication } from './close-fixture-application'

async function addProject(app: ElectronApplication, page: Page, path: string) {
  await app.evaluate(({ dialog }, directory) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [directory] }),
    })
  }, path)
  await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
  await expect.poll(async () => {
    const runtime = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
    return { cwd: runtime.cwd, state: runtime.state }
  }).toEqual({ cwd: path, state: 'ready' })
}

// Independent gates distinguish two shells in one directory. After the initial
// history, only a gate creates output, so reading-position assertions are stable.
const terminalScript = [
  'tag="$1"',
  'exit_code="${2:-7}"',
  'index=0',
  'while [ "$index" -lt 180 ]; do',
  '  printf "PIPILOT_%s_SCROLL:%04d\\n" "$tag" "$index"',
  '  index=$((index + 1))',
  'done',
  'printf "PIPILOT_%s_READY\\n" "$tag"',
  'while [ ! -f "terminal-$tag-finish" ]; do',
  '  for phase in hidden inactive background reading; do',
  '    if [ -f "terminal-$tag-$phase" ] && [ ! -f "terminal-$tag-$phase-seen" ]; then',
  '      printf "PIPILOT_%s_%s_OUTPUT\\n" "$tag" "$phase"',
  '      printf seen > "terminal-$tag-$phase-seen"',
  '    fi',
  '  done',
  '  sleep 0.05',
  'done',
  'printf "PIPILOT_%s_FINISHED\\n" "$tag"',
  'exit "$exit_code"',
  '',
].join('\n')

async function launchTerminalFixture(testInfo: TestInfo) {
  const userData = testInfo.outputPath('user-data')
  const projectPaths = [testInfo.outputPath('Terminal-A'), testInfo.outputPath('Terminal-B')]
  await Promise.all([userData, ...projectPaths].map((path) => mkdir(path, { recursive: true })))
  const [projectA, projectB] = await Promise.all(projectPaths.map((path) => realpath(path)))
  await Promise.all([projectA, projectB].map(async (project) => {
    await writeFile(join(project, 'terminal-fixture.sh'), terminalScript)
    await writeFile(join(project, 'README.md'), `# ${basename(project)}\n`)
  }))
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION, settings: {
    ...DEFAULT_SETTINGS,
    locale: 'en-US',
    appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true },
  } }))
  await writeFile(join(userData, 'pi-managed-packages.json'), JSON.stringify({ version: 1, mcpOptedOut: true }))
  const fixture = await startPiSdkFixture({ agentDir: testInfo.outputPath('pi-agent') })
  let app: ElectronApplication
  try {
    app = await electron.launch({ args: [resolve(process.cwd())], env: {
      ...process.env, ...fixture.env,
      PIPILOT_E2E_USER_DATA: userData,
      PIPILOT_E2E_DISABLE_AUTO_RESTART: '1',
      PIPILOT_E2E_TERMINAL_SHELL: '/bin/sh',
    } })
  } catch (error) {
    await fixture.close()
    throw error
  }
  const close = async () => {
    try { await closeFixtureApplication(app) } finally { await fixture.close() }
  }
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    return { app, page, errors, projectA, projectB, close }
  } catch (error) {
    await close()
    throw error
  }
}

async function listTerminals(page: Page) {
  return page.evaluate(async () => {
    const { activeScope } = await window.pipilot!.conversation.get()
    return window.pipilot!.terminal.list(activeScope)
  })
}

async function terminalSnapshot(page: Page, terminalId: string) {
  return page.evaluate(async (id) => {
    const { activeScope } = await window.pipilot!.conversation.get()
    const terminal = (await window.pipilot!.terminal.list(activeScope)).find((entry) => entry.terminalId === id)
    if (!terminal) throw new Error(`Expected terminal ${id} in the active project`)
    return window.pipilot!.terminal.attach(activeScope, id, terminal.cols, terminal.rows)
  }, terminalId)
}

function terminalPanel(page: Page, terminalId: string) {
  return page.locator(`[data-terminal-id="${terminalId}"][data-terminal-status]`)
}

function terminalWorkspace(page: Page) {
  return page.locator('[data-terminal-drawer] [data-terminal-workspace]:visible')
}

async function activeTerminal(page: Page) {
  const panel = page.locator('[data-terminal-id][data-terminal-status]:visible')
  await expect(panel).toHaveCount(1)
  await expect(panel).toHaveAttribute('data-terminal-status', 'running')
  const terminalId = await panel.getAttribute('data-terminal-id')
  if (!terminalId) throw new Error('The active terminal does not expose its identity')
  const snapshot = await terminalSnapshot(page, terminalId)
  return { panel: terminalPanel(page, terminalId), ...snapshot }
}

async function enterCommand(panel: Locator, command: string) {
  const input = panel.getByRole('textbox', { name: 'Interactive terminal input', exact: true })
  await input.focus()
  await input.pressSequentially(command)
  await input.press('Enter')
}

async function startShell(page: Page, panel: Locator, terminalId: string, tag: string, exitCode = 7) {
  await enterCommand(panel, `exec /bin/sh ./terminal-fixture.sh ${tag} ${exitCode}`)
  await expect.poll(async () => (await terminalSnapshot(page, terminalId)).replay).toContain(`PIPILOT_${tag}_READY`)
  await expect(panel.locator('.xterm-rows')).toContainText(`PIPILOT_${tag}_READY`)
}

async function releaseOutput(project: string, tag: string, phase: string) {
  await writeFile(join(project, `terminal-${tag}-${phase}`), '')
  await expect.poll(() => readFile(join(project, `terminal-${tag}-${phase}-seen`), 'utf8').catch(() => '')).toBe('seen')
}

async function terminalAction(page: Page, action: string) {
  await terminalWorkspace(page).getByRole('button', { name: 'More terminal actions', exact: true }).click()
  await page.getByRole('menuitem', { name: action, exact: true }).click()
}

async function openTerminalSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('region', { name: 'Settings', exact: true })
    .getByRole('button', { name: 'Terminal', exact: true }).click()
  const settings = page.getByRole('main', { name: 'Terminal', exact: true })
  await expect(settings.getByRole('combobox', { name: 'Default profile', exact: true })).toBeVisible()
  return settings
}

async function returnToTerminals(page: Page) {
  await page.getByRole('button', { name: 'Sessions', exact: true }).click()
  const drawer = page.locator('#workspace-terminal-drawer[data-terminal-drawer]')
  if (!await drawer.isVisible()) await page.getByRole('button', { name: 'Terminal', exact: true }).click()
  await expect(drawer).toBeVisible()
}

async function expectShellProfile(
  page: Page,
  terminal: Awaited<ReturnType<typeof activeTerminal>>,
  phase: string,
  marker: string,
  cwd: string,
  nounset: boolean,
) {
  await enterCommand(terminal.panel, `printf 'PIPILOT_%s_MARKER:%s\\n' '${phase}' "\${PIPILOT_TERMINAL_PROFILE_MARKER-unset}"; printf 'PIPILOT_%s_FLAGS:%s\\n' '${phase}' "$-"; printf 'PIPILOT_%s_CWD:%s\\n' '${phase}' "$PWD"`)
  await expect.poll(async () => (await terminalSnapshot(page, terminal.terminalId)).replay)
    .toContain(`\r\nPIPILOT_${phase}_CWD:${cwd}\r\n`)
  const { replay } = await terminalSnapshot(page, terminal.terminalId)
  expect(replay).toContain(`\r\nPIPILOT_${phase}_MARKER:${marker}\r\n`)
  const flags = replay.match(new RegExp(`(?:^|\\r?\\n)PIPILOT_${phase}_FLAGS:([^\\r\\n]*)`))?.[1]
  expect(flags).toContain('i')
  expect(flags?.includes('u')).toBe(nounset)
  // Inspect xterm's rendered output as well as Main replay. Long absolute test
  // paths may wrap, so the renderer assertion uses the distinctive directory.
  await expect(terminal.panel.locator('.xterm-rows')).toContainText(`PIPILOT_${phase}_MARKER:${marker}`)
  await expect(terminal.panel.locator('.xterm-rows')).toContainText(basename(cwd))
}

async function renameTerminal(page: Page, title: string) {
  await terminalAction(page, 'Rename terminal')
  const dialog = page.getByRole('dialog', { name: 'Rename terminal', exact: true })
  await dialog.getByRole('textbox', { name: 'Terminal name', exact: true }).fill(title)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('tab', { name: title, exact: true })).toHaveAttribute('aria-selected', 'true')
}

async function isolateClipboard(page: Page) {
  await page.evaluate(() => {
    let text = ''
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      readText: async () => text,
      writeText: async (next: string) => { text = next },
    } })
  })
}

async function expectRenderedOutput(page: Page, panel: Locator, marker: string) {
  // Copy from xterm's parsed buffer. A shell gate or Main replay alone cannot
  // prove that off-screen output has already reached the renderer.
  await expect(panel).toBeVisible()
  await expect.poll(async () => {
    await terminalWorkspace(page).getByRole('button', { name: 'Copy terminal text', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Copy all output', exact: true }).click()
    return page.evaluate(() => navigator.clipboard.readText())
  }).toContain(marker)
}

test('preserves named terminals and viewport across hiding, tabs and projects, and retains natural exits', async ({}, testInfo) => {
  test.skip(process.platform === 'win32', 'This real PTY fixture uses a deterministic POSIX shell.')
  test.setTimeout(120_000)
  const fixture = await launchTerminalFixture(testInfo)
  const { app, page, projectA, projectB, errors } = fixture
  try {
    await isolateClipboard(page)
    await addProject(app, page, projectA)
    const toggle = page.getByRole('button', { name: 'Terminal', exact: true })
    const drawer = page.locator('#workspace-terminal-drawer[data-terminal-drawer]')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(drawer).toBeHidden()
    expect(await listTerminals(page)).toEqual([])
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(drawer).toBeVisible()
    const first = await activeTerminal(page)
    await expect(drawer.getByRole('textbox', { name: 'Terminal input', exact: true })).toHaveCount(0)
    await expect(drawer.getByRole('textbox', { name: 'Interactive terminal input', exact: true })).toHaveCount(1)
    await renameTerminal(page, 'Build watcher')
    await startShell(page, first.panel, first.terminalId, 'A1')
    await first.panel.getByRole('textbox', { name: 'Interactive terminal input', exact: true }).press('Control+Backquote')
    await expect(drawer).toBeHidden()
    await page.keyboard.press('Control+Backquote')
    await expect(first.panel).toBeVisible()

    // Preserve the rendered viewport and xterm instance, not only Main replay.
    const firstRow = first.panel.locator('.xterm-rows > div').first()
    const latestPosition = await firstRow.innerText()
    await first.panel.locator('.xterm-screen').hover()
    await page.mouse.wheel(0, -1000)
    await expect(firstRow).not.toHaveText(latestPosition)
    const readingPosition = await firstRow.innerText()
    expect(readingPosition).toContain('PIPILOT_A1_SCROLL:')
    const firstView = await first.panel.locator('.xterm').elementHandle()
    if (!firstView) throw new Error('The first terminal view is missing')
    await drawer.getByRole('button', { name: 'Hide terminal (keep running)', exact: true }).click()
    await expect(drawer).toBeHidden()
    await expect(toggle).toBeFocused()
    await releaseOutput(projectA, 'A1', 'hidden')
    await toggle.click()
    await expect(first.panel).toBeVisible()
    await expectRenderedOutput(page, first.panel, 'PIPILOT_A1_hidden_OUTPUT')
    await expect(firstRow).toHaveText(readingPosition)
    expect((await terminalSnapshot(page, first.terminalId)).replay).toContain('PIPILOT_A1_hidden_OUTPUT')

    await drawer.getByRole('button', { name: 'New terminal', exact: true }).click()
    await expect(first.panel).toBeHidden()
    const second = await activeTerminal(page)
    expect(second.terminalId).not.toBe(first.terminalId)
    await renameTerminal(page, 'Test watcher')
    await startShell(page, second.panel, second.terminalId, 'A2', 0)
    await expect(first.panel).toBeHidden()
    expect((await listTerminals(page)).map(({ title }) => title)).toEqual(['Build watcher', 'Test watcher'])
    await releaseOutput(projectA, 'A1', 'inactive')
    await drawer.getByRole('tab', { name: 'Build watcher', exact: true }).click()
    await expect(first.panel).toBeVisible()
    await expectRenderedOutput(page, first.panel, 'PIPILOT_A1_inactive_OUTPUT')
    await expect(firstRow).toHaveText(readingPosition)
    expect((await terminalSnapshot(page, first.terminalId)).replay).toContain('PIPILOT_A1_inactive_OUTPUT')

    await addProject(app, page, projectB)
    await expect(first.panel).toBeHidden()
    const otherProject = await activeTerminal(page)
    expect(otherProject.terminalId).not.toBe(first.terminalId)
    expect(otherProject.terminalId).not.toBe(second.terminalId)
    await startShell(page, otherProject.panel, otherProject.terminalId, 'B1')
    await expect(drawer.getByRole('tab', { name: 'Build watcher', exact: true })).toHaveCount(0)
    expect(await listTerminals(page)).toHaveLength(1)
    const staleWrite = await page.evaluate(async ({ scope, terminalId }) => {
      try {
        await window.pipilot!.terminal.input(scope, terminalId, 'wrong project')
        return 'accepted'
      } catch (error) {
        return typeof error === 'object' && error !== null && 'code' in error ? error.code : 'unknown'
      }
    }, { scope: first.scope, terminalId: first.terminalId })
    expect(staleWrite).toBe('TERMINAL_STALE_SCOPE')
    await Promise.all([releaseOutput(projectA, 'A1', 'background'), releaseOutput(projectA, 'A2', 'background')])

    await page.getByRole('button', { name: `New session in ${basename(projectA)}`, exact: true }).click()
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.localPi.runtime.status()).cwd)).toBe(projectA)
    await expect(drawer.getByRole('tab', { name: 'Build watcher', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(first.panel).toBeVisible()
    await expectRenderedOutput(page, first.panel, 'PIPILOT_A1_background_OUTPUT')
    await expect(firstRow).toHaveText(readingPosition)
    expect(await firstView.evaluate((element, id) => element.isConnected && element === document.querySelector(`[data-terminal-id="${id}"] .xterm`), first.terminalId)).toBe(true)
    expect((await terminalSnapshot(page, first.terminalId)).replay).toContain('PIPILOT_A1_background_OUTPUT')
    expect((await terminalSnapshot(page, second.terminalId)).replay).toContain('PIPILOT_A2_background_OUTPUT')
    expect((await listTerminals(page)).map(({ terminalId }) => terminalId)).toEqual([first.terminalId, second.terminalId])
    await releaseOutput(projectA, 'A1', 'reading')
    await expectRenderedOutput(page, first.panel, 'PIPILOT_A1_reading_OUTPUT')
    await expect(firstRow).toHaveText(readingPosition)
    await first.panel.getByRole('button', { name: 'New output', exact: true }).click()
    await expect(first.panel.locator('.xterm-rows')).toContainText('PIPILOT_A1_reading_OUTPUT')

    // Natural exit must keep its identity, code and final output until an
    // explicit restart/close. Merely revisiting the view must not create a PTY.
    await writeFile(join(projectA, 'terminal-A1-finish'), '')
    await expect(first.panel).toHaveAttribute('data-terminal-status', 'exited')
    const exited = await terminalSnapshot(page, first.terminalId)
    expect(exited).toMatchObject({ terminalId: first.terminalId, title: 'Build watcher', status: 'exited', exitCode: 7 })
    expect(exited.replay).toContain('PIPILOT_A1_FINISHED')
    await expect(first.panel.locator('.xterm-rows')).toContainText('PIPILOT_A1_FINISHED')
    await drawer.getByRole('button', { name: 'Hide terminal (keep running)', exact: true }).click()
    await toggle.click()
    await drawer.getByRole('tab', { name: 'Test watcher', exact: true }).click()
    await drawer.getByRole('tab', { name: 'Build watcher', exact: true }).click()
    const previousSession = await page.evaluate(async () => (await window.pipilot!.localPi.runtime.status()).sessionState?.sessionId)
    await page.getByRole('button', { name: `New session in ${basename(projectA)}`, exact: true }).click()
    await expect.poll(() => page.evaluate(async (previous) => {
      const current = (await window.pipilot!.localPi.runtime.status()).sessionState?.sessionId
      return Boolean(current && current !== previous)
    }, previousSession)).toBe(true)
    await expect(first.panel).toHaveAttribute('data-terminal-status', 'exited')
    expect((await listTerminals(page)).map(({ terminalId, status }) => ({ terminalId, status }))).toEqual([
      { terminalId: first.terminalId, status: 'exited' },
      { terminalId: second.terminalId, status: 'running' },
    ])
    expect((await terminalSnapshot(page, first.terminalId)).replay).toBe(exited.replay)
    await terminalAction(page, 'Restart terminal')
    const restarted = await activeTerminal(page)
    expect(restarted.terminalId).not.toBe(first.terminalId)
    expect(restarted.replay).not.toContain('PIPILOT_A1_FINISHED')
    await terminalAction(page, 'End terminal')
    await expect(restarted.panel).toHaveAttribute('data-terminal-status', 'exited')
    await terminalAction(page, 'Close terminal')
    await expect(terminalPanel(page, restarted.terminalId)).toHaveCount(0)
    expect((await listTerminals(page)).some(({ terminalId }) => terminalId === restarted.terminalId)).toBe(false)
    expect((await terminalSnapshot(page, second.terminalId)).status).toBe('running')
    expect(errors).toEqual([])
  } finally {
    await fixture.close()
  }
})

test('uses the global profile for new terminals across projects and preserves an exited terminal launch on restart', async ({}, testInfo) => {
  test.skip(process.platform === 'win32', 'The native shell identity probes use POSIX syntax; Windows profiles have service coverage.')
  test.setTimeout(120_000)
  const fixture = await launchTerminalFixture(testInfo)
  const { app, page, projectA, projectB, errors } = fixture
  const shellIsAlive = (pid: number) => app.evaluate((_electron, id) => {
    try { process.kill(id, 0); return true } catch { return false }
  }, pid)
  const probePid = async (terminal: Awaited<ReturnType<typeof activeTerminal>>, marker: string) => {
    await enterCommand(terminal.panel, `printf 'PIPILOT_%s:%s\\n' '${marker}' "$$"`)
    const output = new RegExp(`(?:^|\\r?\\n)PIPILOT_${marker}:(\\d+)\\r?\\n`)
    await expect.poll(async () => (await terminalSnapshot(page, terminal.terminalId)).replay).toMatch(output)
    return Number((await terminalSnapshot(page, terminal.terminalId)).replay.match(output)![1])
  }
  try {
    await addProject(app, page, projectA)
    const toggle = page.getByRole('button', { name: 'Terminal', exact: true })
    const drawer = page.locator('#workspace-terminal-drawer[data-terminal-drawer]')
    await toggle.click()
    const original = await activeTerminal(page)
    const originalPid = await probePid(original, 'ORIGINAL_PID')
    const profiles = await page.evaluate(() => window.pipilot!.terminal.listShellProfiles())
    const detected = profiles.filter(({ source }) => source === 'detected')
    expect(detected.length).toBeGreaterThan(0)
    expect(profiles.filter(({ isDefault }) => isDefault)).toHaveLength(1)
    for (const profile of detected) {
      expect(profile).toMatchObject({
        id: expect.stringMatching(/^detected:[a-f0-9]{32}$/),
        source: 'detected', executable: expect.stringMatching(/^\//),
        args: expect.any(Array), available: true,
      })
      expect(profile.args.every((argument) => typeof argument === 'string')).toBe(true)
    }
    await expect(drawer.getByRole('button', { name: 'New terminal with shell', exact: true })).toHaveCount(0)

    const settings = await openTerminalSettings(page)
    await settings.getByRole('button', { name: 'Add profile', exact: true }).click()
    const form = page.getByRole('dialog', { name: 'Add terminal profile', exact: true })
    await form.getByRole('textbox', { name: 'Profile name', exact: true }).fill('Fixture interactive sh')
    await form.getByRole('textbox', { name: 'Executable', exact: true }).fill('/bin/sh')
    await form.getByText('Advanced: arguments and environment', { exact: true }).click()
    for (const [index, argument] of ['-i', '-u'].entries()) {
      await form.getByRole('button', { name: 'Add argument', exact: true }).click()
      await form.getByRole('textbox', { name: `Argument ${index + 1}`, exact: true }).fill(argument)
    }
    await form.getByRole('button', { name: 'Add variable', exact: true }).click()
    await form.getByRole('textbox', { name: 'Variable 1 name', exact: true }).fill('PIPILOT_TERMINAL_PROFILE_MARKER')
    await form.getByRole('textbox', { name: 'Variable 1 value', exact: true }).fill('original-global-profile')
    await page.setViewportSize({ width: 1100, height: 680 })
    await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'dark' } }))
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
    await expect.poll(() => form.evaluate((element) => ({
      documentFits: document.documentElement.scrollWidth <= innerWidth,
      dialogFits: element.scrollWidth <= element.clientWidth,
      fieldsFit: [...element.querySelectorAll('form, fieldset')].every((field) => field.scrollWidth <= field.clientWidth),
      insideWindow: element.getBoundingClientRect().left >= 0 && element.getBoundingClientRect().right <= innerWidth,
    }))).toEqual({ documentFits: true, dialogFits: true, fieldsFit: true, insideWindow: true })
    await expect(form.getByRole('button', { name: 'Save', exact: true })).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: testInfo.outputPath('terminal-profile-form-dark-1100x680.png'), animations: 'disabled' })
    await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'light' } }))
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(false)
    await form.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(form).toBeHidden()
    const customProfile = (await page.evaluate(() => window.pipilot!.settings.get()))
      .settings.terminal.profiles.find(({ name }) => name === 'Fixture interactive sh')
    expect(customProfile).toMatchObject({
      id: expect.stringMatching(/^custom:/), name: 'Fixture interactive sh',
      executable: '/bin/sh', args: ['-i', '-u'],
      env: { PIPILOT_TERMINAL_PROFILE_MARKER: 'original-global-profile' },
    })
    if (!customProfile) throw new Error('The custom profile was not persisted by the form')
    await settings.getByRole('combobox', { name: 'Default profile', exact: true }).click()
    await page.getByRole('option', { name: customProfile.name, exact: true }).click()
    await expect.poll(async () => (await page.evaluate(() => window.pipilot!.settings.get()))
      .settings.terminal.defaultProfileId).toBe(customProfile.id)
    await expect.poll(async () => JSON.parse(await readFile(testInfo.outputPath('user-data', 'settings.json'), 'utf8'))
      .settings.terminal).toMatchObject({ defaultProfileId: customProfile.id, profiles: [customProfile] })
    await expect.poll(async () => (await page.evaluate(() => window.pipilot!.terminal.listShellProfiles()))
      .find(({ id }) => id === customProfile.id)).toMatchObject({
      id: customProfile.id, label: customProfile.name, source: 'custom',
      executable: '/bin/sh', args: ['-i', '-u'], available: true, isDefault: true,
    })
    await page.setViewportSize({ width: 1100, height: 680 })
    await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'dark' } }))
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true)
    await expect.poll(() => settings.evaluate((element) =>
      document.documentElement.scrollWidth <= innerWidth && element.scrollWidth <= element.clientWidth,
    )).toBe(true)
    await expect(settings.getByRole('combobox', { name: 'Default profile', exact: true })).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: testInfo.outputPath('terminal-global-profile-settings-dark-1100x680.png'), animations: 'disabled' })
    await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'light' } }))
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(false)
    await page.screenshot({ path: testInfo.outputPath('terminal-global-profile-settings.png') })
    await returnToTerminals(page)
    expect(await listTerminals(page)).toHaveLength(1)
    expect(await probePid(original, 'AFTER_SETTINGS')).toBe(originalPid)
    await drawer.getByRole('button', { name: 'New terminal', exact: true }).click()
    await expect(original.panel).toBeHidden()
    await expect.poll(async () => (await listTerminals(page)).length).toBe(2)
    const alternate = await activeTerminal(page)
    expect(alternate.shell).toBe(customProfile.name)
    const alternatePid = await probePid(alternate, 'ALTERNATE_PID')
    await expectShellProfile(page, alternate, 'CUSTOM_A', 'original-global-profile', projectA, true)
    await page.screenshot({ path: testInfo.outputPath('terminal-running-tabs.png') })
    expect(alternatePid).not.toBe(originalPid)
    expect(await shellIsAlive(originalPid)).toBe(true)

    // The inactive tab's close control must not close or reselect the active PTY.
    await drawer.locator(`[data-close-terminal-id="${original.terminalId}"]`).click()
    await expect(terminalPanel(page, original.terminalId)).toHaveCount(0)
    await expect(drawer.locator(`[data-tab-terminal-id="${alternate.terminalId}"]`)).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => shellIsAlive(originalPid)).toBe(false)
    expect((await listTerminals(page)).map(({ terminalId }) => terminalId)).toEqual([alternate.terminalId])
    expect(await probePid(alternate, 'AFTER_OTHER_CLOSE')).toBe(alternatePid)

    await drawer.getByRole('button', { name: 'Hide terminal (keep running)', exact: true }).click()
    await expect(drawer).toBeHidden()
    expect(await shellIsAlive(alternatePid)).toBe(true)
    await toggle.click()

    // The default is global, while every PTY still starts in its owning project.
    await addProject(app, page, projectB)
    const otherProject = await activeTerminal(page)
    expect(otherProject.shell).toBe(customProfile.name)
    await expectShellProfile(page, otherProject, 'CUSTOM_B', 'original-global-profile', projectB, true)
    expect(await shellIsAlive(alternatePid)).toBe(true)
    await page.getByRole('button', { name: `New session in ${basename(projectA)}`, exact: true }).click()
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.localPi.runtime.status()).cwd)).toBe(projectA)
    await expect(alternate.panel).toBeVisible()

    const replacementProfile = {
      id: 'custom:replacement-global-profile', name: 'Replacement sh', executable: '/bin/sh',
      args: ['-i'], env: { PIPILOT_TERMINAL_PROFILE_MARKER: 'replacement-global-profile' },
    }
    await page.evaluate(({ originalProfile, replacement }) => window.pipilot!.settings.update({ terminal: {
      profiles: [originalProfile, replacement], defaultProfileId: replacement.id,
    } }), { originalProfile: customProfile, replacement: replacementProfile })
    expect(await probePid(alternate, 'AFTER_DEFAULT_CHANGE')).toBe(alternatePid)
    await expectShellProfile(page, alternate, 'EXISTING', 'original-global-profile', projectA, true)
    await drawer.getByRole('button', { name: 'New terminal', exact: true }).click()
    await expect(alternate.panel).toBeHidden()
    const replacement = await activeTerminal(page)
    expect(replacement.shell).toBe(replacementProfile.name)
    const replacementPid = await probePid(replacement, 'REPLACEMENT_PID')
    await expectShellProfile(page, replacement, 'NEW_DEFAULT', 'replacement-global-profile', projectA, false)

    await drawer.locator(`[data-tab-terminal-id="${alternate.terminalId}"]`).click()
    await enterCommand(alternate.panel, 'exit 19')
    await expect(alternate.panel).toHaveAttribute('data-terminal-status', 'exited')
    expect((await terminalSnapshot(page, alternate.terminalId)).exitCode).toBe(19)
    await terminalAction(page, 'Restart terminal')
    const restarted = await activeTerminal(page)
    expect(restarted.terminalId).not.toBe(alternate.terminalId)
    expect(restarted.shell).toBe(customProfile.name)
    const restartedPid = await probePid(restarted, 'RESTARTED_PID')
    await expectShellProfile(page, restarted, 'RESTARTED', 'original-global-profile', projectA, true)
    expect(await shellIsAlive(replacementPid)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('terminal-original-profile-restarted.png') })
    await terminalAction(page, 'Close terminal')
    await expect(terminalPanel(page, restarted.terminalId)).toHaveCount(0)
    await expect.poll(() => shellIsAlive(restartedPid)).toBe(false)
    await expect.poll(() => shellIsAlive(alternatePid)).toBe(false)
    await expect(replacement.panel).toBeVisible()
    expect(await probePid(replacement, 'AFTER_RESTARTED_CLOSE')).toBe(replacementPid)
    await terminalAction(page, 'Close terminal')
    await expect(terminalPanel(page, replacement.terminalId)).toHaveCount(0)
    await expect.poll(() => shellIsAlive(replacementPid)).toBe(false)
    expect(await listTerminals(page)).toEqual([])
    await expect(drawer).toBeVisible()
    expect(errors).toEqual([])
  } finally {
    await fixture.close()
  }
})

test('recovers an unavailable global default without replacing existing terminals', async ({}, testInfo) => {
  test.skip(process.platform === 'win32', 'This real PTY fixture uses a deterministic POSIX shell.')
  test.setTimeout(90_000)
  const fixture = await launchTerminalFixture(testInfo)
  const { app, page, projectA, errors } = fixture
  try {
    await addProject(app, page, projectA)
    await page.getByRole('button', { name: 'Terminal', exact: true }).click()
    const original = await activeTerminal(page)
    await page.evaluate(() => window.pipilot!.settings.update({
      terminal: { defaultProfileId: 'custom:missing-profile' },
    }))
    await terminalWorkspace(page).getByRole('button', { name: 'New terminal', exact: true }).click()
    await expect(terminalWorkspace(page).getByRole('alert')).toContainText('This terminal profile is unavailable.')
    expect((await listTerminals(page)).map(({ terminalId }) => terminalId)).toEqual([original.terminalId])
    await expect(original.panel).toHaveAttribute('data-terminal-status', 'running')

    await terminalWorkspace(page).getByRole('button', { name: 'Terminal settings', exact: true }).click()
    const settings = page.getByRole('main', { name: 'Terminal', exact: true })
    await expect(settings).toBeVisible()
    await expect(page.getByRole('region', { name: 'Settings', exact: true })
      .getByRole('button', { name: 'Terminal', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(settings.getByRole('alert')).toContainText('The saved default is unavailable.')
    await settings.getByRole('button', { name: 'Use Auto', exact: true }).click()
    await expect.poll(async () => (await page.evaluate(() => window.pipilot!.settings.get()))
      .settings.terminal.defaultProfileId).toBeNull()
    await expect(settings.getByRole('combobox', { name: 'Default profile', exact: true }))
      .toHaveText('Auto (recommended)')
    await returnToTerminals(page)
    await terminalWorkspace(page).getByRole('button', { name: 'New terminal', exact: true }).click()
    await expect(original.panel).toBeHidden()
    const recovered = await activeTerminal(page)
    expect(recovered.terminalId).not.toBe(original.terminalId)
    expect((await listTerminals(page)).map(({ terminalId, status }) => ({ terminalId, status })))
      .toEqual([
        { terminalId: original.terminalId, status: 'running' },
        { terminalId: recovered.terminalId, status: 'running' },
      ])
    await enterCommand(recovered.panel, "printf 'PIPILOT_%s\\n' 'AUTO_RECOVERED'")
    await expect(recovered.panel.locator('.xterm-rows')).toContainText('PIPILOT_AUTO_RECOVERED')
    expect(errors).toEqual([])
  } finally {
    await fixture.close()
  }
})

test('keeps six terminals alive across projects until only the selected terminal is explicitly ended', async ({}, testInfo) => {
  test.skip(process.platform === 'win32', 'This real PTY fixture uses a deterministic POSIX shell.')
  test.setTimeout(120_000)
  const fixture = await launchTerminalFixture(testInfo)
  const { app, page, projectA, projectB, errors } = fixture
  type Shell = Awaited<ReturnType<typeof activeTerminal>>
  const projectTerminals: Array<Shell & { tag: string; pid: number }> = []

  // A fresh output line containing $$ proves the original shell still handles
  // input. Splitting the marker in printf prevents command echo from passing.
  const probeShell = async (terminal: Shell, tag: string, phase: string) => {
    await terminalWorkspace(page).locator(`[data-tab-terminal-id="${terminal.terminalId}"]`).click()
    await expect(terminal.panel).toHaveAttribute('data-terminal-status', 'running')
    await enterCommand(terminal.panel, `printf 'PIPILOT_%s_%s:%s\\n' '${tag}' '${phase}' "$$"`)
    const output = new RegExp(`\\r\\nPIPILOT_${tag}_${phase}:(\\d+)\\r\\n`)
    await expect.poll(async () => (await terminalSnapshot(page, terminal.terminalId)).replay).toMatch(output)
    const snapshot = await terminalSnapshot(page, terminal.terminalId)
    expect(snapshot).toMatchObject({ terminalId: terminal.terminalId, scope: terminal.scope, status: 'running' })
    const pid = Number(snapshot.replay.match(output)![1])
    await expect(terminal.panel.locator('.xterm-rows')).toContainText(`PIPILOT_${tag}_${phase}:${pid}`)
    return pid
  }
  const shellLiveness = (pids: number[]) => app.evaluate((_electron, ids) => ids.map((pid) => {
    try { process.kill(pid, 0); return true } catch { return false }
  }), pids)
  const switchProject = async (project: string) => {
    await page.getByRole('button', { name: `New session in ${basename(project)}`, exact: true }).click()
    await expect.poll(() => page.evaluate(async () => (await window.pipilot!.localPi.runtime.status()).cwd)).toBe(project)
  }

  try {
    await addProject(app, page, projectA)
    const toggle = page.getByRole('button', { name: 'Terminal', exact: true })
    const drawer = page.locator('#workspace-terminal-drawer[data-terminal-drawer]')
    await toggle.click()
    for (let index = 0; index < 5; index += 1) {
      if (index > 0) {
        await terminalWorkspace(page).getByRole('button', { name: 'New terminal', exact: true }).click()
        await expect(projectTerminals[index - 1].panel).toBeHidden()
      }
      await expect.poll(async () => (await listTerminals(page)).length).toBe(index + 1)
      const terminal = await activeTerminal(page)
      const tag = `A${index + 1}`
      const pid = await probeShell(terminal, tag, 'CREATED')
      projectTerminals.push({ ...terminal, tag, pid })
    }
    const expectedProjectTerminals = projectTerminals.map(({ terminalId, scope }) => ({ terminalId, scope, status: 'running' }))
    const listOwnedTerminals = async () => (await listTerminals(page)).map(({ terminalId, scope, status }) => ({ terminalId, scope, status }))
    const projectPids = projectTerminals.map(({ pid }) => pid)
    expect(new Set(projectTerminals.map(({ terminalId }) => terminalId)).size).toBe(5)
    expect(new Set(projectPids).size).toBe(5)
    expect(await listOwnedTerminals()).toEqual(expectedProjectTerminals)
    expect(await shellLiveness(projectPids)).toEqual(Array(5).fill(true))

    await drawer.getByRole('button', { name: 'Hide terminal (keep running)', exact: true }).click()
    await expect(drawer).toBeHidden()
    expect(await shellLiveness(projectPids)).toEqual(Array(5).fill(true))
    await toggle.click()
    const first = projectTerminals[0]
    expect(await probeShell(first, first.tag, 'AFTER_HIDE')).toBe(first.pid)

    // Opening another project creates a sixth terminal without reclaiming any
    // background shell or changing the scope that owns each terminal.
    await addProject(app, page, projectB)
    await expect(first.panel).toBeHidden()
    const sixth = await activeTerminal(page)
    const sixthPid = await probeShell(sixth, 'B1', 'CREATED')
    expect(new Set([...projectPids, sixthPid]).size).toBe(6)
    expect(sixth.scope).not.toEqual(first.scope)
    expect(await listOwnedTerminals()).toEqual([{ terminalId: sixth.terminalId, scope: sixth.scope, status: 'running' }])
    expect(await shellLiveness([...projectPids, sixthPid])).toEqual(Array(6).fill(true))
    for (const terminal of projectTerminals) await expect(terminal.panel).toBeHidden()
    const wrongProjectWrites = await page.evaluate(async ({ staleScope, currentScope, terminalId }) => {
      const outcomes = []
      for (const scope of [staleScope, currentScope]) {
        try {
          await window.pipilot!.terminal.input(scope, terminalId, 'PIPILOT_WRONG_PROJECT\r')
          outcomes.push('accepted')
        } catch (error) {
          outcomes.push(typeof error === 'object' && error !== null && 'code' in error ? error.code : 'unknown')
        }
      }
      return outcomes
    }, { staleScope: first.scope, currentScope: sixth.scope, terminalId: first.terminalId })
    expect(wrongProjectWrites).toEqual(['TERMINAL_STALE_SCOPE', 'TERMINAL_NOT_FOUND'])

    await switchProject(projectA)
    expect(await listOwnedTerminals()).toEqual(expectedProjectTerminals)
    for (const terminal of projectTerminals) {
      expect(await probeShell(terminal, terminal.tag, 'SIX_RUNNING')).toBe(terminal.pid)
      expect((await terminalSnapshot(page, terminal.terminalId)).replay).not.toContain('PIPILOT_WRONG_PROJECT')
    }
    expect(await shellLiveness([...projectPids, sixthPid])).toEqual(Array(6).fill(true))

    await switchProject(projectB)
    expect(await probeShell(sixth, 'B1', 'BEFORE_END')).toBe(sixthPid)
    await terminalAction(page, 'End terminal')
    await expect(sixth.panel).toHaveAttribute('data-terminal-status', 'exited')
    await expect.poll(() => shellLiveness([...projectPids, sixthPid])).toEqual([...Array(5).fill(true), false])
    expect(await listOwnedTerminals()).toEqual([{ terminalId: sixth.terminalId, scope: sixth.scope, status: 'exited' }])
    expect((await terminalSnapshot(page, sixth.terminalId)).replay).toContain(`\r\nPIPILOT_B1_BEFORE_END:${sixthPid}\r\n`)

    await switchProject(projectA)
    expect(await listOwnedTerminals()).toEqual(expectedProjectTerminals)
    for (const terminal of projectTerminals) {
      expect(await probeShell(terminal, terminal.tag, 'AFTER_END')).toBe(terminal.pid)
    }
    expect(await shellLiveness(projectPids)).toEqual(Array(5).fill(true))
    expect(errors).toEqual([])
  } finally {
    await fixture.close()
  }
})

test('resizes and restores the drawer, searches native output, and fits light and dark minimum windows', async ({}, testInfo) => {
  test.skip(process.platform === 'win32', 'This real PTY fixture uses a deterministic POSIX shell.')
  test.setTimeout(90_000)
  const fixture = await launchTerminalFixture(testInfo)
  const { app, page, projectA, errors } = fixture
  try {
    await addProject(app, page, projectA)
    const toggle = page.getByRole('button', { name: 'Terminal', exact: true })
    await toggle.click()
    const drawer = page.locator('#workspace-terminal-drawer[data-terminal-drawer]')
    const first = await activeTerminal(page)
    await startShell(page, first.panel, first.terminalId, 'A1')
    const resize = drawer.getByRole('separator', { name: 'Resize terminal', exact: true })
    const original = await drawer.boundingBox()
    const handle = await resize.boundingBox()
    if (!original || !handle) throw new Error('Terminal drawer resize geometry is missing')
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2, handle.y - 100, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => (await drawer.boundingBox())!.height).toBeGreaterThan(original.height + 75)
    const resizedHeight = (await drawer.boundingBox())!.height
    await drawer.getByRole('button', { name: 'Hide terminal (keep running)', exact: true }).click()
    await toggle.click()
    await expect.poll(async () => (await drawer.boundingBox())!.height).toBeCloseTo(resizedHeight, 0)
    await drawer.getByRole('button', { name: 'Maximize terminal', exact: true }).click()
    await expect.poll(async () => (await drawer.boundingBox())!.height).toBeGreaterThan(resizedHeight + 100)
    await expect(drawer.getByRole('button', { name: 'Restore terminal', exact: true })).toBeInViewport({ ratio: 1 })
    await drawer.getByRole('button', { name: 'Restore terminal', exact: true }).click()
    await expect.poll(async () => (await drawer.boundingBox())!.height).toBeCloseTo(resizedHeight, 0)

    await terminalWorkspace(page).getByRole('button', { name: 'New terminal', exact: true }).click()
    await expect(first.panel).toBeHidden()
    const pasted = await activeTerminal(page)

    // Persisted height must survive a renderer reload, with the same live PTYs.
    await page.reload()
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await expect(drawer).toBeHidden()
    await toggle.click()
    await expect(pasted.panel).toHaveAttribute('data-terminal-status', 'running')
    await expect.poll(async () => (await drawer.boundingBox())!.height).toBeCloseTo(resizedHeight, 0)
    expect((await listTerminals(page)).map(({ terminalId }) => terminalId)).toEqual([first.terminalId, pasted.terminalId])

    // The first tab has not initialized its emulator since reload. Its async
    // attach must preserve roving focus, so the next arrow still changes tabs.
    const firstTab = terminalWorkspace(page).locator(`[data-tab-terminal-id="${first.terminalId}"]`)
    const secondTab = terminalWorkspace(page).locator(`[data-tab-terminal-id="${pasted.terminalId}"]`)
    await secondTab.focus()
    await secondTab.press('ArrowLeft')
    await expect(first.panel).toHaveAttribute('data-terminal-status', 'running')
    await expect(firstTab).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(secondTab).toHaveAttribute('aria-selected', 'true')
    await expect(secondTab).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(firstTab).toHaveAttribute('aria-selected', 'true')
    await expect(firstTab).toBeFocused()

    // Keep the user's system clipboard untouched while exercising the browser
    // clipboard boundary and the real terminal's selection and input paths.
    await isolateClipboard(page)

    await first.panel.getByRole('textbox', { name: 'Interactive terminal input', exact: true }).focus()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f')
    const search = drawer.getByRole('textbox', { name: 'Find in terminal', exact: true })
    await expect(search).toBeFocused()
    await search.fill('PIPILOT_A1_SCROLL:0024')
    await search.press('Enter')
    await expect(first.panel.locator('.xterm-rows')).toContainText('PIPILOT_A1_SCROLL:0024')
    await terminalWorkspace(page).getByRole('button', { name: 'Copy terminal text', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Copy selection', exact: true }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('PIPILOT_A1_SCROLL:0024')
    await terminalWorkspace(page).getByRole('button', { name: 'Copy terminal text', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Copy all output', exact: true }).click()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toContain('PIPILOT_A1_SCROLL:0000')
    expect(copied).toContain('PIPILOT_A1_READY')
    await search.focus()
    await search.press('Escape')
    await expect(search).toBeHidden()
    await expect(first.panel.getByRole('textbox', { name: 'Interactive terminal input', exact: true })).toBeFocused()

    await page.setViewportSize({ width: 1100, height: 680 })
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((theme) => window.pipilot!.settings.update({ appearance: { theme } }), theme)
      await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(theme === 'dark')
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await expect(drawer).toBeVisible()
      await expect(drawer.getByRole('button', { name: 'Hide terminal (keep running)', exact: true })).toBeInViewport({ ratio: 1 })
      await expect(drawer.getByRole('button', { name: 'Maximize terminal', exact: true })).toBeInViewport({ ratio: 1 })
      const screen = first.panel.locator('.xterm-screen')
      await expect(screen).toBeInViewport({ ratio: 1 })
      await expect.poll(() => screen.evaluate((element) => {
        const surface = element.closest('[role="application"]')!.getBoundingClientRect()
        const bounds = element.getBoundingClientRect()
        return bounds.width > 100 && bounds.height > 50 && bounds.left >= surface.left && bounds.top >= surface.top &&
          bounds.right <= surface.right + 1 && bounds.bottom <= surface.bottom + 1
      })).toBe(true)
      await expect(first.panel.getByRole('textbox', { name: 'Interactive terminal input', exact: true })).toHaveCount(1)
      await page.screenshot({ path: testInfo.outputPath(`terminal-drawer-${theme}-1100x680.png`), animations: 'disabled' })
    }
    await secondTab.click()
    await expect(first.panel).toBeHidden()
    await page.evaluate(() => navigator.clipboard.writeText("printf 'PIPILOT_%s\\n' 'PASTE_OK'"))
    await terminalWorkspace(page).getByRole('button', { name: 'Copy terminal text', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Paste', exact: true }).click()
    await pasted.panel.getByRole('textbox', { name: 'Interactive terminal input', exact: true }).press('Enter')
    await expect.poll(async () => (await terminalSnapshot(page, pasted.terminalId)).replay).toContain('\r\nPIPILOT_PASTE_OK\r\n')
    expect((await listTerminals(page)).map(({ terminalId }) => terminalId)).toEqual([first.terminalId, pasted.terminalId])
    expect(errors).toEqual([])
  } finally {
    await fixture.close()
  }
})
