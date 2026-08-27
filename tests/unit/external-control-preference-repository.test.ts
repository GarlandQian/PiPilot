import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const renameState = vi.hoisted(() => ({ failNext: false, calls: 0 }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    renameSync(source: string, destination: string) {
      renameState.calls += 1
      if (renameState.failNext) {
        renameState.failNext = false
        throw Object.assign(new Error('simulated persist failure'), { code: 'EACCES' })
      }
      return actual.renameSync(source, destination)
    },
  }
})

import { ExternalControlPreferenceRepository } from '../../src/main/external-control/preference-repository'

const temporaryDirectories: string[] = []

afterEach(async () => {
  renameState.failNext = false
  renameState.calls = 0
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })))
})

describe('ExternalControlPreferenceRepository', () => {
  it('retries the same value after a failed durable write', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pipilot-external-preference-'))
    temporaryDirectories.push(directory)
    const filePath = join(directory, 'preferences.json')
    writeFileSync(filePath, '{"version":1,"enabled":false}\n', 'utf8')
    const repository = new ExternalControlPreferenceRepository(filePath)
    expect(repository.get()).toBe(false)

    renameState.failNext = true
    expect(() => repository.set(true)).toThrow('simulated persist failure')
    expect(repository.get()).toBe(false)
    expect(repository.set(true)).toBe(true)
    expect(renameState.calls).toBe(2)
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({
      version: 1,
      enabled: true,
    })
  })
})
