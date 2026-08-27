import { z } from 'zod'
import {
  appSettingsPatchSchema,
  appSettingsSchema,
} from '../schemas/settings'
import {
  MCP_CONFIG_CONTENT_LIMIT,
  mcpConfigRestartResultSchema,
  mcpConfigSaveResultSchema,
  mcpConfigSnapshotSchema,
  mcpConfigTargetSchema,
} from '../mcp-config'
import {
  MODELS_CONFIG_CONTENT_LIMIT,
  modelsConfigDefaultsSchema,
  modelsConfigSaveResultSchema,
  modelsConfigSetDefaultResultSchema,
  modelsConfigSnapshotSchema,
  modelsConfigTargetSchema,
  modelsConfigTestResultSchema,
} from '../models-config'
import type { AppSettings, AppSettingsPatch } from '../settings'
import {
  workspaceChangedEventSchema,
  workspaceChooseResultSchema,
  workspaceIdSchema,
  workspacePinnedResultSchema,
  workspaceSnapshotSchema,
  workspaceSwitchResultSchema,
  type WorkspaceSnapshot,
} from '../schemas/workspace'
import {
  workspaceDiffFileSchema,
  workspaceDiffSnapshotSchema,
  workspaceDirectorySnapshotSchema,
  workspaceFilePreviewSchema,
  workspacePathSearchResultSchema,
  workspaceRelativePathSchema,
} from '../workspace-content'
import {
  TERMINAL_INPUT_LIMIT,
  terminalActionResultSchema,
  terminalColumnsSchema,
  terminalEventSchema,
  terminalIdSchema,
  terminalResizeResultSchema,
  terminalRowsSchema,
  terminalSessionSchema,
} from '../terminal'
import {
  localPiExtensionUiEventSchema,
  localPiExtensionUiResponseSchema,
  localPiRendererRpcCommandSchema,
  localPiRendererRpcResponseSchema,
  localPiRpcEventMessageSchema,
  localPiRuntimeChangedEventSchema,
  localPiRuntimeSnapshotSchema,
} from '../local-pi'
import {
  conversationActivationResultSchema,
  conversationNavigationChangedEventSchema,
  conversationNavigationSnapshotSchema,
  conversationScopeSchema,
  sessionCatalogDeleteResultSchema,
  sessionCatalogCursorSchema,
  sessionCatalogListResultSchema,
  sessionCatalogRenameResultSchema,
  sessionCatalogSelectionTokenSchema,
  SESSION_CATALOG_NAME_LIMIT,
} from '../conversation-scope'
import {
  PI_INTEGRATION_SOURCE_LIMIT,
  piIntegrationOperationEventSchema,
  piIntegrationOperationResultSchema,
  piIntegrationScopeSchema,
  piIntegrationSnapshotSchema,
} from '../pi-integrations'
import {
  applicationUpdateActionResultSchema,
  applicationUpdateChangedEventSchema,
  applicationUpdateSnapshotSchema,
} from '../application-update'
import {
  externalControlLauncherSnapshotSchema,
  externalControlSettingsSnapshotSchema,
} from '../external-control'

