import { randomUUID } from 'node:crypto'
import { access, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import {
  basename,
  isAbsolute,
  win32,
} from 'node:path'
import type { IPty, IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty'
import {
  TERMINAL_OUTPUT_EVENT_LIMIT,
  TERMINAL_REPLAY_LIMIT,
  terminalActionResultSchema,
  terminalEventSchema,
  terminalResizeResultSchema,
  terminalSessionSchema,
  terminalSummarySchema,
  terminalTitleSchema,
  type TerminalEvent,
  type TerminalSession,
  type TerminalSummary,
} from '../../shared/terminal'
import {
  conversationScopeSchema,
  type ConversationScope,
} from '../../shared/conversation-scope'
import { conversationScopeKey } from '../conversations/conversation-scope-resolver'
import { PIPILOT_VERSION } from '../../shared/build-info'

const OUTPUT_FLUSH_INTERVAL_MS = 16
const OUTPUT_PAUSE_THRESHOLD = 256 * 1024
const OUTPUT_RESUME_THRESHOLD = 64 * 1024
const OUTPUT_PENDING_LIMIT = TERMINAL_REPLAY_LIMIT
const TERMINATION_GRACE_MS = 1_500

export interface TerminalResolvedScope {
  scope: ConversationScope
  cwd: string
}

interface ShellLaunch {
  file: string
  args: string[]
  label: string
}

interface TerminalProcess {
  readonly pid: number
  readonly cols: number
  readonly rows: number
  onData(listener: (data: string) => void): { dispose(): void }
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): {
    dispose(): void
  }
  write(data: string | Buffer): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  pause(): void
  resume(): void
}

type SpawnPty = (
  file: string,
  args: string[],
  options: IPtyForkOptions | IWindowsPtyForkOptions,
) => TerminalProcess

interface TerminalRecord {
  scope: ConversationScope
  scopeKey: string
  terminalId: string
  root: string
  cwd: string
  shell: string
  title: string
  status: 'running' | 'exited'
  exitCode?: number
  signal?: number
  cols: number
  rows: number
  process: TerminalProcess
  sequence: number
  replay: string
  pendingOutput: string
  pendingTruncated: boolean
  paused: boolean
  closing: boolean
  flushTimer?: NodeJS.Timeout
  dataDisposable: { dispose(): void }
  exitDisposable: { dispose(): void }
  exitPromise: Promise<void>
  resolveExit(): void
}

export interface TerminalServiceOptions {
  environment?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  resolveShell?: () => Promise<ShellLaunch> | ShellLaunch
  spawnPty?: SpawnPty
}

type TerminalListener = (event: TerminalEvent) => void

export class TerminalServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'TerminalServiceError'
  }
}

function safeChunkEnd(value: string, maximum: number) {
  if (value.length <= maximum) return value.length
  const last = value.charCodeAt(maximum - 1)
  return last >= 0xd800 && last <= 0xdbff ? maximum - 1 : maximum
}

function boundedTail(value: string, maximum: number) {
  if (value.length <= maximum) return value
  let start = value.length - maximum
  const first = value.charCodeAt(start)
  if (first >= 0xdc00 && first <= 0xdfff) start += 1
  return value.slice(start)
}

function wait(milliseconds: number) {
  return new Promise<void>((resolveWait) => {
    setTimeout(resolveWait, milliseconds)
  })
}

export class TerminalService {
  private readonly environment: NodeJS.ProcessEnv
  private readonly listeners = new Set<TerminalListener>()
  private readonly pendingCreates = new Map<string, Promise<TerminalSession>>()
  private readonly platform: NodeJS.Platform
  private readonly records = new Map<string, TerminalRecord>()
  private readonly scopeOrdinals = new Map<string, number>()
  private readonly disposingScopes = new Set<string>()
  private readonly scopeVersions = new Map<string, number>()
  private disposing = false
  private spawnPty?: SpawnPty

  constructor(
    private readonly getActiveScope: () => ConversationScope,
    private readonly resolveScope: (
      scope: ConversationScope,
    ) => Promise<TerminalResolvedScope>,
    private readonly options: TerminalServiceOptions = {},
  ) {
    this.environment = options.environment ?? process.env
    this.platform = options.platform ?? process.platform
    this.spawnPty = options.spawnPty
  }

