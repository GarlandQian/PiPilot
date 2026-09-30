import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { JSONContent } from '@tiptap/core'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../../src/shared/settings'
import { closeFixtureApplication } from './close-fixture-application'
import { installFixtureTrash } from './fixture-trash'
import { startPiSdkFixture } from './pi-sdk-fixture'
import { PNG_FIXTURE_BASE64 } from '../helpers/image-fixture'

const pixelPng = Buffer.from(PNG_FIXTURE_BASE64, 'base64')

function composer(page: Page) { return page.getByRole('textbox', { name: 'Message input', exact: true }) }
function session(page: Page, name: string) {
  return page.getByRole('region', { name: 'Projects', exact: true }).getByRole('button', { name, exact: true })
}

/** Inspect Chromium's actual structured-clone storage, including the image bytes. */
async function storedDrafts(page: Page) {
  return page.evaluate(async () => {
    type Record = { key: string; document: JSONContent; attachments: { id: string; key: string; name: string; lastModified: number; blob: Blob }[] }
    const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
      const request = indexedDB.open('pipilot-composer-drafts', 1)
      request.onsuccess = () => resolveDatabase(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      const records = await new Promise<Record[]>((resolveRecords, reject) => {
        const transaction = database.transaction('conversations', 'readonly')
        const request = transaction.objectStore('conversations').getAll()
        transaction.oncomplete = () => resolveRecords(request.result as Record[])
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
      return await Promise.all(records.map(async (record) => ({
        key: record.key,
        document: record.document,
        attachments: await Promise.all(record.attachments.map(async (attachment) => ({
          id: attachment.id, key: attachment.key, name: attachment.name, lastModified: attachment.lastModified,
          isBlob: attachment.blob instanceof Blob, type: attachment.blob.type,
          bytes: Array.from(new Uint8Array(await attachment.blob.arrayBuffer())),
        }))),
      })))
    } finally { database.close() }
  })
}

async function seedSession(page: Page, name: string) {
  await composer(page).fill(`Seed ${name}`)
  await page.locator('[data-composer-submit]').click()
  await expect(page.getByRole('log', { name: 'Conversation', exact: true }))
    .toContainText(`Fixture response: Seed ${name}`)
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  expect(await page.evaluate((title) => window.pipilot!.localPi.runtime.command({ type: 'set_session_name', name: title }), name))
    .toMatchObject({ success: true })
  await expect(session(page, name)).toBeVisible()
  const status = await page.evaluate(() => window.pipilot!.localPi.runtime.status())
  expect(status.sessionState?.sessionId).toBeTruthy()
  return status.sessionState!.sessionId
}

async function writeDraft(page: Page, text: string, imageName: string) {
  await composer(page).fill(text)
  await composer(page).pressSequentially(' @notes')
  const menu = page.locator('[data-slot="command"][aria-label="Files and Skills"]')
  await menu.getByRole('option', { name: /notes\.md/ }).click()
  await expect(page.locator('[data-composer-mention-kind="file"]')).toHaveCount(1)
  await page.locator('input[type="file"]').setInputFiles({ name: imageName, mimeType: 'image/png', buffer: pixelPng })
  await expect(page.getByRole('button', { name: `Remove image ${imageName}`, exact: true })).toBeAttached()
  await expect(page.locator('[data-composer-root]')).toHaveAttribute('data-draft-storage', 'ready')
  return composer(page).innerText()
}

async function expectDraft(page: Page, text: string, imageName: string) {
  await expect(composer(page)).toHaveText(text)
  await expect(page.locator('[data-composer-mention-kind="file"]')).toHaveCount(1)
  await expect(page.locator('[data-composer-attachments] img')).toHaveCount(1)
  const image = page.getByRole('img', { name: imageName, exact: true })
  await expect(image).toHaveAttribute('src', /^blob:/)
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true)
}

test('persists complete per-session drafts across reload and restart, and durably clears only the intended session', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const userData = testInfo.outputPath('user-data')
  const agentDir = testInfo.outputPath('pi-agent')
  const projectPath = testInfo.outputPath('draft-project')
  await Promise.all([userData, projectPath].map((path) => mkdir(path, { recursive: true })))
  const cwd = await realpath(projectPath)
  await writeFile(join(projectPath, 'notes.md'), '# Isolated draft reference\n')
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ version: SETTINGS_SCHEMA_VERSION,
    settings: { ...DEFAULT_SETTINGS, locale: 'en-US', appearance: { ...DEFAULT_SETTINGS.appearance, reducedMotion: true } } }))
  const fixture = await startPiSdkFixture({ agentDir })
  const errors: string[] = []
  let app: ElectronApplication | undefined
  const launch = async () => {
    app = await electron.launch({ args: [resolve(process.cwd())], env: { ...process.env, ...fixture.env,
      PIPILOT_E2E_USER_DATA: userData, PIPILOT_E2E_DISABLE_AUTO_RESTART: '1' } })
    await installFixtureTrash(app, testInfo)
    const page = await app.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 1000 })
    await expect(page.locator('[data-model-thinking-trigger]')).toContainText('Fake Chat', { timeout: 20_000 })
    return page
  }
  try {
    let page = await launch()
    await app!.evaluate(({ dialog }, path) => { Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true, value: async () => ({ canceled: false, filePaths: [path] }),
    }) }, cwd)
    await page.getByRole('button', { name: 'Add project folder', exact: true }).click()
    const a = await seedSession(page, 'Draft A')
    const textA = await writeDraft(page, 'Unsent draft A', 'draft-a.png')
    await page.getByRole('button', { name: 'New session in draft-project', exact: true }).click()
    await expect(composer(page)).toHaveText('')
    await expect(page.locator('[data-composer-attachments]')).toHaveCount(0)
    const b = await seedSession(page, 'Draft B')
    const textB = await writeDraft(page, 'Unsent draft B', 'draft-b.png')
    const record = async (id: string) => (await storedDrafts(page)).find((draft) => draft.key.endsWith(`:${id}`))
    await expect.poll(async () => (await storedDrafts(page)).length).toBe(2)
    const savedA = (await record(a))!
    const savedB = (await record(b))!
    expect(savedA.document.content?.[0].content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'composerMention', attrs: expect.objectContaining({ kind: 'file', path: 'notes.md' }) }),
    ]))
    for (const [saved, name] of [[savedA, 'draft-a.png'], [savedB, 'draft-b.png']] as const) {
      expect(saved.attachments).toEqual([expect.objectContaining({ name, isBlob: true, type: 'image/png', bytes: Array.from(pixelPng) })])
    }

    await test.step('restores text, reference nodes and real Blob images without localStorage after reload', async () => {
      await session(page, 'Draft A').click()
      await expectDraft(page, textA, 'draft-a.png')
      await session(page, 'Draft B').click()
      await expectDraft(page, textB, 'draft-b.png')
      // Navigation preferences are expendable; the draft must live in IndexedDB.
      await page.evaluate(() => localStorage.clear())
      await page.reload()
      await session(page, 'Draft A').click()
      await expectDraft(page, textA, 'draft-a.png')
      await session(page, 'Draft B').click()
      await expectDraft(page, textB, 'draft-b.png')
      expect(await record(a)).toEqual(savedA)
      expect(await record(b)).toEqual(savedB)
    })

    await test.step('restores both independent drafts after a full Electron process restart', async () => {
      await closeFixtureApplication(app!)
      app = undefined
      page = await launch()
      await session(page, 'Draft A').click()
      await expectDraft(page, textA, 'draft-a.png')
      await session(page, 'Draft B').click()
      await expectDraft(page, textB, 'draft-b.png')
      expect(await record(a)).toEqual(savedA)
      expect(await record(b)).toEqual(savedB)
    })

    await test.step('persists manual clearing and clears an accepted submission without resurrecting either draft', async () => {
      await composer(page).fill('')
      await page.getByRole('button', { name: 'Remove image draft-b.png', exact: true }).click()
      await expect.poll(() => record(b)).toBeUndefined()
      expect(await record(a)).toEqual(savedA)
      await session(page, 'Draft A').click()
      await expectDraft(page, textA, 'draft-a.png')
      await page.locator('[data-composer-submit]').click()
      await expect(composer(page)).toHaveText('')
      await expect(page.locator('[data-composer-attachments]')).toHaveCount(0)
      await expect.poll(() => record(a)).toBeUndefined()
      await expect.poll(() => fixture.prompts.some((prompt) => prompt.includes('Unsent draft A [@notes.md](notes.md)'))).toBe(true)
      await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
      const messages = await page.evaluate(() => window.pipilot!.localPi.runtime.command({ type: 'get_messages' }))
      expect(messages).toMatchObject({ success: true, command: 'get_messages', data: { messages: expect.arrayContaining([
        expect.objectContaining({ role: 'user', content: expect.arrayContaining([
          expect.objectContaining({ type: 'text', text: expect.stringContaining('Unsent draft A [@notes.md](notes.md)') }),
          expect.objectContaining({ type: 'image', data: pixelPng.toString('base64'), mimeType: 'image/png' }),
        ]) }),
      ]) } })
      await page.reload()
      for (const name of ['Draft A', 'Draft B']) {
        await session(page, name).click()
        await expect(composer(page)).toHaveText('')
        await expect(page.locator('[data-composer-attachments]')).toHaveCount(0)
      }
      expect(await storedDrafts(page)).toEqual([])
    })

    await test.step('deleting background session A removes only its persisted draft and preserves B after reload', async () => {
      await session(page, 'Draft A').click()
      await writeDraft(page, 'Delete only A', 'delete-a.png')
      await session(page, 'Draft B').click()
      const retainedText = await writeDraft(page, 'Keep B untouched', 'retained-b.png')
      const retained = await record(b)
      await expect.poll(() => record(a)).toBeDefined()
      const row = page.getByRole('region', { name: 'Projects', exact: true }).getByRole('listitem')
        .filter({ has: page.getByRole('button', { name: 'Draft A', exact: true }) }).last()
      await row.getByRole('button', { name: 'More actions', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
      await page.getByRole('alertdialog', { name: 'Delete session?', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click()
      await expect(session(page, 'Draft A')).toHaveCount(0)
      await expect(session(page, 'Draft B')).toHaveAttribute('aria-current', 'page')
      await expectDraft(page, retainedText, 'retained-b.png')
      await expect.poll(() => record(a)).toBeUndefined()
      expect(await record(b)).toEqual(retained)
      await page.reload()
      await session(page, 'Draft B').click()
      await expectDraft(page, retainedText, 'retained-b.png')
      await expect(session(page, 'Draft A')).toHaveCount(0)
      expect(await storedDrafts(page)).toEqual([retained])
    })
    expect(errors).toEqual([])
  } finally {
    if (app) await closeFixtureApplication(app)
    await fixture.close()
  }
})
