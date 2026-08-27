import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { isAbsolute, resolve } from 'node:path'
import {
  piManagementHelperCommandSchema,
  piManagementHelperEventSchema,
  type PiManagementHelperCommand,
  type PiManagementSnapshotPayload,
  type PiManagementProgress,
} from '../../shared/pi-integrations'

const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_MUTATION_TIMEOUT_MS = 10 * 60_000
const DEFAULT_KILL_GRACE_MS = 500
const DEFAULT_RECORD_BYTES = 2 * 1_024 * 1_024
const DEFAULT_OUTPUT_BYTES = 8 * 1_024 * 1_024
const DEFAULT_INPUT_BYTES = 4 * 1_024 * 1_024
const DEFAULT_STDERR_BYTES = 16 * 1_024
const DEFAULT_RECORD_COUNT = 2_000

type SpawnProcess = typeof spawn

export type LocalPiManagementHostErrorCode =
  | 'PI_MANAGEMENT_HELPER_INVALID'
  | 'PI_MANAGEMENT_HELPER_PROTOCOL_ERROR'
  | 'PI_MANAGEMENT_HELPER_SPAWN_FAILED'
  | 'PI_MANAGEMENT_HELPER_TIMEOUT'
  | 'PI_MANAGEMENT_HELPER_EXITED'
  | 'PI_MANAGEMENT_OPERATION_FAILED'

export class LocalPiManagementHostError extends Error {
  constructor(
    readonly code: LocalPiManagementHostErrorCode | string,
    message: string,
    readonly recoverable = true,
  ) {
    super(message)
    this.name = 'LocalPiManagementHostError'
  }
}

export interface LocalPiManagementHostOptions {
  helperEntryPath: string
  electronExecutablePath?: string
  environment?: NodeJS.ProcessEnv
  spawnProcess?: SpawnProcess
  timeoutMs?: number
  mutationTimeoutMs?: number
  killGraceMs?: number
  maxRecordBytes?: number
  maxOutputBytes?: number
  maxStderrBytes?: number
  maxRecordCount?: number
}

function appendTail(current: Buffer, chunk: Buffer, limit: number) {
  const combined = Buffer.concat([current, chunk])
  return combined.length <= limit
    ? combined
    : combined.subarray(combined.length - limit)
}

function mutation(command: PiManagementHelperCommand) {
  return ['install', 'update', 'remove', 'set-retry', 'set-default-model'].includes(command.action)
}

export class LocalPiManagementHost {
  private readonly helperEntryPath: string
  private readonly electronExecutablePath: string
  private readonly environment: NodeJS.ProcessEnv
  private readonly spawnProcess: SpawnProcess
  private readonly timeoutMs: number
  private readonly mutationTimeoutMs: number
  private readonly killGraceMs: number
  private readonly maxRecordBytes: number
  private readonly maxOutputBytes: number
  private readonly maxStderrBytes: number
  private readonly maxRecordCount: number
  private active = new Set<ChildProcessWithoutNullStreams>()
  private disposed = false

