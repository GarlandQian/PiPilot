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
  TERMINAL_MAX_COUNT,
  TERMINAL_OUTPUT_EVENT_LIMIT,
  TERMINAL_REPLAY_LIMIT,
  terminalActionResultSchema,
  terminalEventSchema,
  terminalResizeResultSchema,
  terminalSessionSchema,
  type TerminalEvent,
  type TerminalSession,
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
  maxTerminals?: number
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
  private readonly maxTerminals: number
  private readonly pendingCreates = new Map<string, Promise<TerminalSession>>()
  private readonly platform: NodeJS.Platform
  private readonly records = new Map<string, TerminalRecord>()
  private readonly scopeTerminals = new Map<string, string>()
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
    this.maxTerminals = Math.max(
      1,
      Math.min(TERMINAL_MAX_COUNT, options.maxTerminals ?? TERMINAL_MAX_COUNT),
    )
    this.platform = options.platform ?? process.platform
    this.spawnPty = options.spawnPty
  }

  subscribe(listener: TerminalListener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  hasActiveTerminals() {
    return this.records.size > 0
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
    let pending = this.pendingCreates.get(key)
    while (pending) {
      await pending.catch(() => undefined)
      pending = this.pendingCreates.get(key)
    }
    if (this.disposing) {
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
    const existingId = this.scopeTerminals.get(key)
    const existing = existingId ? this.records.get(existingId) : undefined
    if (existing) {
      await this.assertActiveScope(scope, context.root)
      this.resizeRecord(existing, cols, rows)
      this.flushAll(existing)
      return terminalSessionSchema.parse({
        scope,
        terminalId: existing.terminalId,
        shell: existing.shell,
        cols: existing.cols,
        rows: existing.rows,
        replay: existing.replay,
        sequence: existing.sequence,
        reused: true,
      })
    }
    if (this.records.size >= this.maxTerminals) {
      throw new TerminalServiceError(
        'TERMINAL_LIMIT_REACHED',
        'The maximum number of terminals is already running.',
      )
    }

    const shell = await this.resolveShell()
    const spawnPty = await this.loadSpawnPty()
    await this.assertActiveScope(scope, context.root)

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
    const record = {
      scope,
      scopeKey: key,
      terminalId,
      root: context.root,
      cwd: context.cwd,
      shell: shell.label,
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
    } satisfies TerminalRecord

    this.records.set(terminalId, record)
    this.scopeTerminals.set(key, terminalId)
    record.dataDisposable = processHandle.onData((data) => {
      this.enqueueOutput(record, data)
    })
    record.exitDisposable = processHandle.onExit((event) => {
      this.finalizeExit(record, event.exitCode, event.signal)
    })

    await this.assertActiveScope(scope, context.root).catch(async (error) => {
      await this.terminateRecord(record)
      throw error
    })
    this.flushAll(record)
    return terminalSessionSchema.parse({
      scope,
      terminalId,
      shell: shell.label,
      cols,
      rows,
      replay: record.replay,
      sequence: record.sequence,
      reused: false,
    })
  }

  async input(scope: ConversationScope, terminalId: string, data: string) {
    const record = await this.activeRecord(scope, terminalId)
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
    const record = await this.activeRecord(scope, terminalId)
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
    await this.pendingCreates.get(key)?.catch(() => undefined)
    const records = [...this.records.values()].filter(
      (record) => record.scopeKey === key,
    )
    await Promise.allSettled(records.map((record) => this.terminateRecord(record)))
  }

  async dispose() {
    this.disposing = true
    await Promise.allSettled([...this.pendingCreates.values()])
    const records = [...this.records.values()]
    await Promise.allSettled(records.map((record) => this.terminateRecord(record)))
    this.records.clear()
    this.scopeTerminals.clear()
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
    }
  }

  private async activeRecord(scope: ConversationScope, terminalId: string) {
    const parsedScope = conversationScopeSchema.parse(scope)
    await this.assertActiveScope(parsedScope)
    const record = this.records.get(terminalId)
    if (
      !record ||
      record.scopeKey !== conversationScopeKey(parsedScope) ||
      record.closing
    ) {
      throw new TerminalServiceError(
        'TERMINAL_NOT_FOUND',
        'The requested terminal is no longer running.',
      )
    }
    await this.assertActiveScope(parsedScope, record.root)
    return record
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
    if (!data || this.records.get(record.terminalId) !== record) return
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
    if (
      conversationScopeKey(this.getActiveScope()) !== record.scopeKey
    ) return
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
    if (this.records.get(record.terminalId) !== record) return
    this.flushAll(record)
    this.records.delete(record.terminalId)
    if (this.scopeTerminals.get(record.scopeKey) === record.terminalId) {
      this.scopeTerminals.delete(record.scopeKey)
    }
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
      exitCode: Number.isInteger(exitCode) ? Math.max(-1, exitCode) : -1,
      ...(typeof signal === 'number' ? { signal } : {}),
    }))
  }

  private async terminateRecord(record: TerminalRecord) {
    if (this.records.get(record.terminalId) !== record) return
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
