import { describe, expect, it } from 'vitest'
import type { TerminalSummary } from '../../src/shared/terminal'
import { TerminalExitLedger, TerminalOperationQueue } from '../../src/components/inspector/terminal-workspace-state'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

const summary: TerminalSummary = {
  scope: { kind: 'projectless' },
  terminalId: 'terminal-a',
  title: 'zsh',
  shell: 'zsh',
  cols: 80,
  rows: 24,
  status: 'running',
}

describe('workspace terminal operation ordering', () => {
  it('commits a delayed list before create, and refreshes after close has completed', async () => {
    const queue = new TerminalOperationQueue()
    const listGate = deferred()
    const closeGate = deferred()
    const events: string[] = []
    const refresh = queue.run(async () => {
      events.push('list begins')
      await listGate.promise
      events.push('list commits')
    })
    const create = queue.run(async () => { events.push('create commits') })
    const close = queue.run(async () => {
      events.push('close begins')
      await closeGate.promise
      events.push('close commits')
    })
    const nextRefresh = queue.run(async () => { events.push('next list commits') })
    await Promise.resolve()
    expect(events).toEqual(['list begins'])
    listGate.resolve()
    await create
    expect(events.slice(0, 3)).toEqual(['list begins', 'list commits', 'create commits'])
    expect(events).not.toContain('next list commits')
    closeGate.resolve()
    await Promise.all([refresh, close, nextRefresh])
    expect(events).toEqual(['list begins', 'list commits', 'create commits', 'close begins', 'close commits', 'next list commits'])
  })

  it('allows retry after a rejected operation', async () => {
    const queue = new TerminalOperationQueue()
    const failed = queue.run(async () => { throw new Error('scope changed') })
    const retried = queue.run(async () => 'recovered')
    await expect(failed).rejects.toThrow('scope changed')
    await expect(retried).resolves.toBe('recovered')
  })
})

describe('terminal exit reconciliation', () => {
  it('preserves exit-before-attach and exit-before-create events through stale running snapshots', () => {
    const ledger = new TerminalExitLedger()
    ledger.record(summary.terminalId, { exitCode: 130, signal: 2 })
    expect(ledger.apply(summary)).toMatchObject({ status: 'exited', exitCode: 130, signal: 2 })
    expect(ledger.apply({ ...summary, title: 'Renamed' })).toMatchObject({ title: 'Renamed', status: 'exited', exitCode: 130 })
    expect(ledger.apply({ ...summary, terminalId: 'terminal-b' }).status).toBe('running')
  })

  it('retains exits learned from snapshots and releases the closed terminal record', () => {
    const ledger = new TerminalExitLedger()
    ledger.apply({ ...summary, status: 'exited', exitCode: 0 })
    expect(ledger.apply(summary)).toMatchObject({ status: 'exited', exitCode: 0 })
    ledger.forget(summary.terminalId)
    expect(ledger.apply(summary)).toBe(summary)
  })
})
