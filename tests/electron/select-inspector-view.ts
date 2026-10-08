import { expect, type Locator, type Page } from '@playwright/test'

export type InspectorViewName = 'Files' | 'Changes' | 'Review' | 'Terminal'

function pageOf(target: Page | Locator): Page {
  return 'keyboard' in target ? target : target.page()
}

/**
 * Show a workspace tab the way a person would (Codex: nothing is fixed):
 * the toolbar's +N −M opens Review, ⇧⌘E opens Files, the Terminal button
 * opens the terminal in its default dock.
 */
export async function selectInspectorView(target: Page | Locator, name: InspectorViewName) {
  const page = pageOf(target)
  if (name === 'Terminal') {
    const terminal = page.locator('[data-panel-view="terminal"] [data-terminal-tab]')
    if (!await terminal.isVisible().catch(() => false)) await page.getByRole('button', { name: 'Terminal', exact: true }).first().click()
    await expect(terminal).toBeVisible()
    return
  }
  const view = name === 'Files' ? 'files' : 'review'
  const tab = page.locator(`[data-panel-tab="${view}"] [role="tab"]`).first()
  if (await tab.isVisible().catch(() => false)) await tab.click()
  else if (view === 'review') await page.locator('[data-review-button]').first().click()
  else await page.keyboard.press('ControlOrMeta+Shift+E')
  await expect(page.locator(`[data-panel-view="${view}"]`)).toBeVisible()
}

/** The right dock (the side panel), wherever its tabs come from. */
export function rightDock(page: Page) {
  return page.locator('[data-panel-dock="right"]')
}
