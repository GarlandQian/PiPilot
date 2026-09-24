import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import type { IPty, IPtyForkOptions, IWindowsPtyForkOptions } from 'node-pty'
import {
  TERMINAL_OUTPUT_EVENT_LIMIT,
  TERMINAL_REPLAY_LIMIT,
  terminalActionResultSchema,
  terminalEventSchema,
  terminalResizeResultSchema,
  terminalSessionSchema,
  terminalShellProfileIdSchema,
  terminalShellProfileSchema,
  terminalSummarySchema,
  terminalTitleSchema,
  type TerminalEvent,
  type TerminalSession,
  type TerminalShellProfile,
  type TerminalShellProfileId,
  type TerminalSummary,
} from '../../shared/terminal'
import {
  conversationScopeSchema,
  type ConversationScope,
} from '../../shared/conversation-scope'
import { conversationScopeKey } from '../conversations/conversation-scope-resolver'
import { PIPILOT_VERSION } from '../../shared/build-info'
import type { TerminalSettings } from '../../shared/settings'
import {
  mergeTerminalEnvironment,
  TerminalProfileDiscovery,
  wslWorkingDirectory,
  type ResolvedShellProfile,
  type ShellLaunch,
  type TerminalDiscoveryOptions,
} from './terminal-profile-discovery'

const OUTPUT_FLUSH_INTERVAL_MS = 16
const OUTPUT_PAUSE_THRESHOLD = 256 * 1024
const OUTPUT_RESUME_THRESHOLD = 64 * 1024
const OUTPUT_PENDING_LIMIT = TERMINAL_REPLAY_LIMIT
const TERMINATION_GRACE_MS = 1_500

export interface TerminalResolvedScope {
  scope: ConversationScope
  cwd: string
}

interface TerminalLaunchSnapshot {
  file: string
  args: string[]
  label: string
  environment: NodeJS.ProcessEnv
  distribution?: string
  validateExecutable: boolean
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
  launch: TerminalLaunchSnapshot
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

export interface TerminalServiceOptions extends TerminalDiscoveryOptions {
  getTerminalSettings?: () => TerminalSettings
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
  private readonly discovery: TerminalProfileDiscovery

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
    this.discovery = new TerminalProfileDiscovery(options)
  }

