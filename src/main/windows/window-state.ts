import { randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { BrowserWindow, Rectangle } from 'electron'
import { z } from 'zod'

export const DEFAULT_WINDOW_SIZE = { width: 1440, height: 900 } as const
export const MIN_WINDOW_SIZE = { width: 1100, height: 680 } as const

const rectangleSchema = z
  .object({
    x: z.number().int().min(-100_000).max(100_000),
    y: z.number().int().min(-100_000).max(100_000),
    width: z.number().int().positive().max(20_000),
    height: z.number().int().positive().max(20_000),
  })
  .strict()

export const persistedWindowStateSchema = z
  .object({
    version: z.literal(1),
    bounds: rectangleSchema,
    maximized: z.boolean(),
  })
  .strict()

export type PersistedWindowState = z.infer<typeof persistedWindowStateSchema>

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function intersectionArea(a: Rectangle, b: Rectangle) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return width * height
}

function centeredBounds(workArea: Rectangle): Rectangle {
  const width = Math.min(DEFAULT_WINDOW_SIZE.width, workArea.width)
  const height = Math.min(DEFAULT_WINDOW_SIZE.height, workArea.height)
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  }
}

/**
 * `workAreas[0]` is the primary display. A disconnected saved display falls
 * back there; partially visible bounds are clamped to the display with the
 * largest intersection.
 */
export function normalizeWindowBounds(
  savedBounds: Rectangle | null,
  workAreas: readonly Rectangle[],
): Rectangle {
  if (workAreas.length === 0) {
    return savedBounds ?? { x: 0, y: 0, ...DEFAULT_WINDOW_SIZE }
  }

  if (!savedBounds) return centeredBounds(workAreas[0])

  let target = workAreas[0]
  let bestArea = 0
  for (const workArea of workAreas) {
    const area = intersectionArea(savedBounds, workArea)
    if (area > bestArea) {
      bestArea = area
      target = workArea
    }
  }

  if (bestArea === 0) return centeredBounds(workAreas[0])

  const minimumWidth = Math.min(MIN_WINDOW_SIZE.width, target.width)
  const minimumHeight = Math.min(MIN_WINDOW_SIZE.height, target.height)
  const width = clamp(savedBounds.width, minimumWidth, target.width)
  const height = clamp(savedBounds.height, minimumHeight, target.height)

  return {
    x: clamp(savedBounds.x, target.x, target.x + target.width - width),
    y: clamp(savedBounds.y, target.y, target.y + target.height - height),
    width,
    height,
  }
}

export class WindowStateRepository {
  constructor(private readonly filePath: string) {}

  async load(): Promise<PersistedWindowState | null> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      const result = persistedWindowStateSchema.safeParse(parsed)
      return result.success ? result.data : null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[PiPilot] Window state could not be loaded; using defaults.')
      }
      return null
    }
  }

  saveSync(state: PersistedWindowState): void {
    const validated = persistedWindowStateSchema.parse(state)
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`

    mkdirSync(dirname(this.filePath), { recursive: true })
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
      renameSync(temporaryPath, this.filePath)
    } catch (error) {
      try {
        unlinkSync(temporaryPath)
      } catch {
        // The temporary file may not have been created.
      }
      throw error
    }
  }
}

export interface WindowStateController {
  flush(): Promise<void>
}

export function trackWindowState(
  window: BrowserWindow,
  repository: WindowStateRepository,
): WindowStateController {
  let timer: ReturnType<typeof setTimeout> | undefined

  const snapshot = (): PersistedWindowState => ({
    version: 1,
    bounds: window.isMaximized() ? window.getNormalBounds() : window.getBounds(),
    maximized: window.isMaximized(),
  })

  const persist = () => {
    if (window.isDestroyed()) return
    try {
      repository.saveSync(snapshot())
    } catch {
      console.warn('[PiPilot] Window state could not be saved.')
    }
  }

  const scheduleWrite = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      persist()
    }, 250)
  }

  window.on('move', scheduleWrite)
  window.on('resize', scheduleWrite)
  window.on('maximize', scheduleWrite)
  window.on('unmaximize', scheduleWrite)
  window.on('close', () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    persist()
  })

  return {
    async flush() {
      if (timer) clearTimeout(timer)
      timer = undefined
      persist()
    },
  }
}
