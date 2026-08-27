import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  normalizeWindowBounds,
  WindowStateRepository,
  type PersistedWindowState,
} from '../../src/main/windows/window-state'

const primary = { x: 0, y: 0, width: 1920, height: 1080 }
const secondary = { x: -1280, y: 0, width: 1280, height: 720 }

describe('window bounds normalization', () => {
  it('keeps valid bounds on the display with the largest intersection', () => {
    const saved = { x: -1240, y: 10, width: 1200, height: 700 }
    expect(normalizeWindowBounds(saved, [primary, secondary])).toEqual(saved)
  })

  it('clamps partially visible and oversized bounds into a work area', () => {
    expect(
      normalizeWindowBounds({ x: 1800, y: 1000, width: 2400, height: 1600 }, [primary]),
    ).toEqual(primary)
  })

  it('centers a window on the primary display after a display is disconnected', () => {
    expect(
      normalizeWindowBounds({ x: 4000, y: 200, width: 1200, height: 700 }, [primary, secondary]),
    ).toEqual({ x: 240, y: 90, width: 1440, height: 900 })
  })
})

describe('window state repository', () => {
  it('round-trips a schema-validated atomic state file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pipilot-window-state-'))
    const filePath = join(directory, 'window-state.json')
    const repository = new WindowStateRepository(filePath)
    const state: PersistedWindowState = {
      version: 1,
      bounds: { x: 40, y: 50, width: 1440, height: 900 },
      maximized: false,
    }

    try {
      repository.saveSync(state)
      await expect(repository.load()).resolves.toEqual(state)
      expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(state)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('falls back when persisted data is corrupt or outside the schema', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pipilot-window-state-'))
    const filePath = join(directory, 'window-state.json')
    const repository = new WindowStateRepository(filePath)

    try {
      await writeFile(filePath, '{invalid json', 'utf8')
      await expect(repository.load()).resolves.toBeNull()
      await writeFile(
        filePath,
        JSON.stringify({ version: 1, bounds: { x: 0, y: 0, width: -1, height: 900 } }),
        'utf8',
      )
      await expect(repository.load()).resolves.toBeNull()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
