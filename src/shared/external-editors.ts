import { z } from 'zod'

/**
 * An app that can open project files: a detected editor, the system's
 * default app for the file, or the file manager (Finder, File Explorer).
 */
export const externalEditorSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/u),
    name: z.string().max(128),
    kind: z.enum(['editor', 'system', 'file-manager']),
    /** The app's own icon, as a small PNG data URL. */
    icon: z.string().startsWith('data:image/png;base64,').max(96_000).optional(),
  })
  .strict()
export type ExternalEditor = z.infer<typeof externalEditorSchema>
export const externalEditorListSchema = z.object({ editors: z.array(externalEditorSchema).max(64) }).strict()
