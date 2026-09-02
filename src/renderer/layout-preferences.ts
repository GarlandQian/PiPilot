import { z } from 'zod'
import { workspaceIdSchema } from '@/shared/schemas/workspace'

export const CONTEXT_PANEL_LAYOUT_KEY = 'pipilot.layout.context-panel.v1'
export const PROJECT_EXPANSION_LAYOUT_KEY = 'pipilot.layout.project-expansion.v1'
export const APP_ROUTE_LAYOUT_KEY = 'pipilot.layout.app-route.v1'
export const PANEL_LAYOUT_KEY = 'pipilot.layout.panels.v1'

export const CONTEXT_PANEL_MIN_WIDTH = 200
export const CONTEXT_PANEL_DEFAULT_WIDTH = 240
export const CONTEXT_PANEL_MAX_WIDTH = 320
export const INSPECTOR_MIN_WIDTH = 280
export const INSPECTOR_DEFAULT_WIDTH = 360
export const INSPECTOR_MAX_WIDTH = 480
export const COMPACT_FRAME_MAX_WIDTH = 1_279

export const SETTINGS_ROUTE_IDS = [
  'general',
  'appearance',
  'language',
  'models',
  'integrations',
  'terminal',
  'about',
] as const

export type SettingsRouteId = (typeof SETTINGS_ROUTE_IDS)[number]
export type ConversationContext = 'sessions'
export type AppRoute =
  | { workspace: 'conversation'; context: ConversationContext }
  | { workspace: 'settings'; section: SettingsRouteId }
export type FrameLayoutMode =
  | 'conversation-wide'
  | 'conversation-compact'
  | 'settings-wide'
  | 'settings-compact'

export interface PanelLayoutPreferences {
  contextPanelWidth: number
  inspectorWidth: number
  inspectorOpen: boolean
}

const LAYOUT_DOCUMENT_VERSION = 1
const MAX_LAYOUT_DOCUMENT_CHARS = 16_384
const MAX_PROJECT_EXPANSION_PREFERENCES = 100

const contextPanelLayoutSchema = z
  .object({
    version: z.literal(LAYOUT_DOCUMENT_VERSION),
    open: z.boolean(),
  })
  .strict()

const settingsRouteIdSchema = z.enum(SETTINGS_ROUTE_IDS)
const appRouteSchema = z.discriminatedUnion('workspace', [
  z.object({
    workspace: z.literal('conversation'),
    context: z.literal('sessions'),
  }).strict(),
  z.object({
    workspace: z.literal('settings'),
    section: settingsRouteIdSchema,
  }).strict(),
])

const appRouteLayoutSchema = z.object({
  version: z.literal(LAYOUT_DOCUMENT_VERSION),
  route: appRouteSchema,
}).strict()

const panelLayoutSchema = z.object({
  version: z.literal(LAYOUT_DOCUMENT_VERSION),
  contextPanelWidth: z.number().finite(),
  inspectorWidth: z.number().finite(),
  inspectorOpen: z.boolean(),
}).strict()

const projectExpansionLayoutSchema = z
  .object({
    version: z.literal(LAYOUT_DOCUMENT_VERSION),
    projects: z
      .array(z
        .object({
          projectId: workspaceIdSchema,
          expanded: z.boolean(),
        })
        .strict())
      .max(MAX_PROJECT_EXPANSION_PREFERENCES),
  })
  .strict()

export interface LayoutPreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface ProjectCatalogLoadCandidate {
  projectId: string
  available: boolean
  hasCatalog: boolean
}

const DEFAULT_APP_ROUTE: AppRoute = Object.freeze({
  workspace: 'conversation',
  context: 'sessions',
})

const DEFAULT_PANEL_LAYOUT: PanelLayoutPreferences = Object.freeze({
  contextPanelWidth: CONTEXT_PANEL_DEFAULT_WIDTH,
  inspectorWidth: INSPECTOR_DEFAULT_WIDTH,
  inspectorOpen: true,
})

function boundedWidth(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback
}

export function normalizeAppRoute(value: unknown): AppRoute {
  const parsed = appRouteSchema.safeParse(value)
  if (parsed.success) return parsed.data

  // Removed and pre-redesign destinations are accepted only for migration.
  if (
    value === 'activity' ||
    (
      typeof value === 'object' &&
      value !== null &&
      (value as { workspace?: unknown }).workspace === 'conversation' &&
      (value as { context?: unknown }).context === 'activity'
    )
  ) return DEFAULT_APP_ROUTE
  if (value === 'integrations') return { workspace: 'settings', section: 'integrations' }
  if (value === 'settings') return { workspace: 'settings', section: 'appearance' }
  return DEFAULT_APP_ROUTE
}

export function deriveFrameLayoutMode(
  route: AppRoute,
  frameWidth: number,
): FrameLayoutMode {
  const compact = !Number.isFinite(frameWidth) || frameWidth <= COMPACT_FRAME_MAX_WIDTH
  if (route.workspace === 'settings') {
    return compact ? 'settings-compact' : 'settings-wide'
  }
  return compact ? 'conversation-compact' : 'conversation-wide'
}

