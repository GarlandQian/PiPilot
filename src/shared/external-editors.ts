import { z } from 'zod'

/**
 * An app that can open project files: a detected editor, the system's
 * default app for the file, or the file manager (Finder, File Explorer).
 */
export const externalEditorSchema = z
  .object({
    /** A built-in editor's name, or the id of an editor the user added. */
    id: z.string().regex(/^(?:[a-z][a-z0-9-]{0,63}|external:custom:[a-zA-Z0-9_-]{1,64})$/u),
    aliases: z.array(z.string().regex(/^(?:[a-z][a-z0-9-]{0,63}|external:custom:[a-zA-Z0-9_-]{1,64})$/u)).max(128).optional(),
    name: z.string().max(128),
    kind: z.enum(['editor', 'system', 'file-manager']),
    source: z.enum(['detected', 'custom']).optional(),
    /** The app bundle or executable, shown in Settings. */
    path: z.string().max(4_096).optional(),
    /** False for an added editor whose app is missing. */
    available: z.boolean().optional(),
    /** The app's own icon, as a small PNG data URL. */
    icon: z.string().startsWith('data:image/png;base64,').max(96_000).optional(),
  })
  .strict()
export type ExternalEditor = z.infer<typeof externalEditorSchema>
export const externalEditorListSchema = z.object({ editors: z.array(externalEditorSchema).max(64) }).strict()
