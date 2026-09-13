export class RuntimeMaintenanceBusyError extends Error {
  readonly code = 'PI_RUNTIME_MAINTENANCE_PENDING'
  readonly recoverable = true

  constructor() {
    super('Pi configuration is being applied. Retry this operation when application finishes.')
    this.name = 'RuntimeMaintenanceBusyError'
  }
}

export interface RuntimeMaintenancePermit {
  readonly cwd: string | undefined
}

/** Admission and maintenance share one synchronous decision before any await. */
export class RuntimeMaintenanceGate {
  private readonly permits = new Map<RuntimeMaintenancePermit, Promise<void>>()
  private readonly operations = new Map<string, number>()
  private readonly listeners = new Set<() => void>()

  subscribeAdmission(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  assertAdmission(cwd: string, owner?: RuntimeMaintenancePermit): void {
    for (const permit of this.permits.keys()) {
      if (permit !== owner && (permit.cwd === undefined || permit.cwd === cwd)) {
        throw new RuntimeMaintenanceBusyError()
      }
    }
  }

  async operation<T>(
    cwd: string,
    operation: () => Promise<T>,
    owner?: RuntimeMaintenancePermit,
  ): Promise<T> {
    this.assertAdmission(cwd, owner)
    this.operations.set(cwd, (this.operations.get(cwd) ?? 0) + 1)
    try {
      return await operation()
    } finally {
      const remaining = (this.operations.get(cwd) ?? 1) - 1
      if (remaining === 0) this.operations.delete(cwd)
      else this.operations.set(cwd, remaining)
      if (!owner) {
        for (const listener of this.listeners) {
          try { listener() } catch { /* isolate availability observers */ }
        }
      }
    }
  }

  async maintenance<T>(
    cwd: string | undefined,
    operation: (permit: RuntimeMaintenancePermit) => Promise<T>,
  ): Promise<{ admitted: false; retryAfter?: Promise<void> } | { admitted: true; value: T }> {
    const conflicts = [...this.permits].filter(([permit]) =>
      cwd === undefined || permit.cwd === undefined || cwd === permit.cwd)
    if (conflicts.length > 0) {
      return { admitted: false, retryAfter: Promise.all(conflicts.map(([, released]) => released)).then(() => undefined) }
    }
    if ([...this.operations.keys()].some((target) => cwd === undefined || target === cwd)) {
      return { admitted: false }
    }

    const permit = { cwd }
    let release!: () => void
    this.permits.set(permit, new Promise<void>((resolve) => { release = resolve }))
    try {
      return { admitted: true, value: await operation(permit) }
    } finally {
      this.permits.delete(permit)
      release()
    }
  }

  /** Exact dialog answers must remain available while reload binds extensions. */
  dialogResponse<T>(cwd: string, operation: () => Promise<T>): Promise<T> {
    const permit = [...this.permits.keys()].find((entry) => entry.cwd === undefined || entry.cwd === cwd)
    return this.operation(cwd, operation, permit)
  }
}