  subscribe(listener: TerminalListener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  hasActiveTerminals() {
    return [...this.records.values()].some((record) => record.status === 'running')
  }

  async listShellProfiles(): Promise<TerminalShellProfile[]> {
    return (await this.resolveShellProfiles()).map(({ launch: _launch, ...profile }) =>
      terminalShellProfileSchema.parse(profile))
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
    await this.terminateRecord(record)
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
    shellProfileId?: TerminalShellProfileId,
  ): Promise<TerminalSession> {
    const scope = conversationScopeSchema.parse(rawScope)
    const profileId = terminalShellProfileIdSchema.optional().parse(shellProfileId)
    return this.queueCreation(scope, () => this.createTerminal(scope, cols, rows, profileId))
  }

  async restart(rawScope: ConversationScope, terminalId: string, cols: number, rows: number): Promise<TerminalSession> {
    const scope = conversationScopeSchema.parse(rawScope)
    return this.queueCreation(scope, async () => {
      const previous = await this.activeRecord(scope, terminalId)
      if (previous.status !== 'exited') {
        throw new TerminalServiceError('TERMINAL_STILL_RUNNING', 'Only an exited terminal can be restarted.')
      }
      const session = await this.createTerminal(scope, cols, rows, undefined, previous)
      this.records.delete(previous.terminalId)
      return session
    })
  }

  private async queueCreation(scope: ConversationScope, create: () => Promise<TerminalSession>) {
    if (this.disposing) {
      throw new TerminalServiceError(
        'TERMINAL_UNAVAILABLE',
        'The terminal runtime is unavailable.',
      )
    }
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
    const operation = create()
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
    shellProfileId?: TerminalShellProfileId,
    previous?: TerminalRecord,
  ): Promise<TerminalSession> {
    const context = await this.context(scope)
    const key = conversationScopeKey(scope)
    const launch = previous ? await this.restartLaunch(previous.launch) : await this.launchSnapshot(shellProfileId, context.cwd)
    const spawnPty = await this.loadSpawnPty()
    await this.assertActiveScope(scope, context.root)
    const { title, ordinal } = previous
      ? { title: previous.title, ordinal: this.scopeOrdinals.get(key) ?? 0 }
      : this.nextTitle(key, launch.label)

    let processHandle: TerminalProcess
    try {
      processHandle = spawnPty(launch.file, [...launch.args], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: context.cwd,
        env: { ...launch.environment },
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
      shell: launch.label,
      title,
      status: 'running',
      cols,
      rows,
      process: processHandle,
      launch,
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

  private async resolveShell(profileId?: TerminalShellProfileId): Promise<ShellLaunch> {
    const settings = this.options.getTerminalSettings?.()
    const selectedId = profileId ?? settings?.defaultProfileId
    if (selectedId) {
      const custom = selectedId.startsWith('custom:')
      const configured = custom ? settings?.profiles.find((entry) => entry.id === selectedId) : undefined
      const profile = custom
        ? configured && await this.discovery.resolveCustom(configured)
        : (await this.resolveShellProfiles()).find((entry) => entry.id === selectedId)
      if (profile?.available && profile.launch) return profile.launch
      throw new TerminalServiceError(
        'TERMINAL_SHELL_UNAVAILABLE',
        'The selected shell is no longer installed or executable. Choose another shell.',
      )
    }
    return this.resolveDefaultShell()
  }

  private async resolveShellProfiles(): Promise<ResolvedShellProfile[]> {
    const settings = this.options.getTerminalSettings?.()
    const profiles = await this.discovery.discover(settings?.profiles ?? [])
    if (settings?.defaultProfileId) {
      const selected = profiles.find((profile) => profile.id === settings.defaultProfileId)
      if (selected) selected.isDefault = true
      else profiles.unshift({
        id: settings.defaultProfileId, label: 'Unavailable shell', isDefault: true,
        source: settings.defaultProfileId.startsWith('wsl:') ? 'wsl' : settings.defaultProfileId.startsWith('custom:') ? 'custom' : 'detected',
        executable: '', args: [], available: false,
        unavailableReason: settings.defaultProfileId.startsWith('wsl:') ? 'distribution-unavailable' : 'executable-not-found',
      })
    } else {
      const defaultShell = await this.resolveDefaultShell().catch(() => undefined)
      const selected = defaultShell && profiles.find((profile) => profile.source === 'detected' && (this.platform === 'win32'
        ? profile.launch?.file.toLowerCase() === defaultShell.file.toLowerCase()
        : profile.launch?.file === defaultShell.file))
      if (selected) selected.isDefault = true
    }
    return profiles.sort((left, right) => Number(right.isDefault) - Number(left.isDefault))
  }

  private async resolveDefaultShell(): Promise<ShellLaunch> {
    if (this.options.resolveShell) return this.options.resolveShell()
    const shell = await this.discovery.automatic()
    if (shell) return shell
    throw new TerminalServiceError(
      'TERMINAL_SHELL_UNAVAILABLE',
      'No supported default shell is available.',
    )
  }

  private async launchSnapshot(profileId: TerminalShellProfileId | undefined, cwd: string): Promise<TerminalLaunchSnapshot> {
    const shell = await this.resolveShell(profileId)
    const args = [...shell.args]
    if (shell.distribution) {
      const linuxCwd = wslWorkingDirectory(cwd, shell.distribution)
      if (!linuxCwd) throw new TerminalServiceError('TERMINAL_CWD_UNAVAILABLE', 'This directory cannot be opened in the selected WSL distribution.')
      args.push('--cd', linuxCwd)
    }
    return {
      file: shell.file, args, label: shell.label,
      environment: this.buildEnvironment(cwd, shell.env),
      ...(shell.distribution ? { distribution: shell.distribution } : {}),
      validateExecutable: !(this.options.resolveShell && profileId === undefined && !this.options.getTerminalSettings?.().defaultProfileId),
    }
  }

  private async restartLaunch(launch: TerminalLaunchSnapshot): Promise<TerminalLaunchSnapshot> {
    if (launch.validateExecutable && !await this.discovery.executable(launch.file)) {
      throw new TerminalServiceError('TERMINAL_SHELL_UNAVAILABLE', 'The original shell is no longer installed or executable.')
    }
    if (launch.distribution && !(await this.discovery.discover()).some((profile) => profile.launch?.distribution?.toLowerCase() === launch.distribution?.toLowerCase() && profile.launch?.file.toLowerCase() === launch.file.toLowerCase())) {
      throw new TerminalServiceError('TERMINAL_SHELL_UNAVAILABLE', 'The original WSL distribution is no longer installed.')
    }
    return { ...launch, args: [...launch.args], environment: { ...launch.environment } }
  }

  private buildEnvironment(cwd: string, overrides: Record<string, string | null> = {}) {
    return mergeTerminalEnvironment(mergeTerminalEnvironment(this.environment, overrides, this.platform), {
      PWD: cwd,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      TERM_PROGRAM: 'PiPilot',
      TERM_PROGRAM_VERSION: PIPILOT_VERSION,
    }, this.platform)
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
