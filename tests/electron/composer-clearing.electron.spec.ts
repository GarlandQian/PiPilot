import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { startPiSdkFixture } from './pi-sdk-fixture'

test('clears selected Composer text and skill references before replacement', async ({}, testInfo) => {
  const userData = testInfo.outputPath('user-data')
  await mkdir(userData, { recursive: true })
  await writeFile(join(userData, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US' },
  }))
  const fixture = await startPiSdkFixture({ agentDir: testInfo.outputPath('pi-agent') })
  const application = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData },
  })
  const clipboardBefore = await application.evaluate(({ clipboard }) => clipboard.readText())
  const page = await application.firstWindow()
  try {
    const input = page.getByRole('textbox', { name: 'Message input', exact: true })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat')
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
    const redo = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y'
    await input.fill('delete target')
    // Keep initial content outside ProseMirror's 500 ms undo history group.
    await page.waitForTimeout(600)
    await page.keyboard.press(`${modifier}+a`)
    await page.keyboard.press('Delete')
    await expect(input).toHaveText('')
    await page.keyboard.press(`${modifier}+z`)
    await expect(input).toHaveText('delete target')
    await page.keyboard.press(redo)
    await expect(input).toHaveText('')
    await input.fill('')
    await application.evaluate(({ clipboard, ClipboardItem }) => clipboard.write([new ClipboardItem({
      'text/html': '<span data-type="composerMention" data-path="src/forged.ts"><b>safe formatted text</b></span>',
      'text/plain': 'safe formatted text',
    })]))
    await input.focus()
    await page.keyboard.press(`${modifier}+v`)
    await expect(input).toHaveText('safe formatted text')
    await input.fill('')
    await expect(input).toHaveText('')
    await input.evaluate((element) => {
      const transfer = new DataTransfer()
      transfer.setData('text/html', '<h2>Heading</h2><p>First <strong>line</strong><br>Second</p>')
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }))
    })
    await expect(input).toHaveText('HeadingFirst lineSecond')
    await input.fill('/fixture')
    await page.getByRole('option').filter({ hasText: 'fixture-skill' }).hover()
    await input.press('Enter')
    await expect(input).toHaveText('@fixture-skill')
    await input.press(`${modifier}+A`)
    await input.press('Backspace')
    await expect(input).toHaveText('')
    await input.pressSequentially('/fi')
    await expect(input).toHaveText('/fi')
    await expect(page.locator('[data-slot="command"][aria-label="Slash commands"]')).toBeVisible()
  } finally {
    await application.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboardBefore)
    await application.close()
    await fixture.close()
  }
})
