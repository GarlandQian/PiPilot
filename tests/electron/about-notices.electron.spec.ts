import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _electron as electron, expect, test as base, type Locator, type Page } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { closeFixtureApplication } from './close-fixture-application'
import { startPiSdkFixture } from './pi-sdk-fixture'

const LONG_LICENSE = [
  'BEGIN COMPLETE SYNTHETIC LICENSE — whitespace and Unicode must survive.',
  '',
  ...Array.from({ length: 420 }, (_, index) => (
    `Clause ${String(index + 1).padStart(3, '0')}: This deterministic fixture exercises the complete license reader.\n  Indented line ${index + 1}: permission, attribution, and warranty text.`
  )),
  '',
  `Unbroken token: ${'fixture-license-token-'.repeat(70)}`,
  '',
  'END COMPLETE SYNTHETIC LICENSE — 最后一行。',
  '',
].join('\n')

const NOTICES = {
  packages: Array.from({ length: 96 }, (_, index) => ({
    name: `@notices-fixture/package-${String(index).padStart(3, '0')}`,
    version: `1.0.${index}`,
    license: index % 8 === 0 ? 'Apache-2.0' : 'MIT',
    url: `https://example.invalid/notices/package-${index}`,
    textId: 'complete-license',
  })),
  texts: { 'complete-license': LONG_LICENSE },
}

const test = base.extend<{ noticesPage: Page }>({
  noticesPage: async ({}, use, testInfo) => {
    const userDataPath = testInfo.outputPath('user-data')
    await mkdir(userDataPath, { recursive: true })
    await writeFile(resolve(userDataPath, 'settings.json'), JSON.stringify({
      version: SETTINGS_SCHEMA_VERSION,
      settings: {
        ...DEFAULT_SETTINGS,
        locale: 'en-US',
        appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true },
      },
    }))
    const fixture = await startPiSdkFixture({ agentDir: testInfo.outputPath('pi-agent') })
    try {
      const app = await electron.launch({
        args: [resolve(process.cwd())],
        env: {
          ...process.env,
          ...fixture.env,
          PIPILOT_E2E_USER_DATA: userDataPath,
          PIPILOT_E2E_DISABLE_AUTO_RESTART: '1',
        },
      })
      try {
        const page = await app.firstWindow()
        await page.waitForLoadState('domcontentloaded')
        await page.setViewportSize({ width: 1440, height: 900 })
        await use(page)
      } finally {
        await closeFixtureApplication(app)
      }
    } finally {
      await fixture.close()
    }
  },
})

type NoticesFixtureWindow = Window & { noticesFixtureAttempts?: number }

async function serveNotices(page: Page, failFirst = false) {
  // Electron's pipilot:// protocol bypasses Playwright's network routing.
  await page.evaluate(({ notices, failFirst }) => {
    const fixtureWindow = window as NoticesFixtureWindow
    const originalFetch = window.fetch.bind(window)
    fixtureWindow.noticesFixtureAttempts = 0
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.href)
      if (url.pathname !== '/third-party-notices.json') return originalFetch(input, init)
      fixtureWindow.noticesFixtureAttempts = (fixtureWindow.noticesFixtureAttempts ?? 0) + 1
      const failed = failFirst && fixtureWindow.noticesFixtureAttempts === 1
      return new Response(JSON.stringify(failed ? { error: 'Fixture unavailable' } : notices), {
        status: failed ? 503 : 200,
        headers: { 'content-type': 'application/json' },
      })
    }
  }, { notices: NOTICES, failFirst })
}

async function openNotices(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('region', { name: 'Settings', exact: true })
    .getByRole('button', { name: 'About', exact: true }).click()
  const about = page.getByRole('main', { name: 'About', exact: true })
  // The long curated credits list belongs only inside the acknowledgements viewer.
  await expect(about.locator('[data-about-credits]')).toHaveCount(0)
  await about.locator('[data-about-notices-row]').getByRole('button').click()
  const viewer = page.locator('[data-about-notices]')
  await expect(viewer).toBeVisible()
  await expect(viewer.getByRole('tab', { name: 'Highlights', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await expect(viewer.locator('[data-about-credits]')).toBeVisible()
  return viewer
}

async function expectContained(page: Page, viewer: Locator) {
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth <= window.innerWidth
  ))).toBe(true)
  await expect.poll(() => viewer.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return element.scrollWidth <= element.clientWidth + 1 &&
      bounds.left >= -1 && bounds.top >= -1 &&
      bounds.right <= window.innerWidth + 1 && bounds.bottom <= window.innerHeight + 1
  })).toBe(true)
}

