import { describe, expect, it } from 'vitest'
import { runLauncherCommand } from '../../src/main/external-control/launcher-command'

describe('asynchronous launcher platform commands', () => {
  it('leaves the event loop responsive while a slow system probe is pending', async () => {
    let completed = false
    const command = runLauncherCommand(process.execPath, [
      '-e', 'setTimeout(() => process.stdout.write("ready"), 150)',
    ]).then((result) => { completed = true; return result })
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    expect(completed).toBe(false)
    expect((await command).toString()).toBe('ready')
  })

  it('kills a hung probe at its deadline and rejects without blocking other commands', async () => {
    const hung = runLauncherCommand(process.execPath, [
      '-e', 'setInterval(() => {}, 1000)',
    ], { timeoutMs: 100 })
    const rejected = expect(hung).rejects.toMatchObject({ killed: true, signal: 'SIGKILL' })
    const healthy = runLauncherCommand(process.execPath, ['-e', 'process.stdout.write("ok")'])
    expect((await healthy).toString()).toBe('ok')
    await rejected
  })

  it('bounds command output and passes arguments literally without a shell', async () => {
    await expect(runLauncherCommand(process.execPath, [
      '-e', 'process.stdout.write("x".repeat(2048))',
    ], { maxBuffer: 1024 })).rejects.toMatchObject({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' })
    const literal = '$(this-is-not-a-command) & | ; %PATH%'
    const output = await runLauncherCommand(process.execPath, [
      '-e', 'process.stdout.write(process.argv[1])', literal,
    ])
    expect(output.toString()).toBe(literal)
  })
})
