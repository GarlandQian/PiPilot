import { describe, expect, it, vi } from 'vitest'
import { RuntimeMaintenanceGate } from '../../src/main/pi-host/runtime-maintenance-gate'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('RuntimeMaintenanceGate', () => {
  it('makes existing operations block affected maintenance without serializing unrelated projects', async () => {
    const gate = new RuntimeMaintenanceGate()
    const pending = deferred()
    const operation = gate.operation('/a', () => pending.promise)
    const apply = vi.fn(async () => undefined)
    await expect(gate.maintenance(undefined, apply)).resolves.toEqual({ admitted: false })
    await expect(gate.maintenance('/a', apply)).resolves.toEqual({ admitted: false })
    await expect(gate.maintenance('/b', apply)).resolves.toMatchObject({ admitted: true })
    expect(apply).toHaveBeenCalledOnce()
    pending.resolve()
    await operation
    await expect(gate.maintenance('/a', apply)).resolves.toMatchObject({ admitted: true })
  })

  it('rejects new affected work throughout maintenance and accepts only its exact permit', async () => {
    const gate = new RuntimeMaintenanceGate()
    const pending = deferred()
    const apply = gate.maintenance('/a', async (permit) => {
      await expect(gate.operation('/a', async () => 1, permit)).resolves.toBe(1)
      await pending.promise
    })
    await expect(gate.operation('/a', async () => 1)).rejects.toMatchObject({
      code: 'PI_RUNTIME_MAINTENANCE_PENDING', recoverable: true,
    })
    await expect(gate.operation('/a', async () => 1, { cwd: '/a' })).rejects.toMatchObject({
      code: 'PI_RUNTIME_MAINTENANCE_PENDING',
    })
    await expect(gate.operation('/b', async () => 2)).resolves.toBe(2)
    await expect(gate.dialogResponse('/a', async () => 'answer')).resolves.toBe('answer')
    pending.resolve()
    await apply
    await expect(gate.operation('/a', async () => 3)).resolves.toBe(3)
  })

  it('releases admission on every failure and protects future Hosts during global apply', async () => {
    const gate = new RuntimeMaintenanceGate()
    await expect(gate.maintenance(undefined, async () => {
      expect(() => gate.assertAdmission('/new-project')).toThrow('Retry')
      throw new Error('apply failed')
    })).rejects.toThrow('apply failed')
    await expect(gate.operation('/new-project', async () => true)).resolves.toBe(true)
  })
})