test('acknowledgements keep search pinned and show complete licenses beside the package list', async ({ noticesPage: page }, testInfo) => {
  test.setTimeout(90_000)
  await serveNotices(page)
  const viewer = await openNotices(page)
  const highlights = viewer.getByRole('tab', { name: 'Highlights', exact: true })
  const allLicenses = viewer.getByRole('tab', { name: 'All licenses', exact: true })
  await expect(viewer.locator('[data-about-credits]').getByText('Electron', { exact: true })).toBeVisible()
  await allLicenses.click()
  await expect(allLicenses).toHaveAttribute('aria-selected', 'true')
  await expect(viewer.locator('[data-about-credits]')).toBeHidden()

  const toolbar = viewer.locator('[data-notices-toolbar]')
  const search = toolbar.getByRole('textbox', { name: 'Search packages or licenses', exact: true })
  const licenseFilter = toolbar.getByRole('combobox', { name: 'Filter by license', exact: true })
  const list = viewer.locator('[data-notices-list]')
  await expect(list.locator('[data-notice]')).toHaveCount(NOTICES.packages.length)
  await expect.poll(() => page.evaluate(() => (window as NoticesFixtureWindow).noticesFixtureAttempts)).toBe(1)
  const firstResult = list.locator(`[data-notice="${NOTICES.packages[0].name}"]`)
  const secondResult = list.locator(`[data-notice="${NOTICES.packages[1].name}"]`)
  await search.press('ArrowDown')
  await expect(firstResult).toBeFocused()
  await firstResult.press('ArrowDown')
  await expect(secondResult).toBeFocused()
  await secondResult.press('Enter')
  await expect(viewer.locator(`[data-notice-detail="${NOTICES.packages[1].name}"]`)).toBeVisible()
  // Selecting a package keeps the wide list available to search's keyboard shortcut.
  await search.press('ArrowDown')
  await expect(firstResult).toBeFocused()
  await expect(viewer.locator(`[data-notice-detail="${NOTICES.packages[1].name}"]`)).toBeVisible()

  for (const label of ['All licenses', 'MIT', 'Apache-2.0']) {
    await expect(licenseFilter.getByRole('option', { name: label, exact: true })).toHaveCount(1)
  }
  await licenseFilter.selectOption({ label: 'MIT' })
  await expect(list.locator('[data-notice]')).toHaveCount(84)
  await expect(list.locator('[data-notice]')).toContainText(Array(84).fill('MIT'))
  await licenseFilter.selectOption({ label: 'Apache-2.0' })
  await expect(list.locator('[data-notice]')).toHaveCount(12)
  await expect(list.locator('[data-notice]')).toContainText(Array(12).fill('Apache-2.0'))
  await search.fill('package-037')
  await expect(list.locator('[data-notice]')).toHaveCount(0)
  await licenseFilter.selectOption({ label: 'All licenses' })
  await expect(list.locator('[data-notice]')).toHaveCount(1)
  await search.fill('  APACHE-2.0  ')
  await expect(list.locator('[data-notice]')).toHaveCount(12)
  await expect(list.locator('[data-notice]')).toContainText(Array(12).fill('Apache-2.0'))
  await search.fill('package-037')
  await expect(list.locator('[data-notice]')).toHaveCount(1)
  await expect(list.locator('[data-notice]')).toHaveAttribute('data-notice', NOTICES.packages[37].name)
  await search.fill('no-such-fixture-package')
  await expect(list.locator('[data-notice]')).toHaveCount(0)
  await expect(viewer.getByText('No matching packages.', { exact: true })).toBeVisible()
  // The dialog must let a populated search consume Escape before dismissing the sheet.
  await search.press('Escape')
  await expect(viewer).toBeVisible()
  await expect(search).toHaveValue('')
  await expect(search).toBeFocused()
  await expect(list.locator('[data-notice]')).toHaveCount(NOTICES.packages.length)

  const toolbarBefore = await toolbar.boundingBox()
  expect(toolbarBefore).not.toBeNull()
  await list.evaluate((element) => { element.scrollTop = 900 })
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(500)
  await expect(search).toBeInViewport()
  const toolbarAfter = await toolbar.boundingBox()
  expect(toolbarAfter).not.toBeNull()
  expect(Math.abs(toolbarAfter!.y - toolbarBefore!.y)).toBeLessThanOrEqual(1)

  const firstPackage = NOTICES.packages[0].name
  await list.locator(`[data-notice="${firstPackage}"]`).click()
  const detail = viewer.locator(`[data-notice-detail="${firstPackage}"]`)
  await expect(detail).toBeVisible()
  await expect(list).toBeVisible()
  const listBounds = await list.boundingBox()
  const detailBounds = await detail.boundingBox()
  expect(listBounds).not.toBeNull()
  expect(detailBounds).not.toBeNull()
  expect(listBounds!.x + listBounds!.width).toBeLessThanOrEqual(detailBounds!.x + 1)
  // Exact textContent also catches truncation, omitted final lines, and changed whitespace.
  await expect.poll(() => detail.locator('[data-notice-text]').textContent()).toBe(LONG_LICENSE)

  await list.evaluate((element) => { element.scrollTop = 900 })
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(500)
  const scrollBeforeTabSwitch = await list.evaluate((element) => element.scrollTop)
  await highlights.click()
  await expect(viewer.locator('[data-about-credits]')).toBeVisible()
  await allLicenses.click()
  await expect(detail).toBeVisible()
  await expect.poll(async () => Math.abs(
    await list.evaluate((element) => element.scrollTop) - scrollBeforeTabSwitch,
  )).toBeLessThanOrEqual(1)
  await page.setViewportSize({ width: 1100, height: 680 })
  for (const theme of ['light', 'dark'] as const) {
    for (const locale of ['en-US', 'zh-CN'] as const) {
      await page.evaluate(({ theme, locale }) => window.pipilot!.settings.update({
        locale,
        appearance: { theme, reducedMotion: true },
      }), { theme, locale })
      await expect(page.locator('html')).toHaveAttribute('lang', locale)
      await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark')))
        .toBe(theme === 'dark')
      await expect(viewer.getByRole('tab', { name: locale === 'zh-CN' ? '主要致谢' : 'Highlights', exact: true })).toBeVisible()
      await expect(viewer.getByRole('tab', { name: locale === 'zh-CN' ? '全部许可证' : 'All licenses', exact: true }))
        .toHaveAttribute('aria-selected', 'true')
      await expect(toolbar.getByRole('textbox', {
        name: locale === 'zh-CN' ? '搜索软件包或许可证' : 'Search packages or licenses', exact: true,
      })).toBeInViewport()
      await expectContained(page, viewer)
      await expect.poll(() => detail.locator('[data-notice-text]').evaluate((element) => (
        element.scrollWidth <= element.clientWidth + 1
      ))).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`about-notices-${theme}-${locale}-1100.png`) })
    }
  }
})

