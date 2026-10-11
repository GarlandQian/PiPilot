import { z } from 'zod'

/** Browser tabs belong to a project (or to general chats): `project:<id>` or `projectless`. */
export const browserScopeKeySchema = z.string().regex(/^(?:projectless|project:[0-9a-f-]{36})$/u)

export const browserTabSchema = z.object({
  id: z.uuid(),
  url: z.string().max(8_192),
  title: z.string().max(1_024),
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  consoleErrors: z.number().int().nonnegative(),
  networkErrors: z.number().int().nonnegative(),
  /** The last navigation failed (e.g. the dev server is not running). */
  failure: z.object({ code: z.number().int(), description: z.string().max(512) }).strict().optional(),
}).strict()
export type BrowserTab = z.infer<typeof browserTabSchema>

export const browserSnapshotSchema = z.object({
  scopeKey: browserScopeKeySchema,
  tabs: z.array(browserTabSchema).max(20),
  activeId: z.uuid().nullable(),
  /** A local address a running project action printed (its dev server). */
  suggestedUrl: z.string().max(2_048).optional(),
}).strict()
export type BrowserSnapshot = z.infer<typeof browserSnapshotSchema>

export const browserBoundsSchema = z.object({
  x: z.number().finite(), y: z.number().finite(),
  width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative(),
}).strict()
export type BrowserBounds = z.infer<typeof browserBoundsSchema>

export const browserCommandSchema = z.enum(['back', 'forward', 'reload', 'stop', 'close', 'select', 'external', 'devtools'])
export type BrowserCommand = z.infer<typeof browserCommandSchema>

/** What an annotation captured from the page, for the composer. */
export const browserAnnotationSchema = z.object({
  url: z.string().max(8_192),
  title: z.string().max(1_024),
  kind: z.enum(['element', 'area']),
  selector: z.string().max(2_048).optional(),
  html: z.string().max(8_000).optional(),
  text: z.string().max(2_000).optional(),
  styles: z.record(z.string().max(64), z.string().max(256)).optional(),
  rect: browserBoundsSchema,
  /** PNG of the element or area, as a data URL. */
  screenshot: z.string().max(12 * 1024 * 1024),
  consoleErrors: z.array(z.string().max(2_000)).max(20),
}).strict()
export type BrowserAnnotation = z.infer<typeof browserAnnotationSchema>

export const browserChangedEventSchema = z.object({ eventId: z.uuid(), snapshot: browserSnapshotSchema }).strict()

export interface BrowserPaneApi {
  get(scopeKey: string): Promise<BrowserSnapshot>
  /** A new tab (with `url`, or the suggested dev server, or a blank start page). */
  open(scopeKey: string, url?: string): Promise<BrowserSnapshot>
  navigate(scopeKey: string, tabId: string, input: string): Promise<BrowserSnapshot>
  command(scopeKey: string, tabId: string, command: BrowserCommand): Promise<BrowserSnapshot>
  /**
   * Shows the scope's active tab over `bounds` (window coordinates), or hides
   * it (null). Hiding answers with a picture of the page for a placeholder.
   */
  setViewport(scopeKey: string, bounds: BrowserBounds | null): Promise<{ placeholder?: string }>
  annotate(scopeKey: string, tabId: string, mode: 'element' | 'area'): Promise<BrowserAnnotation | null>
  cancelAnnotation(scopeKey: string, tabId: string): Promise<void>
  subscribe(listener: (snapshot: BrowserSnapshot) => void): () => void
}
