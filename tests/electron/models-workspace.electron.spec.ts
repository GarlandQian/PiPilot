import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join, resolve } from 'node:path'
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { closeFixtureApplication } from './close-fixture-application'
import { startPiSdkFixture } from './pi-sdk-fixture'

async function launch(testInfo: Parameters<Parameters<typeof test>[2]>[1], prepare?: (models: Record<string, any>) => void) {
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  await mkdir(userData, { recursive: true })
  await writeFile(join(userData, 'settings.json'), JSON.stringify({
    version: SETTINGS_SCHEMA_VERSION,
    // models.dev stays off: what fills in a model must come from Pi's own catalog here.
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US', models: { onlineMetadata: false }, appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'light', reducedMotion: true } },
  }))
  const fixture = await startPiSdkFixture({ agentDir, includeReasoningModel: true })
  const modelPath = join(agentDir, 'models.json')
  const initial = JSON.parse(await readFile(modelPath, 'utf8'))
  prepare?.(initial)
  await writeFile(modelPath, JSON.stringify(initial, null, 2))
  const app = await electron.launch({
    args: [resolve(process.cwd())],
    env: { ...process.env, ...fixture.env, PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' },
  })
  return { app, fixture, agentDir, modelPath, initial }
}

const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8'))

function footer(page: Page) {
  return page.getByRole('main', { name: 'Models', exact: true }).locator('[data-models-editor-footer]')
}

test('manages providers through the list, the preset picker and full-page editors', async ({}, testInfo) => {
  test.setTimeout(90_000)
  const { app, fixture, agentDir, modelPath, initial } = await launch(testInfo, (models) => {
    models.providers.secondary = { ...models.providers.fixture, name: 'Secondary Gateway', models: [{ id: 'secondary-model', name: 'Secondary Model' }] }
  })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 900 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat')
    // The conversation's model picker leads to Settings › Models.
    await page.locator('[data-model-thinking-trigger]').click()
    await page.getByRole('button', { name: 'Manage models…', exact: true }).click()
    const main = page.getByRole('main', { name: 'Models', exact: true })
    const list = main.locator('[data-models-provider-list]')
    await expect(list.locator('[data-models-provider-card]')).toHaveCount(2)
    await expect(list.locator('[data-models-provider-card="fixture"]')).toContainText('Default model')
    await expect(main).not.toContainText('fixture-key')

    // A provider's test tries its default model.
    const fixtureCard = list.locator('[data-models-provider-card="fixture"]')
    await fixtureCard.getByRole('button', { name: 'Test fixture', exact: true }).click()
    await expect(fixtureCard.getByRole('status')).toContainText('Connected', { timeout: 20_000 })

    // Editing is a page of its own, with the toolbar's back button.
    await fixtureCard.getByRole('button', { name: 'Edit fixture', exact: true }).click()
    const editor = main.locator('[data-models-custom-editor="fixture"]')
    await expect(main.locator('header h1')).toHaveText('fixture')
    const chat = editor.locator('[data-model-row="fake-chat"]')
    await chat.locator('button[aria-expanded]').click()
    const context = chat.getByRole('textbox', { name: 'Context window', exact: true })
    await context.fill('not a number')
    await expect(context).toHaveAttribute('aria-invalid', 'true')
    await context.fill('1000000')
    await chat.getByRole('textbox', { name: 'Display name', exact: true }).fill('Updated Chat')
    // Tests use what the page shows, saved or not.
    await chat.getByRole('button', { name: 'Test Updated Chat', exact: true }).click()
    await expect(chat.getByRole('status')).toContainText('Connected', { timeout: 20_000 })
    // The JSON view follows the form, with the key masked.
    await editor.getByRole('button', { name: /^Config JSON/u }).click()
    const json = editor.getByRole('textbox', { name: 'Config JSON', exact: true })
    await expect(json).toHaveValue(/"name": "Updated Chat"/u)
    await expect(json).not.toHaveValue(/fixture-key/u)
    await json.fill((await json.inputValue()).replace('"Updated Chat"', '"Edited in JSON"'))
    await expect(chat.getByRole('textbox', { name: 'Display name', exact: true })).toHaveValue('Edited in JSON')
    await footer(page).getByRole('button', { name: 'Save', exact: true }).click()
    await expect(list).toBeVisible()
    const saved = await readJson(modelPath)
    expect(saved.providers.fixture.models[0]).toMatchObject({ id: 'fake-chat', name: 'Edited in JSON', contextWindow: 1000000 })
    expect(saved.providers.fixture.apiKey).toBe('fixture-key')
    expect(saved.providers.fixture.compat).toEqual(initial.providers.fixture.compat)

    // Leaving with unsaved changes asks first.
    await list.locator('[data-models-provider-card="secondary"]').getByRole('button', { name: 'Edit Secondary Gateway', exact: true }).click()
    await main.getByRole('textbox', { name: 'Name', exact: true }).fill('Renamed but not saved')
    await page.locator('[data-settings-subpage-back]').click()
    const discard = page.getByRole('alertdialog', { name: 'Discard your changes?', exact: true })
    await discard.getByRole('button', { name: 'Keep Editing', exact: true }).click()
    await expect(main.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Renamed but not saved')
    // Another Settings pane and back: the page and its edits are still there.
    await page.locator('[data-context-panel-nav-id="general"]').click()
    await page.locator('[data-context-panel-nav-id="models"]').click()
    await expect(main.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Renamed but not saved')
    await page.locator('[data-settings-subpage-back]').click()
    await discard.getByRole('button', { name: 'Discard', exact: true }).click()
    await expect(list).toBeVisible()
    expect((await readJson(modelPath)).providers.secondary.name).toBe('Secondary Gateway')

    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((theme) => window.pipilot!.settings.update({ appearance: { theme } }), theme)
      await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark'))).toBe(theme === 'dark')
      for (const width of [1440, 1100]) {
        await page.setViewportSize({ width, height: width === 1100 ? 680 : 900 })
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await expect.poll(() => list.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
        await page.screenshot({ path: testInfo.outputPath(`models-list-${theme}-${width}.png`), animations: 'disabled' })
      }
    }
    await page.evaluate(() => window.pipilot!.settings.update({ appearance: { theme: 'light' } }))
    await page.setViewportSize({ width: 1440, height: 900 })

    // A custom address: its own model list, a model added by hand, and Pi's catalog.
    const gateway = createServer((request, response) => {
      if (request.url === '/v1/models' && request.headers.authorization === 'Bearer list-key') {
        response.writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ object: 'list', data: [{ id: 'gateway-small' }, { id: 'gateway-large' }] }))
        return
      }
      response.writeHead(401, { 'content-type': 'application/json' }).end('{"error":"unauthorized"}')
    })
    await new Promise<void>((done) => gateway.listen(0, '127.0.0.1', done))
    try {
      const endpoint = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}/v1`
      await main.getByRole('button', { name: 'Add Provider…', exact: true }).click()
      const picker = main.locator('[data-models-preset-picker]')
      const search = picker.getByRole('searchbox', { name: 'Search by name or address', exact: true })
      await expect(search).toBeFocused()
      await search.fill('硅基')
      await expect(picker.locator('[data-models-preset]')).toHaveCount(1)
      await search.fill('')
      await picker.getByRole('radio', { name: 'Custom', exact: true }).click()
      await picker.locator('[data-models-preset="custom"]').click()
      const added = main.locator('[data-models-custom-editor="new"]')
      await added.getByRole('textbox', { name: 'Address', exact: true }).fill(endpoint)
      await added.locator('#models-editor-key').fill('list-key')
      await added.getByRole('button', { name: 'Fetch List', exact: true }).click()
      const remote = page.getByRole('dialog', { name: 'Models at This Address', exact: true })
      await remote.getByText('Select all (2)', { exact: true }).click()
      await remote.getByRole('button', { name: 'Add 2 Models', exact: true }).click()
      await expect(remote).toBeHidden()
      await expect(added.locator('[data-model-row]')).toHaveCount(2)
      await expect(added.locator('[data-model-row="gateway-small"]')).toContainText('Capabilities unknown')
      await added.getByRole('button', { name: 'Add Manually', exact: true }).click()
      const modelId = added.getByRole('textbox', { name: 'Model ID', exact: true })
      await expect(modelId).toBeFocused()
      await modelId.fill('gpt-4o')
      await modelId.press('Enter')
      await expect(added.getByRole('textbox', { name: 'Display name', exact: true })).toHaveValue('GPT-4o')
      await footer(page).getByRole('button', { name: 'Save', exact: true }).click()
      await expect(list.locator('[data-models-provider-card="custom"]')).toBeVisible()
      expect((await readJson(modelPath)).providers.custom).toEqual({
        baseUrl: endpoint, api: 'openai-completions', apiKey: 'list-key',
        models: [{ id: 'gateway-small' }, { id: 'gateway-large' }, { id: 'gpt-4o', name: 'GPT-4o', input: ['text', 'image'], contextWindow: 128000, maxTokens: 16384 }],
      })
    } finally {
      await new Promise((done) => gateway.close(done))
    }

    // One of Pi's own providers needs only a key, kept in auth.json.
    await main.getByRole('button', { name: 'Add Provider…', exact: true }).click()
    await main.locator('[data-models-preset="deepseek"]').click()
    const builtin = main.locator('[data-models-builtin-editor="deepseek"]')
    await expect(builtin.locator('[data-model-row]').first()).toBeVisible({ timeout: 20_000 })
    await builtin.locator('#models-builtin-key').fill('sk-deepseek-test')
    await footer(page).getByRole('button', { name: 'Save', exact: true }).click()
    const deepseek = list.locator('[data-models-provider-card="deepseek"]')
    await expect(deepseek).toContainText('Key saved', { timeout: 20_000 })
    expect((await readJson(join(agentDir, 'auth.json'))).deepseek).toMatchObject({ type: 'api_key', key: 'sk-deepseek-test' })
    await expect(main).not.toContainText('sk-deepseek-test')
    await deepseek.getByRole('button', { name: 'Actions for DeepSeek', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Remove Key', exact: true }).click()
    await page.getByRole('alertdialog', { name: 'Remove the key for DeepSeek?', exact: true }).getByRole('button', { name: 'Remove Key', exact: true }).click()
    await expect(deepseek).toHaveCount(0, { timeout: 20_000 })
    expect((await readJson(join(agentDir, 'auth.json'))).deepseek).toBeUndefined()
    expect(errors).toEqual([])
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})

test('renaming the provider that holds the default model moves the default with it', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const { app, fixture } = await launch(testInfo)
  try {
    const page = await app.firstWindow()
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('[data-context-panel-nav-id="models"]').click()
    const main = page.getByRole('main', { name: 'Models', exact: true })
    await main.locator('[data-models-provider-card="fixture"]').getByRole('button', { name: 'Edit fixture', exact: true }).click()
    const editor = main.locator('[data-models-custom-editor="fixture"]')
    await expect(editor.locator('[data-model-row="fake-chat"]')).toContainText('Default')
    await editor.getByRole('button', { name: /^Advanced/u }).click()
    await expect(editor).toContainText('This provider holds the default model, which follows a new ID.')
    await editor.getByRole('textbox', { name: 'Provider ID', exact: true }).fill('fixture-renamed')
    await footer(page).getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.pipilot!.modelsConfig.getDefaults({ kind: 'global' })), { timeout: 20_000 })
      .toMatchObject({ defaultProvider: 'fixture-renamed', defaultModel: 'fake-chat' })
    await expect(main.locator('[data-models-provider-card="fixture-renamed"]')).toContainText('Default model')
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})

test('custom API selection explains credentials and preserves advanced protocols without treating them as generic endpoints', async ({}, testInfo) => {
  test.setTimeout(60_000)
  const { app, fixture, modelPath, initial } = await launch(testInfo)
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.locator('[data-context-panel-nav-id="models"]').click()
    const main = page.getByRole('main', { name: 'Models', exact: true })
    await main.locator('[data-models-provider-card="fixture"]').getByRole('button', { name: 'Edit fixture', exact: true }).click()
    const editor = main.locator('[data-models-custom-editor="fixture"]')
    const protocol = editor.locator('#models-editor-api')
    const address = editor.locator('#models-editor-url')
    const key = editor.locator('#models-editor-key')
    const fetchList = editor.getByRole('button', { name: 'Fetch List', exact: true })
    const changeProtocol = async (api: string) => {
      await protocol.click()
      await page.getByRole('option', { name: new RegExp(` ${api}$`, 'u') }).click()
    }

    await protocol.click()
    await expect(page.getByRole('option', { name: /openai-codex-responses/u })).toHaveCount(0)
    await page.getByRole('option', { name: / openai-responses$/u }).click()
    await expect(protocol).toHaveAccessibleDescription(/does not sign in to ChatGPT/u)
    await expect(fetchList).toBeEnabled()
    await expect(key).toHaveAccessibleName('API Key')
    await expect(address).toHaveValue(initial.providers.fixture.baseUrl)
    await expect(key).toHaveValue('fixture-key')

    await changeProtocol('azure-openai-responses')
    await expect(key).toHaveAccessibleName('Azure OpenAI API key')
    await expect(address).toHaveAttribute('placeholder', 'https://your-resource.openai.azure.com/openai/v1')
    await expect(fetchList).toBeDisabled()
    await expect(fetchList).toHaveAccessibleDescription(/manually/u)
    await changeProtocol('google-vertex')
    await expect(protocol).toHaveAccessibleDescription(/built-in google-vertex/u)
    await expect(fetchList).toBeDisabled()

    // Advanced configurations must remain editable, without exposing secrets
    // or silently mapping them to the first generic protocol.
    await editor.getByRole('button', { name: /^Config JSON/u }).click()
    const json = editor.getByRole('textbox', { name: 'Config JSON', exact: true })
    const definition = JSON.parse(await json.inputValue())
    await json.fill(JSON.stringify({ ...definition, api: 'openai-codex-responses', extensionField: { preserved: true } }, null, 2))
    await expect(protocol).toContainText('OpenAI Codex (legacy OAuth)')
    await expect(key).toHaveAccessibleName('OAuth access token (JWT)')
    await expect(protocol).toHaveAccessibleDescription(/Ordinary API keys fail before connecting/u)
    await expect(fetchList).toBeDisabled()
    await expect(key).toHaveValue('fixture-key')
    await expect(json).not.toHaveValue(/fixture-key/u)

    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((theme) => window.pipilot!.settings.update({ appearance: { theme } }), theme)
      await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark'))).toBe(theme === 'dark')
      await page.setViewportSize({ width: 1100, height: 680 })
      await protocol.scrollIntoViewIfNeeded()
      await expect.poll(() => editor.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`models-protocol-${theme}.png`), animations: 'disabled' })
    }

    await json.fill(JSON.stringify({ ...definition, api: 'fixture-extension-api', extensionField: { preserved: true } }, null, 2))
    await expect(protocol).toContainText('fixture-extension-api')
    await expect(fetchList).toBeDisabled()
    await expect(json).toHaveValue(/"preserved": true/u)
    await expect(key).toHaveValue('fixture-key')
    await footer(page).getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.getByRole('alertdialog', { name: 'Discard your changes?', exact: true }).getByRole('button', { name: 'Discard', exact: true }).click()
    expect(await readJson(modelPath)).toEqual(initial)
    expect(errors).toEqual([])
    expect(fixture.prompts).toEqual([])
  } finally {
    await closeFixtureApplication(app)
    await fixture.close()
  }
})