test('compact acknowledgements restore the query and package-list position after reading a license', async ({ noticesPage: page }, testInfo) => {
  test.setTimeout(60_000)
  await serveNotices(page)
  await page.setViewportSize({ width: 640, height: 760 })
  const viewer = await openNotices(page)
  await viewer.getByRole('tab', { name: 'All licenses', exact: true }).click()
  const search = viewer.getByRole('textbox', { name: 'Search packages or licenses', exact: true })
  const list = viewer.locator('[data-notices-list]')
  await search.fill('package-0')
  await expect(list.locator('[data-notice]')).toHaveCount(NOTICES.packages.length)
  const selectedName = NOTICES.packages[55].name
  const selected = list.locator(`[data-notice="${selectedName}"]`)
  await selected.scrollIntoViewIfNeeded()
  await selected.focus()
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  const savedScrollTop = await list.evaluate((element) => element.scrollTop)
  await selected.press('Enter')
  const detail = viewer.locator(`[data-notice-detail="${selectedName}"]`)
  await expect(detail).toBeVisible()
  await expect(list).toBeHidden()
  await expect.poll(() => detail.locator('[data-notice-text]').textContent()).toBe(LONG_LICENSE)
  await expectContained(page, viewer)
  await page.screenshot({ path: testInfo.outputPath('about-notices-compact-detail.png') })

  const back = viewer.getByRole('button', { name: 'Back', exact: true })
  await back.focus()
  await back.press('Enter')
  await expect(list).toBeVisible()
  await expect(detail).toBeHidden()
  await expect(search).toHaveValue('package-0')
  await expect.poll(async () => Math.abs(
    await list.evaluate((element) => element.scrollTop) - savedScrollTop,
  )).toBeLessThanOrEqual(1)
  await expect(selected).toBeInViewport()
  await expect(selected).toBeFocused()
  await expectContained(page, viewer)
  await page.screenshot({ path: testInfo.outputPath('about-notices-compact-list-restored.png') })
})