  constructor(options: LocalPiManagementHostOptions) {
    if (!isAbsolute(options.helperEntryPath)) {
      throw new Error('The Pi management helper entry must be absolute.')
    }
    this.helperEntryPath = resolve(options.helperEntryPath)
    this.electronExecutablePath = options.electronExecutablePath ?? process.execPath
    this.environment = options.environment ?? process.env
    this.spawnProcess = options.spawnProcess ?? spawn
    this.timeoutMs = Math.max(1_000, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    this.mutationTimeoutMs = Math.max(
      this.timeoutMs,
      options.mutationTimeoutMs ?? DEFAULT_MUTATION_TIMEOUT_MS,
    )
    this.killGraceMs = Math.max(50, options.killGraceMs ?? DEFAULT_KILL_GRACE_MS)
    this.maxRecordBytes = Math.max(1_024, options.maxRecordBytes ?? DEFAULT_RECORD_BYTES)
    this.maxOutputBytes = Math.max(this.maxRecordBytes, options.maxOutputBytes ?? DEFAULT_OUTPUT_BYTES)
    this.maxStderrBytes = Math.max(1_024, options.maxStderrBytes ?? DEFAULT_STDERR_BYTES)
    this.maxRecordCount = Math.max(10, options.maxRecordCount ?? DEFAULT_RECORD_COUNT)
  }

  run(
    rawCommand: PiManagementHelperCommand,
    onProgress?: (progress: PiManagementProgress) => void,
  ): Promise<PiManagementSnapshotPayload> {
    if (this.disposed) {
      return Promise.reject(new LocalPiManagementHostError(
        'PI_MANAGEMENT_HELPER_INVALID',
        'The Pi management helper is unavailable.',
        false,
      ))
    }
    const commandResult = piManagementHelperCommandSchema.safeParse(rawCommand)
    if (!commandResult.success) {
      return Promise.reject(new LocalPiManagementHostError(
        'PI_MANAGEMENT_HELPER_INVALID',
        'The Pi management helper command is invalid.',
        false,
      ))
    }
    const command = commandResult.data
    const input = Buffer.from(`${JSON.stringify(command)}\n`, 'utf8')
    if (input.length > DEFAULT_INPUT_BYTES) {
      return Promise.reject(new LocalPiManagementHostError(
        'PI_MANAGEMENT_HELPER_INVALID',
        'The Pi management helper command is too large.',
        false,
      ))
    }

    return new Promise<PiManagementSnapshotPayload>((resolveRun, rejectRun) => {
      let child: ChildProcessWithoutNullStreams
      try {
        child = this.spawnProcess(
          this.electronExecutablePath,
          [this.helperEntryPath],
          {
            env: { ...this.environment, ELECTRON_RUN_AS_NODE: '1' },
            shell: false,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
          },
        )
      } catch {
        rejectRun(new LocalPiManagementHostError(
          'PI_MANAGEMENT_HELPER_SPAWN_FAILED',
          'The Pi management helper could not be started.',
        ))
        return
      }

      this.active.add(child)
      let settled = false
      let recordBuffer = Buffer.alloc(0)
      let outputBytes = 0
      let recordCount = 0
      let stderr = Buffer.alloc(0)
      let result: PiManagementSnapshotPayload | undefined
      let failure: LocalPiManagementHostError | undefined
      let killTimer: NodeJS.Timeout | undefined
      let forcedSettleTimer: NodeJS.Timeout | undefined

      const cleanup = () => {
        clearTimeout(deadlineTimer)
        if (killTimer) clearTimeout(killTimer)
        if (forcedSettleTimer) clearTimeout(forcedSettleTimer)
        this.active.delete(child)
      }

      const settle = () => {
        if (settled) return
        settled = true
        cleanup()
        if (failure) rejectRun(failure)
        else if (result) resolveRun(result)
        else rejectRun(new LocalPiManagementHostError(
          'PI_MANAGEMENT_HELPER_EXITED',
          'The Pi management helper exited without a result.',
        ))
      }

      const terminate = (error: LocalPiManagementHostError) => {
        failure ??= error
        if (!child.killed) child.kill()
        if (!killTimer) {
          killTimer = setTimeout(() => {
            child.kill('SIGKILL')
            forcedSettleTimer = setTimeout(settle, this.killGraceMs)
            forcedSettleTimer.unref()
          }, this.killGraceMs)
          killTimer.unref()
        }
      }

      const acceptRecord = (record: Buffer) => {
        recordCount += 1
        if (record.length > this.maxRecordBytes || recordCount > this.maxRecordCount) {
          terminate(new LocalPiManagementHostError(
            'PI_MANAGEMENT_HELPER_PROTOCOL_ERROR',
            'The Pi management helper exceeded its output limits.',
            false,
          ))
          return
        }
        let parsed: unknown
        try {
          parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(record))
        } catch {
          terminate(new LocalPiManagementHostError(
            'PI_MANAGEMENT_HELPER_PROTOCOL_ERROR',
            'The Pi management helper returned malformed output.',
            false,
          ))
          return
        }
        const eventResult = piManagementHelperEventSchema.safeParse(parsed)
        if (!eventResult.success || eventResult.data.operationId !== command.operationId) {
          terminate(new LocalPiManagementHostError(
            'PI_MANAGEMENT_HELPER_PROTOCOL_ERROR',
            'The Pi management helper returned an uncorrelated result.',
            false,
          ))
          return
        }
        const event = eventResult.data
        if (result || failure) {
          terminate(new LocalPiManagementHostError(
            'PI_MANAGEMENT_HELPER_PROTOCOL_ERROR',
            'The Pi management helper returned output after its final result.',
            false,
          ))
          return
        }
        if (event.type === 'progress') {
          try {
            onProgress?.(event.progress)
          } catch {
            // Progress listeners cannot interrupt the owned helper process.
          }
          return
        }
        if (event.type === 'error') {
          failure = new LocalPiManagementHostError(
            event.error.code || 'PI_MANAGEMENT_OPERATION_FAILED',
            event.error.message,
            event.error.recoverable,
          )
        } else {
          result = event.result
        }
      }

      child.stdout.on('data', (chunk: Buffer) => {
        if (failure?.code === 'PI_MANAGEMENT_HELPER_PROTOCOL_ERROR') return
        outputBytes += chunk.length
        if (outputBytes > this.maxOutputBytes) {
          terminate(new LocalPiManagementHostError(
            'PI_MANAGEMENT_HELPER_PROTOCOL_ERROR',
            'The Pi management helper exceeded its output limits.',
            false,
          ))
          return
        }
        recordBuffer = Buffer.concat([recordBuffer, chunk])
        while (true) {
          const newline = recordBuffer.indexOf(0x0a)
          if (newline === -1) break
          const record = recordBuffer.subarray(0, newline)
          recordBuffer = recordBuffer.subarray(newline + 1)
          if (record.length > 0) acceptRecord(record)
        }
        if (recordBuffer.length > this.maxRecordBytes) {
          terminate(new LocalPiManagementHostError(
            'PI_MANAGEMENT_HELPER_PROTOCOL_ERROR',
            'The Pi management helper returned an oversized record.',
            false,
          ))
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = appendTail(stderr, chunk, this.maxStderrBytes)
      })
      child.once('error', () => {
        failure ??= new LocalPiManagementHostError(
          'PI_MANAGEMENT_HELPER_SPAWN_FAILED',
          'The Pi management helper could not be started.',
        )
        settle()
      })
      child.once('close', (code) => {
        if (recordBuffer.length > 0 && !failure) {
          failure = new LocalPiManagementHostError(
            'PI_MANAGEMENT_HELPER_PROTOCOL_ERROR',
            'The Pi management helper ended with an incomplete record.',
            false,
          )
        }
        if (code !== 0 && !failure) {
          failure = new LocalPiManagementHostError(
            'PI_MANAGEMENT_HELPER_EXITED',
            'The Pi management helper exited before completing the operation.',
          )
        }
        void stderr
        settle()
      })

      const deadlineTimer = setTimeout(() => {
        terminate(new LocalPiManagementHostError(
          'PI_MANAGEMENT_HELPER_TIMEOUT',
          'The Pi management helper exceeded its deadline.',
        ))
      }, mutation(command) ? this.mutationTimeoutMs : this.timeoutMs)
      deadlineTimer.unref()

      child.stdin.once('error', () => {
        terminate(new LocalPiManagementHostError(
          'PI_MANAGEMENT_HELPER_PROTOCOL_ERROR',
          'The Pi management helper command could not be written.',
        ))
      })
      child.stdin.end(input)
    })
  }

  async dispose() {
    this.disposed = true
    const active = [...this.active]
    for (const child of active) child.kill()
    await Promise.all(active.map((child) => new Promise<void>((resolveDispose) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolveDispose()
        return
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolveDispose()
      }, this.killGraceMs)
      timer.unref()
      child.once('close', () => {
        clearTimeout(timer)
        resolveDispose()
      })
    })))
    this.active.clear()
  }
}
