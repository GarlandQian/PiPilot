import { z } from 'zod'

export const piDirectorySnapshotSchema = z.object({
  activeDirectory: z.string(),
  defaultDirectory: z.string(),
  selectedDirectory: z.string().nullable(),
  restartRequired: z.boolean(),
}).strict()
export type PiDirectorySnapshot = z.infer<typeof piDirectorySnapshotSchema>