test('acknowledgements keep highlights available and retry a failed license load', async ({ noticesPage: page }) => {
  test.setTimeout(60_000)
  await serveNotices(page, true)
  const viewer = await openNotices(page)
  await viewer.getByRole('tab', { name: 'All licenses', exact: true }).click()
  await expect(viewer.getByRole('alert')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as NoticesFixtureWindow).noticesFixtureAttempts)).toBe(1)
  await viewer.getByRole('tab', { name: 'Highlights', exact: true }).click()
  await expect(viewer.locator('[data-about-credits]')).toBeVisible()
  await viewer.getByRole('tab', { name: 'All licenses', exact: true }).click()
  await expect(viewer.getByRole('alert')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as NoticesFixtureWindow).noticesFixtureAttempts)).toBe(1)
  await viewer.getByRole('button', { name: /^(Retry|Try again)$/ }).click()
  await expect(viewer.locator('[data-notices-list] [data-notice]')).toHaveCount(NOTICES.packages.length)
  await expect(viewer.getByRole('alert')).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => (window as NoticesFixtureWindow).noticesFixtureAttempts)).toBe(2)
  const firstPackage = NOTICES.packages[0].name
  await viewer.locator(`[data-notice="${firstPackage}"]`).click()
  await expect.poll(() => viewer.locator(`[data-notice-detail="${firstPackage}"] [data-notice-text]`).textContent())
    .toBe(LONG_LICENSE)
})

test('acknowledgements read the generated build manifest and restore focus when dismissed', async ({ noticesPage: page }, testInfo) => {
  test.setTimeout(60_000)
  // No fetch replacement: exercise the generated manifest through Electron's real protocol.
  await page.setViewportSize({ width: 1100, height: 680 })
  const viewer = await openNotices(page)
  await page.evaluate(() => window.pipilot!.settings.update({ locale: 'zh-CN' }))
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  await expect(viewer.getByRole('tab', { name: '主要致谢', exact: true }))
    .toHaveAttribute('aria-selected', 'true')
  await expect(viewer.locator('[data-about-credits]').getByText('React', { exact: true })).toBeVisible()
  await expectContained(page, viewer)
  await page.screenshot({ path: testInfo.outputPath('about-notices-real-highlights-zh-CN.png') })

  await viewer.getByRole('tab', { name: '全部许可证', exact: true }).click()
  const search = viewer.getByRole('textbox', { name: '搜索软件包或许可证', exact: true })
  await search.fill('react')
  await viewer.locator('[data-notice="react"]').click()
  const reactDetail = viewer.locator('[data-notice-detail="react"]')
  await expect(reactDetail).toBeVisible()
  await expect(reactDetail.getByText('MIT', { exact: true })).toBeVisible()
  await expect(reactDetail.locator('[data-notice-text]')).toContainText('MIT License')
  await expect(reactDetail.locator('[data-notice-text]')).toContainText('Permission is hereby granted')
  await expect(reactDetail.locator('[data-notice-text]')).toContainText('THE SOFTWARE IS PROVIDED "AS IS"')
  await expect(viewer.getByRole('alert')).toHaveCount(0)
  await expectContained(page, viewer)
  await page.screenshot({ path: testInfo.outputPath('about-notices-real-react-zh-CN.png') })

  const aboutEntry = page.locator('[data-about-notices-row]').getByRole('button')
  await viewer.getByRole('button', { name: '完成', exact: true }).click()
  await expect(viewer).toBeHidden()
  await expect(aboutEntry).toBeFocused()

  await aboutEntry.press('Enter')
  await expect(viewer).toBeVisible()
  await viewer.getByRole('tab', { name: '全部许可证', exact: true }).click()
  await search.fill('')
  await search.press('Escape')
  await expect(viewer).toBeHidden()
  await expect(aboutEntry).toBeFocused()
})
