import { access, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'

async function exists(path: string) {
  try { await access(path); return true } catch { return false }
}

async function seedNamedConversation(page: Page, name: string) {
  const composer = page.getByRole('textbox', { name: 'Message input', exact: true })
  await composer.fill(name)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByRole('log', { name: 'Conversation' }).getByText(
    `Fixture response: ${name}`, { exact: true },
  )).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  await page.evaluate((title) => window.pipilot!.localPi.runtime.command({
    type: 'set_session_name', name: title,
  }), name)
  await expect(page.getByRole('region', { name: 'General chats', exact: true })
    .getByRole('button', { name, exact: true })).toBeVisible()
}

test('keeps model feedback on its exact visit and blocks submission during A/B/A hydration', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const userDataPath = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const gateDir = testInfo.outputPath('model-gates')
  await mkdir(userDataPath, { recursive: true })
  await mkdir(gateDir, { recursive: true })
  await writeFile(join(userDataPath, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US' },
  }))
  const fixture = await startPiSdkFixture({ agentDir, includeReasoningModel: true })
  // Only the fixture extension pauses a documented SDK event. The shipped
  // bridge, Host, Runtime, and renderer still execute their ordinary path.
  await writeFile(join(agentDir, 'extensions', 'model-operation-gate.js'), `
import { existsSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export default function modelOperationGate(pi) {
  pi.on('model_select', async (event) => {
    if (event.source !== 'set') return
    const prefix = join(${JSON.stringify(gateDir)}, event.model.id)
    if (!existsSync(prefix + '.armed')) return
    renameSync(prefix + '.armed', prefix + '.started')
    const deadline = Date.now() + 25000
    while (!existsSync(prefix + '.release') && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    writeFileSync(prefix + '.finished', 'finished')
  })
}
`)
  const electronApp = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userDataPath },
  })

  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.setViewportSize({ width: 1440, height: 900 })
    const modelTrigger = page.locator('[data-model-thinking-trigger]')
    await expect(modelTrigger).toContainText('Fake Chat', { timeout: 20_000 })
    const initialDraft = page.getByRole('textbox', { name: 'Message input', exact: true })
    await initialDraft.fill('A valid unsent draft survives an unrelated action failure')
    await page.getByRole('button', { name: 'Conversation actions', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Compact conversation', exact: true }).click()
    await expect(page.locator('[data-conversation-action-error="compact"]'))
      .toContainText('Nothing to compact')
    await expect(initialDraft).toHaveAttribute('aria-invalid', 'false')
    await expect(initialDraft).toHaveText('A valid unsent draft survives an unrelated action failure')
    await modelTrigger.click()
    await expect(page.getByRole('option', { name: /Fake Fast/ })).toBeEnabled()
    await expect(page.locator('[data-model-action-error]')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await seedNamedConversation(page, 'Operation owner A')
    await page.getByRole('button', { name: 'New general chat', exact: true }).click()
    await expect(modelTrigger).toContainText('Fake Chat', { timeout: 20_000 })
    await expect(page.locator('[data-conversation-action-error]')).toHaveCount(0)
    await seedNamedConversation(page, 'Operation owner B')
    const generalChats = page.getByRole('region', { name: 'General chats', exact: true })
    const ownerA = generalChats.getByRole('button', { name: 'Operation owner A', exact: true })
    const ownerB = generalChats.getByRole('button', { name: 'Operation owner B', exact: true })

    await ownerA.click()
    await expect(modelTrigger).toContainText('Fake Chat')
    await writeFile(join(gateDir, 'fake-fast.armed'), 'armed')
    await modelTrigger.click()
    await page.getByRole('option', { name: /Fake Fast/ }).click()
    await expect.poll(() => exists(join(gateDir, 'fake-fast.started'))).toBe(true)
    await page.keyboard.press('Escape')
    await ownerB.click()
    await expect(modelTrigger).toContainText('Fake Chat')
    await modelTrigger.click()
    await expect(page.getByRole('option', { name: /Fake Fast/ })).toBeEnabled()
    await writeFile(join(gateDir, 'fake-fast.release'), 'release')
    await expect.poll(() => exists(join(gateDir, 'fake-fast.finished'))).toBe(true)
    await expect(page.getByRole('option', { name: /Fake Fast/ })).toBeVisible()
    await expect(page.locator('[data-model-action-error]')).toHaveCount(0)
    await expect(modelTrigger).toContainText('Fake Chat')
    await page.keyboard.press('Escape')

    await ownerA.click()
    await expect(modelTrigger).toContainText('Fake Fast')
    const composer = page.getByRole('textbox', { name: 'Message input', exact: true })
    const unconfirmedDraft = 'Do not dispatch until this exact conversation is ready'
    await composer.fill(unconfirmedDraft)
    await writeFile(join(gateDir, 'fake-reasoning.armed'), 'armed')
    await modelTrigger.click()
    await page.getByRole('option', { name: /Fake Reasoning/ }).click()
    await expect.poll(() => exists(join(gateDir, 'fake-reasoning.started'))).toBe(true)
    await page.keyboard.press('Escape')
    await ownerB.click()
    await expect(modelTrigger).toContainText('Fake Chat')
    await ownerA.click()
    await expect(page.getByText(/^Loading conversation/u)).toBeVisible()
    await expect(composer).toHaveAttribute('contenteditable', 'false')
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
    await composer.press('Enter')
    expect(fixture.prompts).not.toContain(unconfirmedDraft)

    await writeFile(join(gateDir, 'fake-reasoning.release'), 'release')
    await expect(modelTrigger).toContainText('Fake Reasoning', { timeout: 20_000 })
    await expect(composer).toHaveAttribute('contenteditable', 'true')
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
    await expect(composer).toHaveText(unconfirmedDraft)
    await composer.fill(`${unconfirmedDraft}; now confirmed`)
    await expect(composer).toHaveText(`${unconfirmedDraft}; now confirmed`)
    await expect(composer).toHaveAttribute('aria-invalid', 'false')
    expect(fixture.prompts).not.toContain(unconfirmedDraft)
    await modelTrigger.click()
    await expect(page.getByRole('option', { name: 'High', exact: true })).toBeEnabled()
    await page.screenshot({ path: testInfo.outputPath('model-picker-desktop-light.png') })
  } finally {
    await writeFile(join(gateDir, 'fake-fast.release'), 'release')
    await writeFile(join(gateDir, 'fake-reasoning.release'), 'release')
    await electronApp.close()
    await fixture.close()
  }
})
