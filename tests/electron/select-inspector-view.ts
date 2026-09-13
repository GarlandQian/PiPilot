import { expect, type Locator, type Page } from '@playwright/test'

export type InspectorViewName = 'Files' | 'Changes' | 'Terminal'

export async function selectInspectorView(
  target: Page | Locator,
  name: InspectorViewName,
) {
  const page = 'page' in target ? target.page() : target
  await target.getByRole('button', { name: 'Switch inspector view', exact: true }).click()
  // The view menu is portaled outside the inspector, including in compact dialogs.
  await page.getByRole('menuitemradio', { name, exact: true }).click()
  await expect(target.getByRole('region', { name, exact: true })).toBeVisible()
}
