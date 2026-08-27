import { randomUUID } from 'node:crypto'
import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent'
import {
  localPiExtensionUiRequestSchema,
  type LocalPiExtensionUiRequest,
  type LocalPiExtensionUiResponse,
} from '../../shared/local-pi'

export const DEFAULT_MAX_EXTENSION_UI_DEADLINE_MS = 10 * 60 * 1_000
const DEFAULT_MAX_PENDING_DIALOGS = 32
const MAX_PENDING_DIALOGS = 256

export type ExtensionUiRequestSink = (request: LocalPiExtensionUiRequest) => void
export type ExtensionUiFatalSink = (error: unknown) => void

interface PendingDialog {
  id: string
  resolved: boolean
  defaultValue: unknown
  resolve: (value: never) => void
  cancelTimer: () => void
}

/** Local projection of the public dialog option shape used by the SDK. */
interface ExtensionUiDialogLikeOptions {
  signal?: AbortSignal
  timeout?: number
}

/** Options for extension widgets exported by the public SDK. */
type ExtensionWidgetOptions = {
  placement?: 'aboveEditor' | 'belowEditor'
}

/**
 * Plain-text Theme for headless Electron/RPC execution. Extensions may use
 * Pi's public Theme helpers while constructing status or widget strings; the
 * desktop renderer owns color, so every styling operation returns plain text.
 */
export function createHeadlessPiTheme() {
  const pass = (text: string) => text
  const wrap = (_color: string, text: string) => text
  return Object.freeze({
    name: 'pipilot-headless',
    fg: wrap,
    bg: wrap,
    bold: pass,
    italic: pass,
    underline: pass,
    inverse: pass,
    strikethrough: pass,
    getFgAnsi: () => '',
    getBgAnsi: () => '',
    getColorMode: () => '256color' as const,
    getThinkingBorderColor: () => pass,
    getBashModeBorderColor: () => pass,
  })
}

/**
 * Host-side projection of Pi's portable extension UI contract.
 *
 * Mirrors the pinned official RPC semantics:
 *  - `select`/`confirm`/`input` honor the plugin-provided `timeout` and
 *    `AbortSignal` and resolve the official default value on expiry;
 *  - `editor` carries no plugin timeout in official RPC; the Host still applies
 *    a bounded maximum deadline so a stalled Renderer can never keep a Runtime
 *    pending forever (a deliberate PiPilot liveness rule);
 *  - fire-and-forget surfaces (`notify`, `setStatus`, string widgets,
 *    `setTitle`, `set_editor_text`) are emitted once and never settle;
 *  - every TUI-only surface degrades exactly like official RPC: no-op or
 *    unsupported result, without inventing a second GUI system.
 *
 * Only plain DTOs leave the Host. Pending dialogs are keyed by a random id,
 * settle exactly once, and can be cancelled en masse on replacement, disposal,
 * or Host shutdown — after which late responses are ignored (idempotent).
 */
export class RuntimeExtensionUiBridge {
  private readonly pendingDialogs = new Map<string, PendingDialog>()
  private readonly maxDeadlineMs: number
  private readonly maxPendingDialogs: number
  private readonly onFatal?: ExtensionUiFatalSink
  private editorText = ''
  private capacityReached = false
  private readonly unsupportedMethods = new Set<string>()
  private readonly statusKeys = new Set<string>()
  private readonly widgetKeys = new Set<string>()
  private workingMessageSet = false
  private workingVisibleSet = false
  private titleSet = false

  readonly uiContext: ExtensionUIContext

