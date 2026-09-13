import { expect, type ElectronApplication } from '@playwright/test'

/** Explicitly discard only isolated fixture drafts while exercising normal Quit. */
export async function closeFixtureApplication(app: ElectronApplication) {
  const page = app.windows()[0]
  if (!page || page.isClosed()) {
    await app.close()
    return
  }
  const closed = app.waitForEvent('close', { timeout: 10_000 })
  await app.evaluate(({ app }) => { app.quit() })
  const discard = async () => {
    const dialog = page.getByRole('alertdialog', {
      name: /^(Save configuration before quitting\?|退出前保存配置？)$/,
    })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /^(Discard|放弃)$/ }).click()
  }
  // A clean Quit can detach the page before Electron emits its final close.
  // In that case the missing draft dialog is expected; still require exit.
  await Promise.race([closed, discard().catch(() => closed)])
  await closed
}
