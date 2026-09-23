import { expect, type Locator, type Page } from '@playwright/test'

export type InspectorViewName = 'Files' | 'Changes' | 'Terminal' | 'Agents'

export async function selectInspectorView(
  target: Page | Locator,
  name: InspectorViewName,
) {
  if (name === 'Terminal') {
    const toggle = target.getByRole('button', { name: 'Terminal', exact: true })
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
    await expect(target.locator('[data-terminal-drawer]')).toBeVisible()
    return
  }
  await target.getByRole('tab', { name, exact: true }).click()
  await expect(target.getByRole('tabpanel', { name, exact: true })).toBeVisible()
}