export const ipcChannels = {
  appGetInfo: 'pipilot:app:get-info',
  applicationUpdateChanged: 'pipilot:application-update:changed',
  applicationUpdateGet: 'pipilot:application-update:get',
  applicationUpdateCheck: 'pipilot:application-update:check',
  applicationUpdateDownload: 'pipilot:application-update:download',
  applicationUpdateInstall: 'pipilot:application-update:install',
  conversationNavigationChanged: 'pipilot:conversation:navigation-changed',
  conversationNavigationGet: 'pipilot:conversation:navigation-get',
  conversationNew: 'pipilot:conversation:new',
  externalControlChanged: 'pipilot:external-control:changed',
  externalControlGet: 'pipilot:external-control:get',
  externalControlLauncherGet: 'pipilot:external-control:launcher-get',
  externalControlLauncherInstall: 'pipilot:external-control:launcher-install',
  externalControlLauncherUninstall: 'pipilot:external-control:launcher-uninstall',
  externalControlSetEnabled: 'pipilot:external-control:set-enabled',
  localPiCommand: 'pipilot:local-pi:command',
  localPiExtensionUiRequest: 'pipilot:local-pi:extension-ui-request',
  localPiExtensionUiRespond: 'pipilot:local-pi:extension-ui-respond',
  localPiRpcEvent: 'pipilot:local-pi:rpc-event',
  localPiRendererReady: 'pipilot:local-pi:renderer-ready',
  localPiRuntimeChanged: 'pipilot:local-pi:runtime-changed',
  localPiRuntimeRestart: 'pipilot:local-pi:runtime-restart',
  localPiRuntimeStatus: 'pipilot:local-pi:runtime-status',
  piIntegrationsCheckUpdates: 'pipilot:pi-integrations:check-updates',
  piIntegrationsInstall: 'pipilot:pi-integrations:install',
  piIntegrationsLoad: 'pipilot:pi-integrations:load',
  piIntegrationsOperation: 'pipilot:pi-integrations:operation',
  piIntegrationsRemove: 'pipilot:pi-integrations:remove',
  piIntegrationsRestart: 'pipilot:pi-integrations:restart',
  piIntegrationsSetRetry: 'pipilot:pi-integrations:set-retry',
  piIntegrationsUpdate: 'pipilot:pi-integrations:update',
  mcpConfigLoad: 'pipilot:mcp-config:load',
  mcpConfigRestart: 'pipilot:mcp-config:restart',
  mcpConfigSave: 'pipilot:mcp-config:save',
  modelsConfigLoad: 'pipilot:models:load',
  modelsConfigSave: 'pipilot:models:save',
  modelsConfigSaveAndRestart: 'pipilot:models:saveAndRestart',
  modelsConfigSetDefault: 'pipilot:models:setDefault',
  modelsConfigTest: 'pipilot:models:test',
  modelsConfigGetDefaults: 'pipilot:models:getDefaults',
  sessionCatalogDelete: 'pipilot:session-catalog:delete',
  sessionCatalogList: 'pipilot:session-catalog:list',
  sessionCatalogOpen: 'pipilot:session-catalog:open',
  sessionCatalogRename: 'pipilot:session-catalog:rename',
  sessionCatalogRefresh: 'pipilot:session-catalog:refresh',
  settingsChanged: 'pipilot:settings:changed',
  settingsGet: 'pipilot:settings:get',
  settingsReset: 'pipilot:settings:reset',
  settingsUpdate: 'pipilot:settings:update',
  shellOpenExternal: 'pipilot:shell:open-external',
  terminalCreate: 'pipilot:terminal:create',
  terminalEvent: 'pipilot:terminal:event',
  terminalInput: 'pipilot:terminal:input',
  terminalKill: 'pipilot:terminal:kill',
  terminalResize: 'pipilot:terminal:resize',
  workspaceChanged: 'pipilot:workspace:changed',
  workspaceChoose: 'pipilot:workspace:choose',
  workspaceDiffList: 'pipilot:workspace-diff:list',
  workspaceDiffRead: 'pipilot:workspace-diff:read',
  workspaceFilePreview: 'pipilot:workspace-file:preview',
  workspaceFilesList: 'pipilot:workspace-files:list',
  workspaceFilesSearch: 'pipilot:workspace-files:search',
  workspaceGet: 'pipilot:workspace:get',
  workspaceOpen: 'pipilot:workspace:open',
  workspaceRemove: 'pipilot:workspace:remove',
  workspaceSetPinned: 'pipilot:workspace:set-pinned',
  windowGetState: 'pipilot:window:get-state',
} as const

export type IpcChannel = (typeof ipcChannels)[keyof typeof ipcChannels]

export const requestContextSchema = z
  .object({
    requestId: z.uuid(),
    sessionId: z.string().min(1).max(256).optional(),
    workspaceId: z.string().min(1).max(256).optional(),
  })
  .strict()

export type RequestContext = z.infer<typeof requestContextSchema>

export const appErrorSchema = z
  .object({
    code: z.string().min(1).max(128),
    message: z.string().min(1).max(1_000),
    details: z.unknown().optional(),
    recoverable: z.boolean(),
    source: z.enum(['renderer', 'preload', 'main', 'terminal']),
    requestId: z.uuid().optional(),
    sessionId: z.string().min(1).max(256).optional(),
  })
  .strict()

export type AppError = z.infer<typeof appErrorSchema>

export type IpcResult<T> =
  | { ok: true; requestId: string; value: T }
  | { ok: false; requestId: string; error: AppError }

