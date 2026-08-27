import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'

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

async function activeOption(page: Page, composer: Locator) {
  const id = await composer.getAttribute('aria-activedescendant')
  expect(id).toBeTruthy()
  const option = page.locator(`[id="${id}"]`)
  await expect(option).toHaveCount(1)
  await expect(option).toBeVisible()
  return option
}

async function expectInsideConversationColumn(
  page: Page,
  notification: Locator,
) {
  const [mainBox, headerBox, notificationBox] = await Promise.all([
    page.locator('main').boundingBox(),
    page.locator('main > header').boundingBox(),
    notification.boundingBox(),
  ])
  expect(mainBox).not.toBeNull()
  expect(headerBox).not.toBeNull()
  expect(notificationBox).not.toBeNull()
  if (!mainBox || !headerBox || !notificationBox) return
  expect(notificationBox.x).toBeGreaterThanOrEqual(mainBox.x)
  expect(notificationBox.x + notificationBox.width)
    .toBeLessThanOrEqual(mainBox.x + mainBox.width + 1)
  expect(notificationBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height)
}

async function expectNoDocumentHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth))
    .toBe(true)
}

test('uses one keyboard-safe Composer picker and middle-column extension surfaces', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userDataPath = testInfo.outputPath('user-data')
  const workspacePath = testInfo.outputPath('workspace')
  const fakeAgentDir = testInfo.outputPath('pi-agent')
  await mkdir(join(workspacePath, 'src'), { recursive: true })
  await mkdir(userDataPath, { recursive: true })
  await writeFile(join(workspacePath, 'README.md'), '# Fixture\n')
  await writeFile(join(workspacePath, 'src', 'alpha.ts'), 'export const alpha = true\n')
  await writeFile(join(workspacePath, 'src', 'beta-with-a-long-file-name.ts'), 'export const beta = true\n')
  const canonicalWorkspacePath = await realpath(workspacePath)
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
      PIPILOT_E2E_UI_SURFACES: '1',
      PIPILOT_E2E_DISABLE_AUTO_RESTART: '1',
      PIPILOT_E2E_USER_DATA: userDataPath,
    },
  })

  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const composer = page.getByRole('textbox', { name: 'Message input' })
    const shortcutModifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    await expect.poll(() => page.evaluate(() =>
      window.pipilot!.localPi.runtime.status()))
      .toMatchObject({ state: 'ready' })
    await expect(page.getByRole('button', {
      name: 'Current model Fake Chat, click to switch',
    })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add reference', exact: true }))
      .toHaveCount(0)

    await selectWorkspaceFromSystemDialog(electronApp, workspacePath)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
    await expect.poll(async () => {
      const runtime = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
      return { state: runtime.state, cwd: runtime.cwd }
    }, { timeout: 20_000 }).toEqual({ state: 'ready', cwd: canonicalWorkspacePath })
    const selectedModelButton = page.getByRole('button', {
      name: 'Current model Fake Chat, click to switch',
    })
    await expect(selectedModelButton).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Add image', exact: true })).toBeEnabled()

    await composer.fill('/fixture')
    const slashMenu = page.locator('[data-slot="command"][aria-label="Slash commands"]')
    await expect(slashMenu).toBeVisible()
    await expect(slashMenu.getByText('Commands', { exact: true })).toBeVisible()
    await expect(slashMenu.getByText('Skills', { exact: true })).toBeVisible()
    await expect(slashMenu.getByPlaceholder('Search installed skills…')).toHaveCount(0)
    await expect(composer).toHaveAttribute('aria-expanded', 'true')
    await expect(composer).toHaveAttribute('aria-controls', 'composer-slash-listbox')
    await expect(slashMenu.getByRole('listbox')).toHaveAttribute('id', 'composer-slash-listbox')

    const initialSlashOption = await activeOption(page, composer)
    await expect(initialSlashOption).toHaveAttribute('data-composer-picker-group', 'commands')
    const initialSlashId = await composer.getAttribute('aria-activedescendant')
    await composer.dispatchEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'ArrowDown',
      key: 'ArrowDown',
      keyCode: 229,
      which: 229,
    })
    await expect(composer).toHaveAttribute('aria-activedescendant', initialSlashId ?? '')

    const commandOption = slashMenu.getByRole('option').filter({ hasText: '/fixture-command' })
    await commandOption.hover()
    await expect(await activeOption(page, composer))
      .toHaveAttribute('data-composer-picker-group', 'commands')
    const slashOptionIds = await slashMenu.getByRole('option').evaluateAll((options) =>
      options.map((option) => option.id))
    const commandOptionId = await commandOption.getAttribute('id')
    expect(commandOptionId).toBeTruthy()
    const commandIndex = slashOptionIds.indexOf(commandOptionId!)
    expect(commandIndex).toBeGreaterThanOrEqual(0)
    for (let offset = 1; offset < slashOptionIds.length; offset += 1) {
      await composer.press('ArrowDown')
      await expect(composer).toHaveAttribute(
        'aria-activedescendant',
        slashOptionIds[(commandIndex + offset) % slashOptionIds.length],
      )
    }
    await composer.press('ArrowDown')
    await expect(composer).toHaveAttribute('aria-activedescendant', commandOptionId!)
    await composer.press('ArrowUp')
    let activeIndex = (commandIndex - 1 + slashOptionIds.length) % slashOptionIds.length
    await expect(composer).toHaveAttribute('aria-activedescendant', slashOptionIds[activeIndex])
    const fixtureSkillId = await slashMenu.getByRole('option')
      .filter({ hasText: 'fixture-skill' })
      .getAttribute('id')
    expect(fixtureSkillId).toBeTruthy()
    const fixtureSkillIndex = slashOptionIds.indexOf(fixtureSkillId!)
    expect(fixtureSkillIndex).toBeGreaterThanOrEqual(0)
    while (activeIndex !== fixtureSkillIndex) {
      await composer.press('ArrowDown')
      activeIndex = (activeIndex + 1) % slashOptionIds.length
      await expect(composer).toHaveAttribute('aria-activedescendant', slashOptionIds[activeIndex])
    }
    await composer.press('Enter')
    await expect(composer).toHaveText('@fixture-skill')
    await expect(page.locator('[data-composer-mention-kind="skill"]')).toHaveCount(1)
    await expect(composer).toBeFocused()

    await composer.press(`${shortcutModifier}+A`)
    await composer.press('Backspace')
    await composer.pressSequentially('/fi')
    await expect(slashMenu).toBeVisible()
    await composer.press('Escape')
    await expect(slashMenu).toHaveCount(0)
    await expect(composer).toHaveText('/fi')
    await expect(composer).toHaveAttribute('aria-expanded', 'false')
    await expect(composer).not.toHaveAttribute('aria-activedescendant', /.+/)

    await composer.fill('@')
    const mentionMenu = page.locator('[data-slot="command"][aria-label="Files and Skills"]')
    await expect(mentionMenu).toBeVisible()
    await expect(mentionMenu.getByText('Files', { exact: true })).toBeVisible()
    await expect(mentionMenu.getByText('Skills', { exact: true })).toBeVisible()
    await expect(mentionMenu.getByText('@', { exact: true })).toHaveCount(0)
    await expect(composer).toHaveAttribute('aria-controls', 'composer-mention-listbox')
    await expect(mentionMenu.getByRole('listbox'))
      .toHaveAttribute('id', 'composer-mention-listbox')
    const fileOptions = mentionMenu.locator('[role="option"][data-composer-picker-group="files"]')
    await expect(fileOptions.first()).toBeVisible()
    await expect(await activeOption(page, composer))
      .toHaveAttribute('data-composer-picker-group', 'files')
    const initialMentionId = await composer.getAttribute('aria-activedescendant')
    await composer.dispatchEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'ArrowDown',
      key: 'ArrowDown',
      keyCode: 229,
      which: 229,
    })
    await expect(composer).toHaveAttribute('aria-activedescendant', initialMentionId ?? '')
    const fileCount = await fileOptions.count()
    for (let index = 0; index < fileCount; index += 1) {
      await composer.press('ArrowDown')
    }
    await expect(await activeOption(page, composer))
      .toHaveAttribute('data-composer-picker-group', 'skills')
    await composer.press('Enter')
    await expect(page.locator('[data-composer-mention-kind="skill"]')).toHaveCount(1)
    await expect(composer).toBeFocused()

    await composer.fill('@no-matching-candidate')
    await expect(mentionMenu).toBeVisible()
    await expect(mentionMenu.getByText('No matching paths', { exact: true })).toBeVisible()
    await expect(mentionMenu.getByText('No matching skills', { exact: true })).toBeVisible()
    await expect(composer).toHaveAttribute('aria-expanded', 'true')
    await expect(composer).not.toHaveAttribute('aria-activedescendant', /.+/)
    await composer.press('Enter')
    await expect(composer).toHaveText('@no-matching-candidate')
    await composer.press('Escape')
    await expect(composer).toHaveAttribute('aria-expanded', 'false')

    await composer.fill('ui')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Continue?' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Yes', exact: true }).click()
    const transcript = page.getByRole('log', { name: 'Conversation' })
    const notification = transcript.getByText('Fixture notification', { exact: true })
    await expect(notification).toBeVisible()
    const widgetActivity = transcript.getByText('Fixture widget', { exact: true })
    await expect(widgetActivity).toBeVisible()
    await widgetActivity.click()
    await expect(transcript.getByText('ready', { exact: true })).toBeVisible()
    const notificationButton = page.getByRole('button', {
      name: 'Notifications',
      exact: true,
    })
    await notificationButton.click()
    await expect(page.getByText('No notifications', { exact: true })).toBeVisible()
    await notificationButton.click()
    await expectInsideConversationColumn(page, widgetActivity)

    const resizeHandle = page.getByRole('separator', {
      name: 'Resize inspector: arrow keys to adjust, double-click to reset',
    })
    await resizeHandle.focus()
    await resizeHandle.press('ArrowLeft')
    await expectInsideConversationColumn(page, widgetActivity)
    await page.getByRole('button', { name: 'Collapse panel', exact: true }).click()
    await expectInsideConversationColumn(page, widgetActivity)
    await page.getByRole('button', { name: 'Toggle context panel', exact: true }).click()
    await expectInsideConversationColumn(page, widgetActivity)
    await page.screenshot({ path: testInfo.outputPath('extension-surfaces-desktop-light.png') })

    await composer.fill('@beta')
    await expect(mentionMenu.getByRole('option', {
      name: /src\/beta-with-a-long-file-name\.ts/,
    })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('composer-extension-desktop-light.png') })

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1100, 680)
    })
    await expect.poll(() => page.evaluate(() => window.innerWidth <= 1100 && window.innerWidth >= 960))
      .toBe(true)
    await expectNoDocumentHorizontalOverflow(page)
    await expectInsideConversationColumn(page, widgetActivity)
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
    await expectNoDocumentHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath('composer-extension-minimum-dark.png') })

    await composer.fill('/mcp')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Integrations', exact: true }))
      .toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('tab', { name: 'MCP', exact: true }))
      .toHaveAttribute('aria-selected', 'true')
  } finally {
    await electronApp.close()
    await piFixture.close()
  }
})