  constructor(
    private readonly onRequest: ExtensionUiRequestSink,
    options: {
      maxDeadlineMs?: number
      maxPendingDialogs?: number
      onFatal?: ExtensionUiFatalSink
    } = {},
  ) {
    const maxDeadlineMs = options.maxDeadlineMs ??
      DEFAULT_MAX_EXTENSION_UI_DEADLINE_MS
    if (!Number.isFinite(maxDeadlineMs) || maxDeadlineMs <= 0) {
      throw new RangeError('maxDeadlineMs must be a positive number.')
    }
    this.maxDeadlineMs = maxDeadlineMs
    const maxPendingDialogs = options.maxPendingDialogs ??
      DEFAULT_MAX_PENDING_DIALOGS
    if (
      !Number.isSafeInteger(maxPendingDialogs) ||
      maxPendingDialogs < 1 ||
      maxPendingDialogs > MAX_PENDING_DIALOGS
    ) {
      throw new RangeError(
        `maxPendingDialogs must be an integer between 1 and ${MAX_PENDING_DIALOGS}.`,
      )
    }
    this.maxPendingDialogs = maxPendingDialogs
    this.onFatal = options.onFatal
    const headlessTheme = createHeadlessPiTheme()
    this.uiContext = {
      select: (title, options, opts) =>
        this.openDialog(
          {
            method: 'select',
            title,
            options,
            ...(opts?.timeout === undefined ? {} : { timeout: opts.timeout }),
          },
          undefined,
          opts,
        ),
      confirm: (title, message, opts) =>
        this.openDialog(
          {
            method: 'confirm',
            title,
            message,
            ...(opts?.timeout === undefined ? {} : { timeout: opts.timeout }),
          },
          false,
          opts,
        ),
      input: (title, placeholder, opts) =>
        this.openDialog(
          {
            method: 'input',
            title,
            ...(placeholder === undefined ? {} : { placeholder }),
            ...(opts?.timeout === undefined ? {} : { timeout: opts.timeout }),
          },
          undefined,
          opts,
        ),
      editor: (title, prefill) =>
        this.openDialog(
          {
            method: 'editor',
            title,
            ...(prefill === undefined ? {} : { prefill }),
          },
          undefined,
        ),
      notify: (message, type) => {
        this.emit({
          type: 'extension_ui_request',
          id: randomUUID(),
          method: 'notify',
          message,
          ...(type === undefined ? {} : { notifyType: type }),
        })
      },
      onTerminalInput: () => {
        this.reportUnsupported('onTerminalInput')
        return () => {}
      },
      setStatus: (key, text) => {
        if (text === undefined) this.statusKeys.delete(key)
        else this.statusKeys.add(key)
        this.emit({
          type: 'extension_ui_request',
          id: randomUUID(),
          method: 'setStatus',
          statusKey: key,
          ...(text === undefined ? {} : { statusText: text }),
        })
      },
      setWorkingMessage: (message) => {
        this.workingMessageSet = message !== undefined
        this.emit({
          type: 'extension_ui_request',
          id: randomUUID(),
          method: 'setWorkingMessage',
          ...(message === undefined ? {} : { message }),
        })
      },
      setWorkingVisible: (visible) => {
        this.workingVisibleSet = true
        this.emit({
          type: 'extension_ui_request',
          id: randomUUID(),
          method: 'setWorkingVisible',
          visible,
        })
      },
      setWorkingIndicator: () => this.reportUnsupported('setWorkingIndicator'),
      setHiddenThinkingLabel: () => this.reportUnsupported('setHiddenThinkingLabel'),
      setWidget: (
        key,
        content,
        options: ExtensionWidgetOptions | undefined,
      ) => {
        if (content === undefined || Array.isArray(content)) {
          if (content === undefined) this.widgetKeys.delete(key)
          else this.widgetKeys.add(key)
          this.emit({
            type: 'extension_ui_request',
            id: randomUUID(),
            method: 'setWidget',
            widgetKey: key,
            ...(Array.isArray(content) ? { widgetLines: content } : {}),
            ...(options?.placement === undefined
              ? {}
              : { widgetPlacement: options.placement }),
          })
        } else {
          this.reportUnsupported('setWidget.component')
        }
      },
      setFooter: (factory) => {
        if (factory !== undefined) this.reportUnsupported('setFooter')
      },
      setHeader: (factory) => {
        if (factory !== undefined) this.reportUnsupported('setHeader')
      },
      setTitle: (title) => {
        this.titleSet = title.length > 0
        this.emit({
          type: 'extension_ui_request',
          id: randomUUID(),
          method: 'setTitle',
          title,
        })
      },
      custom: async () => {
        this.reportUnsupported('custom')
        return undefined as never
      },
      pasteToEditor: (text) => this.applyEditorText(text),
      setEditorText: (text) => this.applyEditorText(text),
      getEditorText: () => this.editorText,
      addAutocompleteProvider: () => this.reportUnsupported('addAutocompleteProvider'),
      setEditorComponent: (factory) => {
        if (factory !== undefined) this.reportUnsupported('setEditorComponent')
      },
      getEditorComponent: () => undefined,
      get theme() { return headlessTheme as never },
      getAllThemes: () => [{ name: headlessTheme.name, path: undefined }],
      getTheme: () => headlessTheme as never,
      setTheme: () => {
        this.reportUnsupported('setTheme')
        return {
          success: false,
          error: 'Theme switching not supported in PiPilot.',
        }
      },
      getToolsExpanded: () => false,
      setToolsExpanded: () => this.reportUnsupported('setToolsExpanded'),
    }
  }

  get pendingCount(): number {
    return this.pendingDialogs.size
  }

  /**
   * Settles a dialog by its request id. Late or unknown responses are ignored
   * (idempotent), which keeps a dismissed dialog from resurfacing or settling
   * a different request.
   */
  respond(response: LocalPiExtensionUiResponse): void {
    const pending = this.pendingDialogs.get(response.id)
    if (!pending || pending.resolved) return
    pending.resolved = true
    pending.cancelTimer()
    this.pendingDialogs.delete(response.id)
    if ('cancelled' in response && response.cancelled) {
      pending.resolve(pending.defaultValue as never)
      return
    }
    if ('confirmed' in response) {
      pending.resolve(response.confirmed as never)
      return
    }
    pending.resolve(
      ('value' in response ? response.value : undefined) as never,
    )
  }

