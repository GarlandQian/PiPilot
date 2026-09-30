import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as workflowStorage from '../../src/main/project-actions/workflow-storage'
import { ProjectActionService } from '../../src/main/project-actions/project-action-service'
import type { ProjectAction } from '../../src/shared/project-workflows'
const roots: string[] = []
const services: ProjectActionService[] = []
afterEach(async () => { await Promise.all(services.splice(0).map((service) => service.dispose())); vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pipilot-actions-'))); roots.push(root)
  const workspaceId = randomUUID(); let available = true
  const options = { filePath: join(root, 'actions.json'), location: () => ({ path: root }), assertAvailable() { if (!available) throw new Error('archiving') } }
  const service = new ProjectActionService(options); services.push(service); await service.initialize()
  const action: ProjectAction = { id: randomUUID(), name: 'Test', command: 'echo default', cwd: '.', platforms: {} }
  return { root, workspaceId, options, service, action, unavailable: () => { available = false } }
}
async function settled(service: ProjectActionService, workspaceId: string) {
  await expect.poll(() => service.runs(workspaceId)[0]?.status, { timeout: 5_000 }).not.toBe('running')
  await expect.poll(() => service.runs(workspaceId)[0]?.status, { timeout: 5_000 }).not.toBe('stopping')
  return service.runs(workspaceId)[0]!
}
describe('project actions', () => {
  it('serializes process completion behind configuration writes without restoring an older revision', async () => {
    const f = await fixture()
    await writeFile(join(f.root, 'wait.cjs'), "const fs=require('node:fs');setInterval(()=>{if(fs.existsSync('finish'))process.exit(0)},20)")
    f.action.command = `"${process.execPath}" wait.cjs`
    await f.service.save(f.workspaceId, [f.action], 0)
    await f.service.run(f.workspaceId, f.action.id, 1)
    let unblock!: () => void; const gate = new Promise<void>((resolve) => { unblock = resolve })
    let entered = false; const original = workflowStorage.writeWorkflowFile
    vi.spyOn(workflowStorage, 'writeWorkflowFile').mockImplementation(async (path, value) => {
      if (!entered && (value as { revision: number }).revision === 2) { entered = true; await gate }
      return original(path, value)
    })
    const updated = { ...f.action, name: 'Updated command' }
    const saving = f.service.save(f.workspaceId, [updated], 1)
    await expect.poll(() => entered).toBe(true)
    await writeFile(join(f.root, 'finish'), '')
    await expect.poll(() => f.service.runs(f.workspaceId)[0]?.status).toBe('completed')
    unblock(); await saving; await f.service.closeAll()
    const saved = JSON.parse(await readFile(f.options.filePath, 'utf8'))
    expect(saved.revision).toBe(2); expect(saved.projects[f.workspaceId]).toEqual([updated])
    expect(saved.runs[0].status).toBe('completed')
  })
  it('blocks new actions throughout workspace removal and refuses removing a running command', async () => {
    const f = await fixture(); await f.service.save(f.workspaceId, [f.action], 0)
    let unblock!: () => void; const gate = new Promise<void>((resolve) => { unblock = resolve })
    const removing = f.service.withInactiveProject(f.workspaceId, () => gate)
    await expect(f.service.run(f.workspaceId, f.action.id, 1)).rejects.toThrow('being removed')
    unblock(); await removing
    await writeFile(join(f.root, 'wait.cjs'), 'setInterval(()=>{},1000)')
    await f.service.save(f.workspaceId, [{ ...f.action, command: `"${process.execPath}" wait.cjs` }], 1)
    const started = await f.service.run(f.workspaceId, f.action.id, 2)
    await expect(f.service.withInactiveProject(f.workspaceId, async () => undefined)).rejects.toThrow('Stop')
    await f.service.stop(started.id)
  })
  it('persists platform commands, captures stdout/stderr and reports exit status', async () => {
    const f = await fixture(); f.action.platforms[process.platform as 'darwin' | 'linux' | 'win32'] = 'echo platform && echo error-output 1>&2'
    await f.service.save(f.workspaceId, [f.action], 0)
    const started = await f.service.run(f.workspaceId, f.action.id, 1)
    expect(started.command).toContain('platform')
    const run = await settled(f.service, f.workspaceId)
    expect(run.status).toBe('completed'); expect(run.exitCode).toBe(0)
    expect(run.output).toContain('platform'); expect(run.output).toContain('error-output')
    await f.service.closeAll()
    const restored = new ProjectActionService(f.options); services.push(restored); await restored.initialize()
    expect(restored.actions(f.workspaceId)).toEqual([f.action]); expect(restored.runs(f.workspaceId)[0]?.status).toBe('completed')
  })
  it('rejects stale save and run confirmations and archive admission', async () => {
    const f = await fixture(); await f.service.save(f.workspaceId, [f.action], 0)
    await expect(f.service.save(f.workspaceId, [], 0)).rejects.toThrow('changed')
    await expect(f.service.run(f.workspaceId, f.action.id, 0)).rejects.toThrow('changed')
    f.unavailable(); await expect(f.service.run(f.workspaceId, f.action.id, 1)).rejects.toThrow('archiving')
  })
  it('refuses relative traversal and symlinks outside the project', async () => {
    const f = await fixture()
    await expect(f.service.save(f.workspaceId, [{ ...f.action, cwd: '../' }], 0)).rejects.toThrow('relative')
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'pipilot-action-outside-'))); roots.push(outside)
    await symlink(outside, join(f.root, 'outside'), process.platform === 'win32' ? 'junction' : 'dir')
    await f.service.save(f.workspaceId, [{ ...f.action, cwd: 'outside' }], 0)
    await expect(f.service.run(f.workspaceId, f.action.id, 1)).rejects.toThrow('inside')
  })
  it('allows one live action per project and stops the process group', async () => {
    const f = await fixture()
    await writeFile(join(f.root, 'wait.cjs'), "console.log('ready');setInterval(()=>{},1000)")
    f.action.command = `"${process.execPath}" wait.cjs`
    await f.service.save(f.workspaceId, [f.action], 0)
    const started = await f.service.run(f.workspaceId, f.action.id, 1)
    expect(f.service.hasActive(f.workspaceId)).toBe(true)
    await expect(f.service.run(f.workspaceId, f.action.id, 1)).rejects.toThrow('current')
    await f.service.stop(started.id)
    expect((await settled(f.service, f.workspaceId)).status).toBe('stopped')
    expect(f.service.hasActive()).toBe(false)
  })
  it('marks unfinished persisted runs interrupted without replaying commands', async () => {
    const f = await fixture(); await mkdir(join(f.root, 'cwd'))
    await writeFile(f.options.filePath, JSON.stringify({ version: 1, revision: 3, projects: {}, runs: [{ id: randomUUID(), workspaceId: f.workspaceId, actionId: f.action.id, name: 'Prior', command: 'do not run', cwd: f.root, startedAt: new Date().toISOString(), status: 'running', exitCode: null, output: 'before crash' }] }))
    const next = new ProjectActionService(f.options); services.push(next); await next.initialize()
    expect(next.runs(f.workspaceId)[0]).toMatchObject({ status: 'interrupted', output: 'before crash' })
    expect(await readFile(f.options.filePath, 'utf8')).toContain('interrupted')
  })

  it('shutdown waits for pending starts and prevents late process creation', async () => {
    const f = await fixture(); await f.service.save(f.workspaceId, [f.action], 0)
    const starting = f.service.run(f.workspaceId, f.action.id, 1)
    const result = starting.catch((error) => error)
    await f.service.closeAll(); await result
    expect(f.service.hasActive()).toBe(false)
    expect(f.service.runs(f.workspaceId).every((run) => run.status !== 'running')).toBe(true)
    const next = await f.service.run(f.workspaceId, f.action.id, 1)
    expect(next.status).toBe('running'); await settled(f.service, f.workspaceId)
  })
})
