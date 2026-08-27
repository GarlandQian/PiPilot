import { z } from 'zod'
import { workspaceIdSchema } from '@/shared/schemas/workspace'

export const CONTEXT_PANEL_LAYOUT_KEY = 'pipilot.layout.context-panel.v1'
export const PROJECT_EXPANSION_LAYOUT_KEY = 'pipilot.layout.project-expansion.v1'

const LAYOUT_DOCUMENT_VERSION = 1
const MAX_LAYOUT_DOCUMENT_CHARS = 16_384
const MAX_PROJECT_EXPANSION_PREFERENCES = 100

const contextPanelLayoutSchema = z
  .object({
    version: z.literal(LAYOUT_DOCUMENT_VERSION),
    open: z.boolean(),
  })
  .strict()

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
