import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { ConversationExportRequest, ConversationExportResult } from '../../shared/conversation-export'
import { localPiRpcResponseSchema } from '../../shared/local-pi'
import type { ConversationScope } from '../../shared/conversation-scope'
import type { PiRuntimeFrontend, PiRuntimeSelectionIdentity } from '../pi-host/pi-runtime-frontend'
import { buildConversationMarkdown, ConversationExportError } from './conversation-markdown'
import { readCatalogConversationHistory } from './catalog-conversation-history'
import type { OfficialPiSessionCatalog } from './official-pi-session-catalog'

interface ExportRuntime extends Pick<PiRuntimeFrontend, 'getActiveRuntimeIdentity' | 'getSnapshot' | 'request'>,
  Partial<Pick<PiRuntimeFrontend, 'listControlRuntimes' | 'getControlEntries'>> {}
function sameConversationScope(left: ConversationScope, right: ConversationScope) {
  return left.kind === right.kind && (left.kind === 'projectless' || (right.kind === 'project' && left.workspaceId === right.workspaceId))
}
export interface ConversationExportServiceOptions {
  runtime: ExportRuntime
  catalog?: Pick<OfficialPiSessionCatalog, 'resolveReadTarget' | 'revalidateControlTarget'>
  chooseDestination(defaultName: string, locale: ConversationExportRequest['locale']): Promise<string | null>
  homeDirectory?: string
}

function sameIdentity(left: PiRuntimeSelectionIdentity, right: PiRuntimeSelectionIdentity | null) {
  return Boolean(right && left.runtimeId === right.runtimeId && left.generation === right.generation &&
    left.selectionRevision === right.selectionRevision && left.sessionId === right.sessionId &&
    left.sessionFile === right.sessionFile && sameConversationScope(left.scope, right.scope))
}

/** Captures authoritative history before showing a native save dialog. Never reads renderer paths. */
export class ConversationExportService {
  private busy = false
  constructor(private readonly options: ConversationExportServiceOptions) {}

  async save(input: ConversationExportRequest): Promise<ConversationExportResult> {
    if (this.busy) throw new ConversationExportError('EXPORT_BUSY', 'Another conversation export is already open.')
    this.busy = true
    try { return await this.performSave(input) } finally { this.busy = false }
  }