  subscribe(listener: TerminalListener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  hasActiveTerminals() {
    return [...this.records.values()].some((record) => record.status === 'running')
  }

  async list(rawScope: ConversationScope): Promise<TerminalSummary[]> {
    const scope = conversationScopeSchema.parse(rawScope)
    const context = await this.context(scope)
    const key = conversationScopeKey(scope)
    return [...this.records.values()]
      .filter((record) => record.scopeKey === key && record.root === context.root)
      .map((record) => this.summary(record))
  }

  async attach(scope: ConversationScope, terminalId: string, cols: number, rows: number) {
    const record = await this.activeRecord(scope, terminalId)
    if (record.status === 'running' && !record.closing) this.resizeRecord(record, cols, rows)
    this.flushAll(record)
    return this.session(record, true)
  }

  async rename(scope: ConversationScope, terminalId: string, title: string) {
    const record = await this.activeRecord(scope, terminalId)
    record.title = terminalTitleSchema.parse(title)
    return this.summary(record)
  }

  async close(scope: ConversationScope, terminalId: string) {
    const record = await this.activeRecord(scope, terminalId)
    if (record.status !== 'exited') {
      throw new TerminalServiceError(
        'TERMINAL_STILL_RUNNING',
        'Stop the terminal process before closing its tab.',
      )
    }
    this.records.delete(terminalId)
    return terminalActionResultSchema.parse({ scope, terminalId })
  }

  async clear(scope: ConversationScope, terminalId: string) {
    const record = await this.activeRecord(scope, terminalId)
    this.flushAll(record)
    record.replay = ''
    return terminalActionResultSchema.parse({ scope, terminalId })
  }

  async create(
    rawScope: ConversationScope,
    cols: number,
    rows: number,
  ): Promise<TerminalSession> {
    if (this.disposing) {
      throw new TerminalServiceError(
        'TERMINAL_UNAVAILABLE',
        'The terminal runtime is unavailable.',
      )
    }
    const scope = conversationScopeSchema.parse(rawScope)
    const key = conversationScopeKey(scope)
    const version = this.scopeVersions.get(key)
    let pending = this.pendingCreates.get(key)
    while (pending) {
      await pending.catch(() => undefined)
      pending = this.pendingCreates.get(key)
    }
    if (this.disposing || this.disposingScopes.has(key) || this.scopeVersions.get(key) !== version) {
      throw new TerminalServiceError(
        'TERMINAL_UNAVAILABLE',
        'The terminal runtime is unavailable.',
      )
    }
    const operation = this.createTerminal(scope, cols, rows)
    this.pendingCreates.set(key, operation)
    try {
      return await operation
    } finally {
      if (this.pendingCreates.get(key) === operation) {
        this.pendingCreates.delete(key)
      }
    }
  }

  private async createTerminal(
    scope: ConversationScope,
    cols: number,
    rows: number,
  ): Promise<TerminalSession> {
    const context = await this.context(scope)
    const key = conversationScopeKey(scope)
    const shell = await this.resolveShell()
    const spawnPty = await this.loadSpawnPty()
    await this.assertActiveScope(scope, context.root)
    const { title, ordinal } = this.nextTitle(key, shell.label)

    let processHandle: TerminalProcess
    try {
      processHandle = spawnPty(shell.file, shell.args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: context.cwd,
        env: this.buildEnvironment(context.cwd),
        encoding: 'utf8',
      })
    } catch {
      throw new TerminalServiceError(
        'TERMINAL_START_FAILED',
        'The terminal process could not be started.',
      )
    }

    const terminalId = randomUUID()
    let resolveExit: () => void = () => undefined
    const exitPromise = new Promise<void>((resolvePromise) => {
      resolveExit = resolvePromise
    })
    const record: TerminalRecord = {
      scope,
      scopeKey: key,
      terminalId,
      root: context.root,
      cwd: context.cwd,
      shell: shell.label,
      title,
      status: 'running',
      cols,
      rows,
      process: processHandle,
      sequence: 0,
      replay: '',
      pendingOutput: '',
      pendingTruncated: false,
      paused: false,
      closing: false,
      dataDisposable: { dispose() {} },
      exitDisposable: { dispose() {} },
      exitPromise,
      resolveExit,
    }

    this.records.set(terminalId, record)
    record.dataDisposable = processHandle.onData((data) => {
      this.enqueueOutput(record, data)
    })
    record.exitDisposable = processHandle.onExit((event) => {
      this.finalizeExit(record, event.exitCode, event.signal)
    })
    // Some adapters report an already-exited process while registering onExit.
    if (record.status === 'exited') {
      record.dataDisposable.dispose()
      record.exitDisposable.dispose()
    }

    await this.assertActiveScope(scope, context.root).catch(async (error) => {
      await this.terminateRecord(record)
      this.records.delete(terminalId)
      throw error
    })
    this.flushAll(record)
    const session = this.session(record, false)
    this.scopeOrdinals.set(key, ordinal)
    return session
  }