export function createIpcResultSchema<TSchema extends z.ZodType>(valueSchema: TSchema) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), requestId: z.uuid(), value: valueSchema }).strict(),
    z.object({ ok: z.literal(false), requestId: z.uuid(), error: appErrorSchema }).strict(),
  ])
}

export interface IpcContract<TRequest, TResponse> {
  readonly channel: IpcChannel
  readonly requestSchema: z.ZodType<TRequest, any>
  readonly responseSchema: z.ZodType<TResponse, any>
  readonly resultSchema: z.ZodType<IpcResult<TResponse>, any>
}

function defineIpcContract<
  TRequestSchema extends z.ZodType,
  TResponseSchema extends z.ZodType,
>(
  channel: IpcChannel,
  requestSchema: TRequestSchema,
  responseSchema: TResponseSchema,
): IpcContract<z.output<TRequestSchema>, z.output<TResponseSchema>> {
  return {
    channel,
    requestSchema: requestSchema as z.ZodType<z.output<TRequestSchema>, any>,
    responseSchema: responseSchema as z.ZodType<z.output<TResponseSchema>, any>,
    resultSchema: createIpcResultSchema(responseSchema) as z.ZodType<
      IpcResult<z.output<TResponseSchema>>,
      any
    >,
  }
}

const requestFields = { context: requestContextSchema }

export const appInfoSchema = z.object({
  name: z.literal('PiPilot'),
  version: z.string().min(1).max(64),
  platform: z.string().min(1).max(32),
  arch: z.string().min(1).max(32),
  electronVersion: z.string().min(1).max(64),
  mode: z.enum(['development', 'production']),
}).strict()
export type AppInfo = z.infer<typeof appInfoSchema>

export const windowSnapshotSchema = z.object({
  focused: z.boolean(),
  fullScreen: z.boolean(),
  maximized: z.boolean(),
}).strict()
export type WindowSnapshot = z.infer<typeof windowSnapshotSchema>

export const openExternalResponseSchema = z.object({ opened: z.literal(true) }).strict()
export type OpenExternalResponse = z.infer<typeof openExternalResponseSchema>

export const settingsSnapshotSchema = z.object({
  revision: z.number().int().nonnegative(),
  settings: appSettingsSchema,
}).strict()
export type SettingsSnapshot = z.infer<typeof settingsSnapshotSchema>

export const settingsChangedEventSchema = z.object({
  eventId: z.uuid(),
  snapshot: settingsSnapshotSchema,
}).strict()

export const settingsResetScopeSchema = z.enum(['all', 'appearance', 'terminal'])
export type SettingsResetScope = z.infer<typeof settingsResetScopeSchema>

export const appGetInfoContract = defineIpcContract(ipcChannels.appGetInfo, z.object(requestFields).strict(), appInfoSchema)
export const applicationUpdateGetContract = defineIpcContract(
  ipcChannels.applicationUpdateGet,
  z.object(requestFields).strict(),
  applicationUpdateSnapshotSchema,
)
export const applicationUpdateCheckContract = defineIpcContract(
  ipcChannels.applicationUpdateCheck,
  z.object(requestFields).strict(),
  applicationUpdateActionResultSchema,
)
export const applicationUpdateDownloadContract = defineIpcContract(
  ipcChannels.applicationUpdateDownload,
  z.object(requestFields).strict(),
  applicationUpdateActionResultSchema,
)
export const applicationUpdateInstallContract = defineIpcContract(
  ipcChannels.applicationUpdateInstall,
  z.object({ ...requestFields, confirmActiveWork: z.boolean().default(false) }).strict(),
  applicationUpdateActionResultSchema,
)
export const externalControlGetContract = defineIpcContract(
  ipcChannels.externalControlGet,
  z.object(requestFields).strict(),
  externalControlSettingsSnapshotSchema,
)
export const externalControlSetEnabledContract = defineIpcContract(
  ipcChannels.externalControlSetEnabled,
  z.object({ ...requestFields, enabled: z.boolean() }).strict(),
  externalControlSettingsSnapshotSchema,
)
export const externalControlLauncherGetContract = defineIpcContract(
  ipcChannels.externalControlLauncherGet,
  z.object(requestFields).strict(),
  externalControlLauncherSnapshotSchema,
)
export const externalControlLauncherInstallContract = defineIpcContract(
  ipcChannels.externalControlLauncherInstall,
  z.object(requestFields).strict(),
  externalControlLauncherSnapshotSchema,
)
export const externalControlLauncherUninstallContract = defineIpcContract(
  ipcChannels.externalControlLauncherUninstall,
  z.object(requestFields).strict(),
  externalControlLauncherSnapshotSchema,
)
export const windowGetStateContract = defineIpcContract(ipcChannels.windowGetState, z.object(requestFields).strict(), windowSnapshotSchema)
export const settingsGetContract = defineIpcContract(ipcChannels.settingsGet, z.object(requestFields).strict(), settingsSnapshotSchema)
export const settingsUpdateContract = defineIpcContract(
  ipcChannels.settingsUpdate,
  z.object({ ...requestFields, patch: appSettingsPatchSchema }).strict(),
  settingsSnapshotSchema,
)
export const settingsResetContract = defineIpcContract(
  ipcChannels.settingsReset,
  z.object({ ...requestFields, scope: settingsResetScopeSchema }).strict(),
  settingsSnapshotSchema,
)
export type { AppSettings, AppSettingsPatch }

