import {
  appendFileSync,
  chmodSync,
  closeSync,
  copyFileSync,
  mkdirSync,
  openSync,
  statSync,
  truncateSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

const DEFAULT_MAX_LOG_BYTES = 1024 * 1024
const DIAGNOSTIC_SEGMENT = /^[A-Z][A-Z0-9_]{0,63}$/
const REJECTED_DIAGNOSTIC_CODE = 'UNSAFE_DIAGNOSTIC_CODE_REJECTED'

export type DiagnosticLevel = 'error' | 'info' | 'warn'

interface MainDiagnosticsOptions {
  enabled: boolean
  logFile: string
  maxLogBytes?: number
}

function normalizeSegment(value: string) {
  const normalized = value.replace(/-/g, '_').toUpperCase()
  return DIAGNOSTIC_SEGMENT.test(normalized) ? normalized : null
}

export function createScopedDiagnosticCode(scope: string, code: string) {
  const safeScope = normalizeSegment(scope)
  const safeCode = normalizeSegment(code)
  return safeScope && safeCode
    ? `${safeScope}_${safeCode}`
    : REJECTED_DIAGNOSTIC_CODE
}

export class MainDiagnostics {
  private available = false
  private readonly maxLogBytes: number

  constructor(private readonly options: MainDiagnosticsOptions) {
    this.maxLogBytes = options.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES
  }

  initialize() {
    if (!this.options.enabled) return

    try {
      mkdirSync(dirname(this.options.logFile), { recursive: true, mode: 0o700 })
      closeSync(openSync(this.options.logFile, 'a', 0o600))
      chmodSync(this.options.logFile, 0o600)
      this.available = true
      this.rotateIfNeeded()
    } catch {
      this.available = false
      console.error('[PiPilot] PRODUCTION_LOG_INITIALIZATION_FAILED')
    }
  }

  record(level: DiagnosticLevel, code: string) {
    const safeCode = normalizeSegment(code) ?? REJECTED_DIAGNOSTIC_CODE
    if (this.options.enabled && this.available) {
      try {
        this.rotateIfNeeded()
        appendFileSync(
          this.options.logFile,
          `${JSON.stringify({
            timestamp: new Date().toISOString(),
            level,
            code: safeCode,
          })}\n`,
          { encoding: 'utf8', mode: 0o600 },
        )
        return
      } catch {
        this.available = false
        console.error('[PiPilot] PRODUCTION_LOG_WRITE_FAILED')
      }
    }

    const message = `[PiPilot] ${safeCode}`
    if (level === 'error') {
      console.error(message)
    } else if (level === 'warn') {
      console.warn(message)
    } else {
      console.info(message)
    }
  }

  scoped(level: DiagnosticLevel, scope: string, code: string) {
    this.record(level, createScopedDiagnosticCode(scope, code))
  }

  private rotateIfNeeded() {
    if (statSync(this.options.logFile).size < this.maxLogBytes) return

    const previousLogFile = join(dirname(this.options.logFile), 'main.previous.log')
    copyFileSync(this.options.logFile, previousLogFile)
    chmodSync(previousLogFile, 0o600)
    truncateSync(this.options.logFile, 0)
  }
}