export function normalizePanelLayout(
  value: Partial<PanelLayoutPreferences> | null | undefined,
): PanelLayoutPreferences {
  return {
    contextPanelWidth: boundedWidth(
      value?.contextPanelWidth,
      CONTEXT_PANEL_MIN_WIDTH,
      CONTEXT_PANEL_MAX_WIDTH,
      CONTEXT_PANEL_DEFAULT_WIDTH,
    ),
    inspectorWidth: boundedWidth(
      value?.inspectorWidth,
      INSPECTOR_MIN_WIDTH,
      INSPECTOR_MAX_WIDTH,
      INSPECTOR_DEFAULT_WIDTH,
    ),
    inspectorOpen: typeof value?.inspectorOpen === 'boolean'
      ? value.inspectorOpen
      : DEFAULT_PANEL_LAYOUT.inspectorOpen,
  }
}

function browserStorage(): LayoutPreferenceStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function readStoredValue(key: string, storage: LayoutPreferenceStorage | null) {
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw || raw.length > MAX_LAYOUT_DOCUMENT_CHARS) return null
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function writeStoredValue(
  key: string,
  value: unknown,
  storage: LayoutPreferenceStorage | null,
) {
  if (!storage) return
  try {
    const raw = JSON.stringify(value)
    if (raw.length > MAX_LAYOUT_DOCUMENT_CHARS) return
    storage.setItem(key, raw)
  } catch {
    // Layout persistence is best-effort and must never block renderer startup.
  }
}

export function readContextPanelOpen(
  storage: LayoutPreferenceStorage | null = browserStorage(),
) {
  const parsed = contextPanelLayoutSchema.safeParse(
    readStoredValue(CONTEXT_PANEL_LAYOUT_KEY, storage),
  )
  return parsed.success ? parsed.data.open : true
}

export function writeContextPanelOpen(
  open: boolean,
  storage: LayoutPreferenceStorage | null = browserStorage(),
) {
  writeStoredValue(CONTEXT_PANEL_LAYOUT_KEY, {
    version: LAYOUT_DOCUMENT_VERSION,
    open,
  }, storage)
}

export function readAppRoute(
  storage: LayoutPreferenceStorage | null = browserStorage(),
): AppRoute {
  const parsed = appRouteLayoutSchema.safeParse(
    readStoredValue(APP_ROUTE_LAYOUT_KEY, storage),
  )
  return parsed.success ? parsed.data.route : DEFAULT_APP_ROUTE
}

export function writeAppRoute(
  route: AppRoute,
  storage: LayoutPreferenceStorage | null = browserStorage(),
) {
  writeStoredValue(APP_ROUTE_LAYOUT_KEY, {
    version: LAYOUT_DOCUMENT_VERSION,
    route: normalizeAppRoute(route),
  }, storage)
}

export function readPanelLayout(
  storage: LayoutPreferenceStorage | null = browserStorage(),
): PanelLayoutPreferences {
  const parsed = panelLayoutSchema.safeParse(
    readStoredValue(PANEL_LAYOUT_KEY, storage),
  )
  return normalizePanelLayout(parsed.success ? parsed.data : null)
}

export function writePanelLayout(
  value: PanelLayoutPreferences,
  storage: LayoutPreferenceStorage | null = browserStorage(),
) {
  writeStoredValue(PANEL_LAYOUT_KEY, {
    version: LAYOUT_DOCUMENT_VERSION,
    ...normalizePanelLayout(value),
  }, storage)
}

export function readProjectExpansionPreferences(
  storage: LayoutPreferenceStorage | null = browserStorage(),
): ReadonlyMap<string, boolean> {
  const parsed = projectExpansionLayoutSchema.safeParse(
    readStoredValue(PROJECT_EXPANSION_LAYOUT_KEY, storage),
  )
  return new Map(parsed.success
    ? parsed.data.projects.map(({ projectId, expanded }) => [projectId, expanded])
    : [])
}

export function expandedProjectIdsNeedingCatalogLoad(
  preferences: ReadonlyMap<string, boolean>,
  projects: readonly ProjectCatalogLoadCandidate[],
) {
  return projects.flatMap(({ projectId, available, hasCatalog }) =>
    available && !hasCatalog && preferences.get(projectId) === true
      ? [projectId]
      : [])
}

function boundedProjectExpansionPreferences(
  preferences: Iterable<readonly [string, boolean]>,
) {
  const normalized = new Map<string, boolean>()

  for (const [projectId, expanded] of preferences) {
    if (!workspaceIdSchema.safeParse(projectId).success || typeof expanded !== 'boolean') {
      continue
    }
    // The newest explicit choice wins and remains within the bounded tail.
    normalized.delete(projectId)
    normalized.set(projectId, expanded)
    if (normalized.size > MAX_PROJECT_EXPANSION_PREFERENCES) {
      const oldestProjectId = normalized.keys().next().value
      if (oldestProjectId) normalized.delete(oldestProjectId)
    }
  }

  return [...normalized].map(([projectId, expanded]) => ({ projectId, expanded }))
}

export function writeProjectExpansionPreferences(
  preferences: Iterable<readonly [string, boolean]>,
  storage: LayoutPreferenceStorage | null = browserStorage(),
) {
  writeStoredValue(PROJECT_EXPANSION_LAYOUT_KEY, {
    version: LAYOUT_DOCUMENT_VERSION,
    projects: boundedProjectExpansionPreferences(preferences),
  }, storage)
}