export const shellOpenExternalContract = defineIpcContract(
  ipcChannels.shellOpenExternal,
  z.object({ ...requestFields, url: z.string().min(1).max(2_048) }).strict(),
  openExternalResponseSchema,
)

export const localPiRuntimeStatusContract = defineIpcContract(ipcChannels.localPiRuntimeStatus, z.object(requestFields).strict(), localPiRuntimeSnapshotSchema)
export const localPiRuntimeRestartContract = defineIpcContract(ipcChannels.localPiRuntimeRestart, z.object(requestFields).strict(), localPiRuntimeSnapshotSchema)
export const localPiRendererReadyContract = defineIpcContract(
  ipcChannels.localPiRendererReady,
  z.object(requestFields).strict(),
  z.object({ accepted: z.literal(true) }).strict(),
)
export const localPiCommandContract = defineIpcContract(
  ipcChannels.localPiCommand,
  z.object({ ...requestFields, command: localPiRendererRpcCommandSchema }).strict(),
  localPiRendererRpcResponseSchema,
)
export const localPiExtensionUiRespondContract = defineIpcContract(
  ipcChannels.localPiExtensionUiRespond,
  z.object({ ...requestFields, generation: z.number().int().nonnegative(), response: localPiExtensionUiResponseSchema }).strict(),
  z.object({ accepted: z.literal(true) }).strict(),
)


const piIntegrationRequestFields = {
  ...requestFields,
  scope: piIntegrationScopeSchema,
}
const piIntegrationSourceSchema = z
  .string()
  .trim()
  .min(1)
  .max(PI_INTEGRATION_SOURCE_LIMIT)

export const piIntegrationsLoadContract = defineIpcContract(
  ipcChannels.piIntegrationsLoad,
  z.object(piIntegrationRequestFields).strict(),
  piIntegrationSnapshotSchema,
)
export const piIntegrationsInstallContract = defineIpcContract(
  ipcChannels.piIntegrationsInstall,
  z.object({ ...piIntegrationRequestFields, source: piIntegrationSourceSchema }).strict(),
  piIntegrationOperationResultSchema,
)
export const piIntegrationsUpdateContract = defineIpcContract(
  ipcChannels.piIntegrationsUpdate,
  z.object({ ...piIntegrationRequestFields, source: piIntegrationSourceSchema }).strict(),
  piIntegrationOperationResultSchema,
)
export const piIntegrationsRemoveContract = defineIpcContract(
  ipcChannels.piIntegrationsRemove,
  z.object({ ...piIntegrationRequestFields, source: piIntegrationSourceSchema }).strict(),
  piIntegrationOperationResultSchema,
)
export const piIntegrationsCheckUpdatesContract = defineIpcContract(
  ipcChannels.piIntegrationsCheckUpdates,
  z.object(piIntegrationRequestFields).strict(),
  piIntegrationOperationResultSchema,
)
export const piIntegrationsSetRetryContract = defineIpcContract(
  ipcChannels.piIntegrationsSetRetry,
  z.object({ ...piIntegrationRequestFields, enabled: z.boolean() }).strict(),
  piIntegrationOperationResultSchema,
)
export const piIntegrationsRestartContract = defineIpcContract(
  ipcChannels.piIntegrationsRestart,
  z.object(piIntegrationRequestFields).strict(),
  piIntegrationOperationResultSchema,
)

