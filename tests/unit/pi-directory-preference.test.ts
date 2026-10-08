import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { PiDirectoryPreference } from '../../src/main/pi-directory-preference'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
it('keeps the active directory until restart and preserves both directories when changing or resetting', () => {
  const root = mkdtempSync(join(tmpdir(), 'pipilot-directory-')); roots.push(root)
  const original = join(root, 'original'); const selected = join(root, '中文 With Spaces')
  mkdirSync(original); mkdirSync(selected)
  writeFileSync(join(original, 'auth.json'), 'original')
  writeFileSync(join(selected, 'auth.json'), 'selected')
  const file = join(root, 'app', 'pi-directory.json')
  const preference = new PiDirectoryPreference(file, original)
  expect(preference.snapshot().activeDirectory).toBe(original)
  expect(preference.select(selected)).toMatchObject({ activeDirectory: original, selectedDirectory: selected, restartRequired: true })
  const restarted = new PiDirectoryPreference(file, original)
  expect(restarted.snapshot()).toMatchObject({ activeDirectory: selected, restartRequired: false })
  expect(restarted.select(null)).toMatchObject({ activeDirectory: selected, selectedDirectory: null, restartRequired: true })
  expect(new PiDirectoryPreference(file, original).activeDirectory).toBe(original)
  expect(readFileSync(join(original, 'auth.json'), 'utf8')).toBe('original')
  expect(readFileSync(join(selected, 'auth.json'), 'utf8')).toBe('selected')
})
it('does not persist an invalid or nonexistent selected directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'pipilot-directory-')); roots.push(root)
  const preference = new PiDirectoryPreference(join(root, 'preference.json'), root)
  expect(() => preference.select('relative')).toThrow()
  expect(() => preference.select(join(root, 'missing'))).toThrow()
  expect(preference.snapshot().restartRequired).toBe(false)
})