  /**
   * Cancels every pending dialog with the official default value so each
   * extension call stays total. Called before Session replacement/disposal
   * and Host shutdown; callers receive the affected ids for idempotent
   * terminal notifications.
   */
  cancelAll(reason: 'replaced' = 'replaced'): string[] {
    const requestIds: string[] = []
    for (const [id, pending] of this.pendingDialogs) {
      if (pending.resolved) continue
      pending.resolved = true
      pending.cancelTimer()
      pending.resolve(pending.defaultValue as never)
      this.emitDismiss(id, reason)
      requestIds.push(id)
    }
    this.pendingDialogs.clear()
    void requestIds
    return requestIds
  }

  /** Clear portable extension state before an SDK resource reload. */
  reload(): void {
    this.cancelAll()
    for (const key of this.statusKeys) {
      this.emit({
        type: 'extension_ui_request',
        id: randomUUID(),
        method: 'setStatus',
        statusKey: key,
      })
    }
    this.statusKeys.clear()
    for (const key of this.widgetKeys) {
      this.emit({
        type: 'extension_ui_request',
        id: randomUUID(),
        method: 'setWidget',
        widgetKey: key,
      })
    }
    this.widgetKeys.clear()
    if (this.titleSet) {
      this.emit({
        type: 'extension_ui_request',
        id: randomUUID(),
        method: 'setTitle',
        title: '',
      })
      this.titleSet = false
    }
    if (this.workingMessageSet) {
      this.emit({
        type: 'extension_ui_request',
        id: randomUUID(),
        method: 'setWorkingMessage',
      })
      this.workingMessageSet = false
    }
    if (this.workingVisibleSet) {
      this.emit({
        type: 'extension_ui_request',
        id: randomUUID(),
        method: 'setWorkingVisible',
        visible: false,
      })
      this.workingVisibleSet = false
    }
    this.editorText = ''
    this.unsupportedMethods.clear()
  }

  private applyEditorText(text: string): void {
    this.editorText = text
    this.emit({
      type: 'extension_ui_request',
      id: randomUUID(),
      method: 'set_editor_text',
      text,
    })
  }

  private emit(request: LocalPiExtensionUiRequest): void {
    let projected: LocalPiExtensionUiRequest
    try {
      projected = localPiExtensionUiRequestSchema.parse(request)
    } catch (error) {
      // Real extension surfaces may be larger than the bounded DTO. Failing a
      // whole Host over one plugin surface would punish every conversation in
      // the project, so surface a typed fatal diagnostic and stop emitting.
      this.capacityReached = true
      this.onFatal?.(error)
      return
    }
    this.onRequest(projected)
  }

  private reportUnsupported(method: string): void {
    if (this.unsupportedMethods.has(method)) return
    this.unsupportedMethods.add(method)
    this.emit({
      type: 'extension_ui_request',
      id: randomUUID(),
      method: 'unsupported',
      unsupportedMethod: method,
    })
  }

  private openDialog<T>(
    request: {
      method: 'select' | 'confirm' | 'input' | 'editor'
      title: string
      options?: string[]
      message?: string
      placeholder?: string
      prefill?: string
      timeout?: number
    },
    defaultValue: T,
    options?: ExtensionUiDialogLikeOptions,
  ): Promise<T> {
    if (this.capacityReached) return Promise.resolve(defaultValue)
    if (this.pendingDialogs.size >= this.maxPendingDialogs) {
      this.onFatal?.(new Error(
        `Extension UI pending dialog limit of ${this.maxPendingDialogs} was reached.`,
      ))
      return Promise.resolve(defaultValue)
    }
    const signal = options?.signal
    if (signal?.aborted) return Promise.resolve(defaultValue)
    const pluginTimeout = options?.timeout
    const deadlineMs = pluginTimeout === undefined
      ? this.maxDeadlineMs
      : Math.min(pluginTimeout, this.maxDeadlineMs)
    const id = randomUUID()

    return new Promise<T>((resolve) => {
      const timer = setTimeout(
        () => this.settle(id, defaultValue, 'expired'),
        deadlineMs,
      )
      timer.unref?.()
      const onAbort = () => this.settle(id, defaultValue, 'aborted')
      signal?.addEventListener('abort', onAbort, { once: true })
      const pending: PendingDialog = {
        id,
        resolved: false,
        defaultValue,
        resolve,
        cancelTimer: () => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
        },
      }
      this.pendingDialogs.set(id, pending)
      this.emit({
        type: 'extension_ui_request',
        id,
        ...request,
      } as unknown as LocalPiExtensionUiRequest)
      if (!this.pendingDialogs.has(id)) return
      if (this.capacityReached) {
        // The projection failed before the request could leave the Host; the
        // extension call settles with its official default via the timer path.
        this.settle(id, defaultValue)
      }
    })
  }

  private settle<T>(
    id: string,
    value: T,
    reason?: 'expired' | 'aborted',
  ): void {
    const pending = this.pendingDialogs.get(id)
    if (!pending || pending.resolved) return
    pending.resolved = true
    pending.cancelTimer()
    this.pendingDialogs.delete(id)
    pending.resolve(value as never)
    if (reason) this.emitDismiss(id, reason)
  }

  private emitDismiss(
    id: string,
    reason: 'expired' | 'aborted' | 'replaced',
  ): void {
    this.emit({
      type: 'extension_ui_request',
      id,
      method: 'dismiss',
      reason,
    })
  }
}
