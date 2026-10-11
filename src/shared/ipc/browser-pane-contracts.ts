import { z } from 'zod'
import { defineIpcContract, requestContextSchema } from './contracts'
import { browserAnnotationSchema, browserBoundsSchema, browserCommandSchema, browserScopeKeySchema, browserSnapshotSchema } from '../browser-pane'

export const browserPaneChannels = {
  get: 'pipilot:browser:get', open: 'pipilot:browser:open', navigate: 'pipilot:browser:navigate', command: 'pipilot:browser:command',
  viewport: 'pipilot:browser:viewport', annotate: 'pipilot:browser:annotate', cancelAnnotation: 'pipilot:browser:cancel-annotation',
  changed: 'pipilot:browser:changed',
} as const
const base = { context: requestContextSchema, scopeKey: browserScopeKeySchema }
const tab = { ...base, tabId: z.uuid() }
export const browserGetContract = defineIpcContract(browserPaneChannels.get, z.object(base).strict(), browserSnapshotSchema)
export const browserOpenContract = defineIpcContract(browserPaneChannels.open, z.object({ ...base, url: z.string().max(8_192).optional() }).strict(), browserSnapshotSchema)
export const browserNavigateContract = defineIpcContract(browserPaneChannels.navigate, z.object({ ...tab, input: z.string().min(1).max(8_192) }).strict(), browserSnapshotSchema)
export const browserCommandContract = defineIpcContract(browserPaneChannels.command, z.object({ ...tab, command: browserCommandSchema }).strict(), browserSnapshotSchema)
export const browserViewportContract = defineIpcContract(browserPaneChannels.viewport, z.object({ ...base, bounds: browserBoundsSchema.nullable() }).strict(),
  z.object({ placeholder: z.string().max(16 * 1024 * 1024).optional() }).strict())
export const browserAnnotateContract = defineIpcContract(browserPaneChannels.annotate, z.object({ ...tab, mode: z.enum(['element', 'area']) }).strict(), browserAnnotationSchema.nullable())
export const browserCancelAnnotationContract = defineIpcContract(browserPaneChannels.cancelAnnotation, z.object(tab).strict(), z.object({ ok: z.literal(true) }).strict())