  async input(scope: ConversationScope, terminalId: string, data: string) {
    const record = await this.activeRecord(scope, terminalId, true)
    try {
      record.process.write(data)
    } catch {
      throw new TerminalServiceError(
        'TERMINAL_WRITE_FAILED',
        'The terminal input could not be delivered.',
      )
    }
    return terminalActionResultSchema.parse({ scope, terminalId })
  }

  async resize(
    scope: ConversationScope,
    terminalId: string,
    cols: number,
    rows: number,
  ) {
    const record = await this.activeRecord(scope, terminalId, true)
    this.resizeRecord(record, cols, rows)
    return terminalResizeResultSchema.parse({ scope, terminalId, cols, rows })
  }

  async kill(scope: ConversationScope, terminalId: string) {
    const record = await this.activeRecord(scope, terminalId)
    await this.terminateRecord(record)
    return terminalActionResultSchema.parse({ scope, terminalId })
  }

  async disposeScope(rawScope: ConversationScope) {
    const scope = conversationScopeSchema.parse(rawScope)
    const key = conversationScopeKey(scope)
    this.scopeVersions.set(key, (this.scopeVersions.get(key) ?? 0) + 1)
    this.disposingScopes.add(key)
    try {
      await this.pendingCreates.get(key)?.catch(() => undefined)
      const records = [...this.records.values()].filter(
        (record) => record.scopeKey === key,
      )
      await Promise.allSettled(records.map((record) => this.terminateRecord(record)))
      for (const record of records) this.records.delete(record.terminalId)
      this.scopeOrdinals.delete(key)
    } finally {
      this.disposingScopes.delete(key)
    }
  }

  async dispose() {
    this.disposing = true
    await Promise.allSettled([...this.pendingCreates.values()])
    const records = [...this.records.values()]
    await Promise.allSettled(records.map((record) => this.terminateRecord(record)))
    this.records.clear()
    this.scopeOrdinals.clear()
    this.disposingScopes.clear()
    this.scopeVersions.clear()
    this.listeners.clear()
  }

  private async loadSpawnPty() {
    if (this.spawnPty) return this.spawnPty
    try {
      const nodePty = await import('node-pty')
      this.spawnPty = nodePty.spawn as (
        file: string,
        args: string[],
        options: IPtyForkOptions | IWindowsPtyForkOptions,
      ) => IPty
      return this.spawnPty
    } catch {
      throw new TerminalServiceError(
        'TERMINAL_UNAVAILABLE',
        'The terminal runtime is unavailable.',
      )
    }
  }

  private async resolveShell(): Promise<ShellLaunch> {
    if (this.options.resolveShell) return this.options.resolveShell()
    if (this.platform === 'win32') {
      const configured = this.environment.ComSpec ?? this.environment.COMSPEC
      const file = configured && configured.length <= 4_096
        ? configured
        : 'powershell.exe'
      return {
        file,
        args: [],
        label: win32.basename(file).slice(0, 128),
      }
    }

    const configured = this.environment.SHELL
    const candidates = [
      configured && isAbsolute(configured) ? configured : undefined,
      this.platform === 'darwin' ? '/bin/zsh' : '/bin/bash',
      '/bin/sh',
    ].filter((candidate): candidate is string => Boolean(candidate))
    for (const candidate of [...new Set(candidates)]) {
      try {
        const canonical = await realpath(candidate)
        const details = await stat(canonical)
        await access(canonical, constants.X_OK)
        if (details.isFile()) {
          return {
            file: canonical,
            args: ['-l'],
            label: basename(canonical).slice(0, 128),
          }
        }
      } catch {
        // Try the next platform shell candidate.
      }
    }
    throw new TerminalServiceError(
      'TERMINAL_SHELL_UNAVAILABLE',
      'No supported default shell is available.',
    )
  }

  private buildEnvironment(cwd: string) {
    const environment = { ...this.environment }
    environment.PWD = cwd
    environment.TERM = 'xterm-256color'
    environment.COLORTERM = 'truecolor'
    environment.TERM_PROGRAM = 'PiPilot'
    environment.TERM_PROGRAM_VERSION = PIPILOT_VERSION
    return environment
  }