  private async performSave(input: ConversationExportRequest): Promise<ConversationExportResult> {
    const { entries, leafId, title, assertCurrent } = 'selectionToken' in input
      ? await this.captureCatalog(input) : await this.captureActive(input)
    // Generated, path-free assets directory; the renderer cannot choose its contents or location.
    const assetDirectoryName = `pipilot-assets-${randomUUID().slice(0, 12)}`
    const output = buildConversationMarkdown({
      entries, leafId, input, title,
      homeDirectory: this.options.homeDirectory ?? homedir(), assetDirectoryName,
    })
    const baseName = title.replace(/[\\/:*?"<>|\u0000-\u001f]/gu, '-').replace(/^\.+/u, '').slice(0, 96).trim() || 'conversation'
    const responseSuffix = input.selection.kind === 'response' ? (input.locale === 'zh-CN' ? '-回答' : '-response')
      : input.selection.kind === 'message' ? (input.locale === 'zh-CN' ? '-消息' : '-message') : ''
    const chosen = await this.options.chooseDestination(`${baseName}${responseSuffix}.md`, input.locale)
    if (!chosen) return { status: 'cancelled' }
    await assertCurrent()
    // The native dialog confirms overwrites for this exact path. Do not append
    // an extension here and accidentally overwrite a different, unconfirmed file.
    const destination = chosen
    let staging: string | null = null
    let assetsPublished = false
    const assetsPath = join(dirname(destination), assetDirectoryName)
    try {
      // Stage beside the destination, then atomically publish the complete document.
      staging = await mkdtemp(join(dirname(destination), '.pipilot-export-'))
      if (output.images.length) {
        const stagedAssets = join(staging, assetDirectoryName)
        await mkdir(stagedAssets)
        for (const image of output.images) await writeFile(join(stagedAssets, image.name), image.bytes, { flag: 'wx', mode: 0o600 })
      }
      const stagedDocument = join(staging, 'conversation.md')
      await writeFile(stagedDocument, output.markdown, { flag: 'wx', mode: 0o600 })
      await assertCurrent()
      if (output.images.length) {
        await rename(join(staging, assetDirectoryName), assetsPath)
        assetsPublished = true
      }
      await assertCurrent()
      await rename(stagedDocument, destination)
      return { status: 'saved', fileName: basename(destination), imageCount: output.images.length }
    } catch (error) {
      if (assetsPublished) await rm(assetsPath, { recursive: true, force: true }).catch(() => undefined)
      if (error instanceof ConversationExportError) throw error
      throw new ConversationExportError('EXPORT_SAVE_FAILED', 'The Markdown export could not be saved. Choose another location.')
    } finally {
      if (staging) await rm(staging, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async captureCatalog(input: Extract<ConversationExportRequest, { selectionToken: string }>) {
    const { catalog, runtime } = this.options
    if (!catalog) throw new ConversationExportError('EXPORT_HISTORY_UNAVAILABLE', 'The conversation catalog is unavailable.')
    try {
      let target = await catalog.resolveReadTarget(input.scope, input.selectionToken)
      const assertCurrent = async () => {
        try { await catalog.revalidateControlTarget(target) } catch {
          throw new ConversationExportError('EXPORT_STALE_SESSION', 'The conversation file changed. Open export again.')
        }
      }
      const title = target.name || (input.locale === 'zh-CN' ? '会话' : 'Conversation')
      for (const handle of runtime.listControlRuntimes?.() ?? []) {
        // A duplicated session ID can live in two files. The native file and
        // scope, not the selected Renderer or the ID alone, decide ownership.
        if (!runtime.getControlEntries || !handle.sessionFile || handle.sessionId !== target.sessionId || !sameConversationScope(handle.scope, target.scope)) continue
        const runtimeFile = await realpath(handle.sessionFile).catch(() => null)
        if (runtimeFile !== target.sessionFile) continue
        const history = await runtime.getControlEntries(handle)
        await assertCurrent()
        return { ...history, title, assertCurrent }
      }
      const history = await readCatalogConversationHistory(target)
      target = history.target
      await assertCurrent()
      return { entries: history.entries, leafId: history.leafId, title, assertCurrent }
    } catch (error) {
      if (error instanceof ConversationExportError) throw error
      throw new ConversationExportError('EXPORT_STALE_SESSION', 'The conversation changed. Refresh the list and open export again.')
    }
  }

  private async captureActive(input: Exclude<ConversationExportRequest, { selectionToken: string }>) {
    const { runtime } = this.options
    const identity = runtime.getActiveRuntimeIdentity()
    const snapshot = runtime.getSnapshot()
    if (!identity || identity.generation !== input.generation || identity.sessionId !== input.sessionId ||
        !sameConversationScope(identity.scope, input.scope) || snapshot.state !== 'ready' || snapshot.generation !== input.generation ||
        snapshot.sessionState?.sessionId !== input.sessionId) {
      throw new ConversationExportError('EXPORT_STALE_SESSION', 'The active conversation changed. Open export again.')
    }
    const assertCurrent = () => {
      if (!sameIdentity(identity, runtime.getActiveRuntimeIdentity())) {
        throw new ConversationExportError('EXPORT_STALE_SESSION', 'The active conversation changed. Open export again.')
      }
    }
    const response = localPiRpcResponseSchema.parse(await runtime.request({ type: 'get_entries' }))
    assertCurrent()
    if (!response.success || response.command !== 'get_entries') throw new ConversationExportError('EXPORT_HISTORY_UNAVAILABLE', 'The conversation history could not be read.')
    const title = snapshot.sessionState.sessionName || (input.locale === 'zh-CN' ? '会话' : 'Conversation')
    return { ...response.data, title, assertCurrent }
  }
}