export const sessionCatalogListContract = defineIpcContract(
  ipcChannels.sessionCatalogList,
  z.object({ ...requestFields, scope: conversationScopeSchema, cursor: sessionCatalogCursorSchema.optional() }).strict(),
  sessionCatalogListResultSchema,
)
export const sessionCatalogDeleteContract = defineIpcContract(
  ipcChannels.sessionCatalogDelete,
  z.object({ ...requestFields, scope: conversationScopeSchema, selectionToken: sessionCatalogSelectionTokenSchema }).strict(),
  sessionCatalogDeleteResultSchema,
)
export const sessionCatalogRefreshContract = defineIpcContract(
  ipcChannels.sessionCatalogRefresh,
  z.object({ ...requestFields, scope: conversationScopeSchema }).strict(),
  sessionCatalogListResultSchema,
)
export const sessionCatalogOpenContract = defineIpcContract(
  ipcChannels.sessionCatalogOpen,
  z.object({ ...requestFields, scope: conversationScopeSchema, selectionToken: sessionCatalogSelectionTokenSchema }).strict(),
  conversationActivationResultSchema,
)
export const sessionCatalogRenameContract = defineIpcContract(
  ipcChannels.sessionCatalogRename,
  z.object({
    ...requestFields,
    scope: conversationScopeSchema,
    selectionToken: sessionCatalogSelectionTokenSchema,
    name: z.string().trim().min(1).max(SESSION_CATALOG_NAME_LIMIT),
  }).strict(),
  sessionCatalogRenameResultSchema,
)
export const conversationNavigationGetContract = defineIpcContract(ipcChannels.conversationNavigationGet, z.object(requestFields).strict(), conversationNavigationSnapshotSchema)
export const conversationNewContract = defineIpcContract(
  ipcChannels.conversationNew,
  z.object({ ...requestFields, scope: conversationScopeSchema }).strict(),
  conversationActivationResultSchema,
)

export const mcpConfigLoadContract = defineIpcContract(ipcChannels.mcpConfigLoad, z.object({ ...requestFields, target: mcpConfigTargetSchema }).strict(), mcpConfigSnapshotSchema)
export const mcpConfigSaveContract = defineIpcContract(
  ipcChannels.mcpConfigSave,
  z.object({
    ...requestFields,
    target: mcpConfigTargetSchema,
    content: z.string().max(MCP_CONFIG_CONTENT_LIMIT),
    expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    restart: z.boolean().default(true),
  }).strict(),
  mcpConfigSaveResultSchema,
)
export const mcpConfigRestartContract = defineIpcContract(ipcChannels.mcpConfigRestart, z.object(requestFields).strict(), mcpConfigRestartResultSchema)

const modelsConfigSaveRequestFields = {
  ...requestFields,
  target: modelsConfigTargetSchema,
  content: z.string().max(MODELS_CONFIG_CONTENT_LIMIT),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}
export const modelsConfigLoadContract = defineIpcContract(ipcChannels.modelsConfigLoad, z.object({ ...requestFields, target: modelsConfigTargetSchema }).strict(), modelsConfigSnapshotSchema)
export const modelsConfigSaveContract = defineIpcContract(ipcChannels.modelsConfigSave, z.object(modelsConfigSaveRequestFields).strict(), modelsConfigSaveResultSchema)
export const modelsConfigSaveAndRestartContract = defineIpcContract(ipcChannels.modelsConfigSaveAndRestart, z.object(modelsConfigSaveRequestFields).strict(), modelsConfigSaveResultSchema)
export const modelsConfigSetDefaultContract = defineIpcContract(
  ipcChannels.modelsConfigSetDefault,
  z.object({
    ...requestFields,
    providerId: z.string().min(1).max(256),
    modelId: z.string().min(1).max(256),
  }).strict(),
  modelsConfigSetDefaultResultSchema,
)
export const modelsConfigTestContract = defineIpcContract(
  ipcChannels.modelsConfigTest,
  z.object({
    ...requestFields,
    target: modelsConfigTargetSchema,
    content: z.string().max(MODELS_CONFIG_CONTENT_LIMIT),
    providerId: z.string().min(1).max(256),
    modelId: z.string().min(1).max(256),
  }).strict(),
  modelsConfigTestResultSchema,
)
export const modelsConfigGetDefaultsContract = defineIpcContract(ipcChannels.modelsConfigGetDefaults, z.object({ ...requestFields, target: modelsConfigTargetSchema }).strict(), modelsConfigDefaultsSchema)

