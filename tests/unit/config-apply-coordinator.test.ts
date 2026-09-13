import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfigApplyCoordinator } from '../../src/main/config-apply/config-apply-coordinator'
import { FakeConfigApplyRuntime } from './helpers/config-apply-runtime'
import { RuntimeMaintenanceGate } from '../../src/main/pi-host/runtime-maintenance-gate'

const roots: string[] = []
const coordinators: ConfigApplyCoordinator[] = []

afterEach(async () => {
  for (const coordinator of coordinators.splice(0)) coordinator.dispose()
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pipilot-config-apply-'))
  roots.push(root)
  const runtime = new FakeConfigApplyRuntime()
  const coordinator = new ConfigApplyCoordinator(runtime)
  coordinators.push(coordinator)
  async function save(name: string, content: string) {
    const path = join(root, name)
    await writeFile(path, content)
    return { path, fingerprint: createHash('sha256').update(content).digest('hex') }
  }
  return { runtime, coordinator, save }
}

describe('ConfigApplyCoordinator', () => {
  it('retains independent targets across equal and different selected generations', async () => {
    const { runtime, coordinator, save } = await fixture()
    const first = await save('mcp.json', '{}')
    const second = await save('models.json', '{"providers":{}}')
    expect((await coordinator.apply(first)).state).toBe('pending')
    expect((await coordinator.apply(second)).state).toBe('pending')
    runtime.selectedGeneration = 9
    runtime.emitChange()
    runtime.selectedGeneration = 1
    runtime.emitChange()
    expect(runtime.reload).not.toHaveBeenCalled()
    runtime.busy = false
    runtime.emitChange()
    await vi.waitFor(() => {
      expect(coordinator.getStatus(first.path)?.state).toBe('applied')
      expect(coordinator.getStatus(second.path)?.state).toBe('applied')
    })
  })

  it('coalesces a newer saved fingerprint without applying the previous pending revision', async () => {
    const { runtime, coordinator, save } = await fixture()
    const previous = await save('mcp.json', '{}')
    await coordinator.apply(previous)
    const current = await save('mcp.json', '{"updated":true}')
    await coordinator.apply(current)
    runtime.busy = false
    await coordinator.retryPending()
    expect(runtime.reload).toHaveBeenCalledOnce()
    expect(coordinator.getStatus(current.path)).toMatchObject({ state: 'applied', fingerprint: current.fingerprint })
  })

  it('detects external edits before reload and after SDK return without claiming the saved fingerprint', async () => {
    const { runtime, coordinator, save } = await fixture()
    runtime.busy = false
    const previous = await save('mcp.json', '{}')
    await save('mcp.json', '{"external":true}')
    expect((await coordinator.apply(previous)).state).toBe('superseded')
    expect(runtime.reload).not.toHaveBeenCalled()
    const current = await save('mcp.json', '{"current":true}')
    runtime.reload.mockImplementationOnce(async () => { await save('mcp.json', '{"later":true}') })
    expect(await coordinator.apply(current)).toMatchObject({ state: 'superseded', applied: 0 })
    expect(runtime.reload).toHaveBeenCalledOnce()
  })

  it('retains per-Host success and retries only the failed Runtime for the same fingerprint', async () => {
    const { runtime, coordinator, save } = await fixture()
    runtime.targets.push({ hostKey: 'host-b', hostEpoch: 2, runtimeId: 'rt_b', generation: 1 })
    runtime.busy = false
    runtime.reload.mockImplementationOnce(async () => undefined)
      .mockRejectedValueOnce(new Error('second Host failed'))
    const revision = await save('models.json', '{}')
    expect(await coordinator.apply(revision)).toMatchObject({ state: 'failed', total: 2, applied: 1, failed: 1 })
    expect(await coordinator.apply(revision)).toMatchObject({ state: 'applied', total: 2, applied: 2, failed: 0 })
    expect(runtime.reload.mock.calls.map(([target]) => target.runtimeId)).toEqual(['rt_a', 'rt_b', 'rt_b'])
  })

  it('cannot let an older in-flight save erase a superseding revision', async () => {
    const { runtime, coordinator, save } = await fixture()
    runtime.busy = false
    let finish!: () => void
    const waiting = new Promise<void>((resolve) => { finish = resolve })
    runtime.reload.mockImplementationOnce(() => waiting)
    const older = await save('models.json', '{}')
    const oldApply = coordinator.apply(older)
    await vi.waitFor(() => expect(runtime.reload).toHaveBeenCalledOnce())
    const newer = await save('models.json', '{"newer":true}')
    const newApply = coordinator.apply(newer)
    finish()
    expect((await oldApply).state).toBe('superseded')
    expect((await newApply).state).toBe('applied')
    expect(coordinator.getStatus(newer.path)?.fingerprint).toBe(newer.fingerprint)
  })

  it('automatically retries a denied admission after a read finishes without Runtime activity events', async () => {
    const { runtime, coordinator, save } = await fixture()
    const gate = new RuntimeMaintenanceGate()
    runtime.busy = false
    gate.subscribeAdmission(() => runtime.emitChange())
    const apply = runtime.applyConfiguration.getMockImplementation()!
    runtime.applyConfiguration.mockImplementation(async (attempt) => {
      const result = await gate.maintenance(attempt.cwd, () => apply(attempt))
      return result.admitted ? result.value : { state: 'pending', total: 0, applied: 0, failed: 0 }
    })
    let finish!: () => void
    const read = gate.operation('/project', () => new Promise<void>((resolve) => { finish = resolve }))
    const revision = await save('models.json', '{}')
    expect((await coordinator.apply(revision)).state).toBe('pending')
    expect(runtime.reload).not.toHaveBeenCalled()
    finish()
    await read
    await vi.waitFor(() => expect(coordinator.getStatus(revision.path)?.state).toBe('applied'))
    expect(runtime.reload).toHaveBeenCalledOnce()
  })

  it('does not describe an externally edited loaded document as the applied fingerprint', async () => {
    const { runtime, coordinator, save } = await fixture()
    runtime.busy = false
    const applied = await save('models.json', '{}')
    await coordinator.apply(applied)
    const external = await save('models.json', '{"external":true}')
    expect(coordinator.getStatus(external.path, external.fingerprint)).toMatchObject({
      state: 'superseded', fingerprint: applied.fingerprint,
    })
    expect(runtime.reload).toHaveBeenCalledOnce()
  })

  it('wakes only a competing maintenance waiter when the incumbent exits without Runtime events', async () => {
    const { runtime, coordinator, save } = await fixture()
    const gate = new RuntimeMaintenanceGate()
    runtime.busy = true
    const original = runtime.applyConfiguration.getMockImplementation()!
    runtime.applyConfiguration.mockImplementation(async (attempt) => {
      const result = await gate.maintenance(attempt.cwd, () => original(attempt))
      return result.admitted ? result.value : {
        state: 'pending', total: 0, applied: 0, failed: 0, retryAfter: result.retryAfter,
      }
    })
    let release!: () => void
    const first = gate.maintenance(undefined, () => new Promise<void>((resolve) => { release = resolve }))
    const revision = await save('models.json', '{}')
    expect((await coordinator.apply(revision)).state).toBe('pending')
    release()
    await first
    await vi.waitFor(() => expect(runtime.applyConfiguration).toHaveBeenCalledTimes(2))
    await new Promise<void>((resolve) => setImmediate(resolve))
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(runtime.applyConfiguration).toHaveBeenCalledTimes(2)
    expect(coordinator.getStatus(revision.path)?.state).toBe('pending')
    expect(coordinator.getStatus(revision.path)).not.toHaveProperty('retryAfter')
    expect(runtime.reload).not.toHaveBeenCalled()
  })
})
