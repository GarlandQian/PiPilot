import type { TerminalSummary } from '@/shared/terminal'

/** List snapshots and mutations must commit in request order for one workspace. */
export class TerminalOperationQueue {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.catch(() => undefined)
    return result
  }
}

/** Terminal IDs are never restarted; an observed exit cannot become running. */
export class TerminalExitLedger {
  private readonly exits = new Map<string, Pick<TerminalSummary, 'exitCode' | 'signal'>>()

  record(terminalId: string, exit: Pick<TerminalSummary, 'exitCode' | 'signal'>) {
    const previous = this.exits.get(terminalId)
    this.exits.set(terminalId, {
      exitCode: exit.exitCode ?? previous?.exitCode,
      signal: exit.signal ?? previous?.signal,
    })
  }

  apply(summary: TerminalSummary): TerminalSummary {
    if (summary.status === 'exited') this.record(summary.terminalId, summary)
    const exit = this.exits.get(summary.terminalId)
    return exit ? { ...summary, status: 'exited', ...exit } : summary
  }

  forget(terminalId: string) {
    this.exits.delete(terminalId)
  }
}
