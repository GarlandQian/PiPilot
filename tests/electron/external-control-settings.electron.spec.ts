import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test,
} from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { ConversationMcpBridgeClient } from '../../src/main/external-control/bridge-client'
import { ExternalControlDescriptorRepository } from '../../src/main/external-control/descriptor-repository'

test('manages External Control in the compact Integrations tab', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const userDataPath = testInfo.outputPath('user-data')
  const launcherDirectory = join(userDataPath, 'launcher-bin')
  await mkdir(userDataPath, { recursive: true })
  await writeFile(
    `${userDataPath}/settings.json`,
    `${JSON.stringify({
      version: SETTINGS_SCHEMA_VERSION,
      settings: { ...DEFAULT_SETTINGS, locale: 'en-US' },
    }, null, 2)}\n`,
    'utf8',
  )

  const electronApp = await electron.launch({
    args: [process.cwd()],
    env: {
      ...process.env,
      PIPILOT_E2E_EXTERNAL_CONTROL_LAUNCHER_DIRECTORY: launcherDirectory,
      PIPILOT_E2E_EXTERNAL_CONTROL_EXECUTABLE: process.execPath,
      PIPILOT_E2E_USER_DATA: userDataPath,
      PIPILOT_PACKAGED_SMOKE: '1',
    },
  })
  let bridgeClient: ConversationMcpBridgeClient | null = null

  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1100, 680)
    })
    await page.setViewportSize({ width: 1100, height: 680 })

    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page
      .getByRole('region', { name: 'Settings', exact: true })
      .getByRole('button', { name: 'Integrations', exact: true })
      .click()
    await page.getByRole('tab', { name: 'External Control', exact: true }).click()

    const enableSwitch = page.getByRole('switch', {
      name: 'Enable External Control',
      exact: true,
    })
    await expect(enableSwitch).not.toBeChecked()
    await expect(page.getByText('Disabled', { exact: true })).toBeVisible()
    await expect(page.getByText('Not installed', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Install', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.pipilot!.externalControl.getLauncher()))
      .toEqual({ state: 'installed', managed: true, requiresClientRestart: false })
    await expect(page.getByText('Installed', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Uninstall', exact: true }).click()
    const uninstallConfirmation = page.getByRole('alertdialog')
    await expect(uninstallConfirmation.getByText('Uninstall MCP launcher?', { exact: true }))
      .toBeVisible()
    await uninstallConfirmation.getByRole('button', {
      name: 'Uninstall launcher',
      exact: true,
    }).click()
    await expect.poll(() => page.evaluate(() => window.pipilot!.externalControl.getLauncher()))
      .toEqual({ state: 'missing', managed: false, requiresClientRestart: false })
    await expect(page.getByText('Not installed', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Install', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.pipilot!.externalControl.getLauncher()))
      .toEqual({ state: 'installed', managed: true, requiresClientRestart: false })

    await enableSwitch.click()
    await expect.poll(() => page.evaluate(() => window.pipilot!.externalControl.get()))
      .toMatchObject({ enabled: true, state: 'ready' })
    await expect(enableSwitch).toBeChecked()
    await expect(page.getByText('Ready', { exact: true })).toBeVisible()

    const configuration = await page.locator('pre code').textContent()
    expect(configuration).not.toBeNull()
    const parsedConfiguration = JSON.parse(configuration!) as {
      mcpServers: {
        pipilot: {
          command: string
          args: string[]
          token?: string
        }
      }
    }
    expect(parsedConfiguration).toEqual({
      mcpServers: {
        pipilot: { command: 'pipilot-mcp', args: [] },
      },
    })
    expect(parsedConfiguration.mcpServers.pipilot.token).toBeUndefined()
    await page.getByRole('button', { name: 'Copy JSON', exact: true }).click()
    await expect(page.getByText('Copied', { exact: true })).toBeVisible()
    await expect.poll(() => electronApp.evaluate(({ clipboard }) => (
      clipboard.readText()
    ))).toBe(configuration)
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.scrollWidth <= document.documentElement.clientWidth
    ))).toBe(true)
    await expect.poll(() => page.getByRole('tablist', {
      name: 'Integrations',
      exact: true,
    }).evaluate((tablist) => {
      const scroller = tablist.parentElement
      return Boolean(scroller && scroller.scrollWidth <= scroller.clientWidth)
    })).toBe(true)
    await expect.poll(() => page.evaluate(() => (
      document.getAnimations().every((animation) => animation.playState !== 'running')
    ))).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('external-control-ready-light.png'),
    })

    bridgeClient = new ConversationMcpBridgeClient(
      new ExternalControlDescriptorRepository(join(
        userDataPath,
        'external-control',
        'descriptor.json',
      )),
    )
    await bridgeClient.connect()
    await expect.poll(() => page.evaluate(() => window.pipilot!.externalControl.get()))
      .toMatchObject({ connectedClients: 1 })
    await expect(page.getByText('1 connected client', { exact: true })).toBeVisible()

    await enableSwitch.click()
    const confirmation = page.getByRole('alertdialog')
    await expect(confirmation.getByText('Disconnect MCP clients?', { exact: true }))
      .toBeVisible()
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(enableSwitch).toBeChecked()

    await enableSwitch.click()
    await confirmation.getByRole('button', {
      name: 'Disable and disconnect',
      exact: true,
    }).click()
    await expect.poll(() => page.evaluate(() => window.pipilot!.externalControl.get()))
      .toMatchObject({ enabled: false, state: 'disabled', connectedClients: 0 })
    await expect(enableSwitch).not.toBeChecked()

    await enableSwitch.click()
    await expect.poll(() => page.evaluate(() => window.pipilot!.externalControl.get()))
      .toMatchObject({ enabled: true, state: 'ready', recentOperations: [] })
    await page.evaluate(() => window.pipilot!.settings.update({
      appearance: { theme: 'dark' },
      locale: 'zh-CN',
    }))
    await expect(page.getByRole('tab', { name: '外部控制', exact: true })).toBeVisible()
    await expect(page.getByText('就绪', { exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => (
      document.documentElement.classList.contains('dark') &&
      document.documentElement.scrollWidth <= document.documentElement.clientWidth &&
      document.getAnimations().every((animation) => animation.playState !== 'running')
    ))).toBe(true)
    await page.screenshot({
      path: testInfo.outputPath('external-control-ready-dark-zh.png'),
    })
  } finally {
    bridgeClient?.close()
    await electronApp.close()
  }
})