  private async context(scope: ConversationScope) {
    if (conversationScopeKey(this.getActiveScope()) !== conversationScopeKey(scope)) {
      throw new TerminalServiceError(
        'TERMINAL_STALE_SCOPE',
        'The terminal request belongs to a stale conversation.',
      )
    }

    let root: string
    try {
      const resolvedScope = await this.resolveScope(scope)
      root = await realpath(resolvedScope.cwd)
    } catch {
      throw new TerminalServiceError(
        'TERMINAL_CWD_UNAVAILABLE',
        'The terminal working directory is unavailable.',
      )
    }
    const details = await stat(root).catch(() => undefined)
    if (!details?.isDirectory()) {
      throw new TerminalServiceError(
        'TERMINAL_CWD_NOT_DIRECTORY',
        'The terminal working directory is not a directory.',
      )
    }
    await this.assertActiveScope(scope, root)
    return { root, cwd: root }
  }

  private async assertActiveScope(scope: ConversationScope, root?: string) {
    if (this.disposing || this.disposingScopes.has(conversationScopeKey(scope))) {
      throw new TerminalServiceError('TERMINAL_UNAVAILABLE', 'The terminal runtime is unavailable.')
    }
    const activeScope = conversationScopeSchema.parse(this.getActiveScope())
    if (conversationScopeKey(activeScope) !== conversationScopeKey(scope)) {
      throw new TerminalServiceError(
        'TERMINAL_STALE_SCOPE',
        'The terminal request belongs to a stale conversation.',
      )
    }
    if (root) {
      const resolvedScope = await this.resolveScope(activeScope).catch(() => undefined)
      const activeRoot = resolvedScope
        ? await realpath(resolvedScope.cwd).catch(() => undefined)
        : undefined
      if (!activeRoot || activeRoot !== root) {
        throw new TerminalServiceError(
          'TERMINAL_STALE_SCOPE',
          'The terminal request belongs to a stale conversation.',
        )
      }
      // Resolving a path yields; selection and ownership may change meanwhile.
      await this.assertActiveScope(scope)
    }
  }

  private async activeRecord(scope: ConversationScope, terminalId: string, requireRunning = false) {
    const parsedScope = conversationScopeSchema.parse(scope)
    await this.assertActiveScope(parsedScope)
    const record = this.records.get(terminalId)
    if (
      !record ||
      record.scopeKey !== conversationScopeKey(parsedScope)
    ) {
      throw new TerminalServiceError(
        'TERMINAL_NOT_FOUND',
        'The requested terminal is no longer available.',
      )
    }
    await this.assertActiveScope(parsedScope, record.root)
    if (this.records.get(terminalId) !== record) {
      throw new TerminalServiceError('TERMINAL_NOT_FOUND', 'The requested terminal is no longer available.')
    }
    if (requireRunning && (record.status !== 'running' || record.closing)) {
      throw new TerminalServiceError('TERMINAL_EXITED', 'The terminal process has exited.')
    }
    return record
  }

  private summary(record: TerminalRecord): TerminalSummary {
    return terminalSummarySchema.parse({
      scope: record.scope,
      terminalId: record.terminalId,
      title: record.title,
      shell: record.shell,
      cols: record.cols,
      rows: record.rows,
      status: record.status,
      ...(record.exitCode === undefined ? {} : { exitCode: record.exitCode }),
      ...(record.signal === undefined ? {} : { signal: record.signal }),
    })
  }

  private nextTitle(scopeKey: string, shell: string) {
    const titles = new Set([...this.records.values()]
      .filter((record) => record.scopeKey === scopeKey)
      .map((record) => record.title))
    let ordinal = this.scopeOrdinals.get(scopeKey) ?? 0
    let title: string
    do {
      ordinal += 1
      const suffix = ` ${ordinal}`
      title = `${(shell.trim() || 'Terminal').slice(0, 128 - suffix.length)}${suffix}`
    } while (titles.has(title))
    return { title, ordinal }
  }

  private session(record: TerminalRecord, reused: boolean): TerminalSession {
    return terminalSessionSchema.parse({
      ...this.summary(record),
      replay: record.replay,
      sequence: record.sequence,
      reused,
    })
  }

  private resizeRecord(record: TerminalRecord, cols: number, rows: number) {
    if (record.cols === cols && record.rows === rows) return
    try {
      record.process.resize(cols, rows)
      record.cols = cols
      record.rows = rows
    } catch {
      throw new TerminalServiceError(
        'TERMINAL_RESIZE_FAILED',
        'The terminal could not be resized.',
      )
    }
  }

