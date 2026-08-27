import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConversationMcpAuditRepository } from '../../src/main/external-control/audit-repository'
import { externalControlOperationSchema } from '../../src/shared/external-control'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })))
})

function operation(index: number) {
  const timestamp = new Date(index * 1_000).toISOString()
  return externalControlOperationSchema.parse({
    operationId: `op_${String(index).padStart(43, '0')}`,
    conversationId: `conv_${String(index).padStart(43, '0')}`,
    kind: 'send_prompt',
    status: 'completed',
    receivedAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
  })
}

describe('ConversationMcpAuditRepository', () => {
  it('replaces the exact bounded backup across repeated rotations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pipilot-audit-'))
    temporaryDirectories.push(directory)
    const auditPath = join(directory, 'audit.jsonl')
    const repository = new ConversationMcpAuditRepository(auditPath, 1)

    repository.append(operation(1))
    repository.append(operation(2))
    repository.append(operation(3))
    await repository.flush()

    const current = JSON.parse((await readFile(auditPath, 'utf8')).trim()) as {
      operationId: string
    }
    const backup = JSON.parse((await readFile(`${auditPath}.1`, 'utf8')).trim()) as {
      operationId: string
    }
    expect(current.operationId).toBe(operation(3).operationId)
    expect(backup.operationId).toBe(operation(2).operationId)
  })

  it('does not append past the bound when backup removal fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pipilot-audit-'))
    temporaryDirectories.push(directory)
    const auditPath = join(directory, 'audit.jsonl')
    const backupPath = `${auditPath}.1`
    const original = 'already-at-the-limit\n'
    await writeFile(auditPath, original, 'utf8')
    await mkdir(backupPath)
    const repository = new ConversationMcpAuditRepository(auditPath, 1)

    repository.append(operation(1))
    await repository.flush()
    expect(await readFile(auditPath, 'utf8')).toBe(original)

    await rm(backupPath, { recursive: true })
    repository.append(operation(2))
    await repository.flush()
    const current = JSON.parse((await readFile(auditPath, 'utf8')).trim()) as {
      operationId: string
    }
    expect(current.operationId).toBe(operation(2).operationId)
    expect(await readFile(backupPath, 'utf8')).toBe(original)
  })
})