export const workspaceGetContract = defineIpcContract(ipcChannels.workspaceGet, z.object(requestFields).strict(), workspaceSnapshotSchema)
export const workspaceChooseContract = defineIpcContract(ipcChannels.workspaceChoose, z.object(requestFields).strict(), workspaceChooseResultSchema)
export const workspaceOpenContract = defineIpcContract(ipcChannels.workspaceOpen, z.object({ ...requestFields, workspaceId: workspaceIdSchema }).strict(), workspaceSwitchResultSchema)
export const workspaceRemoveResultSchema = z.discriminatedUnion('activeRemoved', [
  z
    .object({
      activeRemoved: z.literal(false),
      workspaceId: workspaceIdSchema,
      snapshot: workspaceSnapshotSchema,
    })
    .strict(),
  z
    .object({
      activeRemoved: z.literal(true),
      workspaceId: workspaceIdSchema,
      snapshot: workspaceSnapshotSchema,
      activation: conversationActivationResultSchema,
    })
    .strict(),
])
export type WorkspaceRemoveResult = z.infer<typeof workspaceRemoveResultSchema>
export const workspaceRemoveContract = defineIpcContract(ipcChannels.workspaceRemove, z.object({ ...requestFields, workspaceId: workspaceIdSchema }).strict(), workspaceRemoveResultSchema)
export const workspaceSetPinnedContract = defineIpcContract(ipcChannels.workspaceSetPinned, z.object({ ...requestFields, workspaceId: workspaceIdSchema, pinned: z.boolean() }).strict(), workspacePinnedResultSchema)

const workspaceContentRequestFields = { ...requestFields, workspaceId: workspaceIdSchema }
export const workspaceFilesListContract = defineIpcContract(ipcChannels.workspaceFilesList, z.object({ ...workspaceContentRequestFields, path: workspaceRelativePathSchema }).strict(), workspaceDirectorySnapshotSchema)
export const workspaceFilePreviewContract = defineIpcContract(ipcChannels.workspaceFilePreview, z.object({ ...workspaceContentRequestFields, path: workspaceRelativePathSchema }).strict(), workspaceFilePreviewSchema)
export const workspaceFilesSearchContract = defineIpcContract(ipcChannels.workspaceFilesSearch, z.object({ ...workspaceContentRequestFields, query: z.string().max(512) }).strict(), workspacePathSearchResultSchema)
export const workspaceDiffListContract = defineIpcContract(ipcChannels.workspaceDiffList, z.object(workspaceContentRequestFields).strict(), workspaceDiffSnapshotSchema)
export const workspaceDiffReadContract = defineIpcContract(ipcChannels.workspaceDiffRead, z.object({ ...workspaceContentRequestFields, path: workspaceRelativePathSchema }).strict(), workspaceDiffFileSchema)

const terminalRequestFields = { ...requestFields, scope: conversationScopeSchema, terminalId: terminalIdSchema }
export const terminalCreateContract = defineIpcContract(ipcChannels.terminalCreate, z.object({ ...requestFields, scope: conversationScopeSchema, cols: terminalColumnsSchema, rows: terminalRowsSchema }).strict(), terminalSessionSchema)
export const terminalInputContract = defineIpcContract(ipcChannels.terminalInput, z.object({ ...terminalRequestFields, data: z.string().min(1).max(TERMINAL_INPUT_LIMIT) }).strict(), terminalActionResultSchema)
export const terminalResizeContract = defineIpcContract(ipcChannels.terminalResize, z.object({ ...terminalRequestFields, cols: terminalColumnsSchema, rows: terminalRowsSchema }).strict(), terminalResizeResultSchema)
export const terminalKillContract = defineIpcContract(ipcChannels.terminalKill, z.object(terminalRequestFields).strict(), terminalActionResultSchema)

export {
  applicationUpdateChangedEventSchema,
  conversationNavigationChangedEventSchema,
  localPiExtensionUiEventSchema,
  localPiRpcEventMessageSchema,
  localPiRuntimeChangedEventSchema,
  piIntegrationOperationEventSchema,
  terminalEventSchema,
  workspaceChangedEventSchema,
}
export type { WorkspaceSnapshot }