  private enqueueOutput(record: TerminalRecord, data: string) {
    if (!data || record.status !== 'running' || this.records.get(record.terminalId) !== record) return
    record.pendingOutput += data
    if (record.pendingOutput.length > OUTPUT_PENDING_LIMIT) {
      record.pendingOutput = boundedTail(record.pendingOutput, OUTPUT_PENDING_LIMIT)
      record.pendingTruncated = true
    }
    if (!record.paused && record.pendingOutput.length >= OUTPUT_PAUSE_THRESHOLD) {
      try {
        record.process.pause()
        record.paused = true
      } catch {
        // Bounded dropping remains the fallback when native pause is unavailable.
      }
    }
    this.scheduleFlush(record)
  }

  private scheduleFlush(record: TerminalRecord) {
    if (record.flushTimer || record.pendingOutput.length === 0) return
    record.flushTimer = setTimeout(() => {
      record.flushTimer = undefined
      this.flushOne(record)
    }, OUTPUT_FLUSH_INTERVAL_MS)
  }

  private flushOne(record: TerminalRecord) {
    if (record.pendingOutput.length === 0) return
    const end = safeChunkEnd(record.pendingOutput, TERMINAL_OUTPUT_EVENT_LIMIT)
    const data = record.pendingOutput.slice(0, end)
    record.pendingOutput = record.pendingOutput.slice(end)
    const truncated = record.pendingTruncated
    record.pendingTruncated = false
    this.emitData(record, data, truncated)

    if (record.paused && record.pendingOutput.length <= OUTPUT_RESUME_THRESHOLD) {
      try {
        record.process.resume()
        record.paused = false
      } catch {
        // The process is already exiting or does not support resume.
      }
    }
    this.scheduleFlush(record)
  }

  private flushAll(record: TerminalRecord) {
    if (record.flushTimer) {
      clearTimeout(record.flushTimer)
      record.flushTimer = undefined
    }
    while (record.pendingOutput.length > 0) this.flushOne(record)
    if (record.flushTimer) {
      clearTimeout(record.flushTimer)
      record.flushTimer = undefined
    }
  }

  private emitData(record: TerminalRecord, data: string, truncated: boolean) {
    if (!data) return
    // Hidden terminal surfaces retain their ANSI state while projects change.
    record.replay = boundedTail(record.replay + data, TERMINAL_REPLAY_LIMIT)
    record.sequence += 1
    this.emit(terminalEventSchema.parse({
      type: 'data',
      eventId: randomUUID(),
      scope: record.scope,
      terminalId: record.terminalId,
      sequence: record.sequence,
      stream: 'pty',
      data,
      truncated,
    }))
  }

  private finalizeExit(record: TerminalRecord, exitCode: number, signal?: number) {
    if (record.status === 'exited' || this.records.get(record.terminalId) !== record) return
    this.flushAll(record)
    record.status = 'exited'
    record.exitCode = Number.isInteger(exitCode) ? Math.min(2 ** 31 - 1, Math.max(-1, exitCode)) : -1
    record.signal = Number.isInteger(signal) && signal! >= 0 && signal! <= 255 ? signal : undefined
    record.dataDisposable.dispose()
    record.exitDisposable.dispose()
    record.resolveExit()
    record.sequence += 1
    this.emit(terminalEventSchema.parse({
      type: 'exit',
      eventId: randomUUID(),
      scope: record.scope,
      terminalId: record.terminalId,
      sequence: record.sequence,
      exitCode: record.exitCode,
      ...(record.signal === undefined ? {} : { signal: record.signal }),
    }))
  }

  private async terminateRecord(record: TerminalRecord) {
    if (record.status === 'exited' || this.records.get(record.terminalId) !== record) return
    if (!record.closing) {
      record.closing = true
      try {
        record.process.kill()
      } catch {
        // Escalate below after the normal close grace period.
      }
    }
    let exited = false
    await Promise.race([
      record.exitPromise.then(() => {
        exited = true
      }),
      wait(TERMINATION_GRACE_MS),
    ])
    if (exited || this.records.get(record.terminalId) !== record) return

    try {
      if (this.platform === 'win32') record.process.kill()
      else record.process.kill('SIGKILL')
    } catch {
      if (this.platform !== 'win32') {
        try {
          process.kill(-record.process.pid, 'SIGKILL')
        } catch {
          try {
            process.kill(record.process.pid, 'SIGKILL')
          } catch {
            // Finalize ownership even when the OS already reaped the process.
          }
        }
      }
    }
    await Promise.race([record.exitPromise, wait(250)])
    if (this.records.get(record.terminalId) === record) {
      this.finalizeExit(record, -1)
    }
  }

  private emit(event: TerminalEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // One renderer subscriber cannot interrupt terminal ownership.
      }
    }
  }
}
