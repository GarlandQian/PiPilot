import { describe, expect, it } from 'vitest'
import {
  applyShellEnvironment,
  loginShellArguments,
  needsShellEnvironment,
  parseShellEnvironment,
  resolveShellEnvironment,
} from '../../src/main/shell-environment'

describe('login shell environment', () => {
  it('is read only for apps started outside a shell on macOS and Linux', () => {
    expect(needsShellEnvironment({}, 'darwin')).toBe(true)
    expect(needsShellEnvironment({}, 'linux')).toBe(true)
    expect(needsShellEnvironment({ SHLVL: '1' }, 'darwin')).toBe(false)
    expect(needsShellEnvironment({}, 'win32')).toBe(false)
  })

  it('runs an interactive login shell, csh included', () => {
    expect(loginShellArguments('/bin/zsh', 'cmd')).toEqual(['-i', '-l', '-c', 'cmd'])
    expect(loginShellArguments('/opt/homebrew/bin/fish', 'cmd')).toEqual(['-i', '-l', '-c', 'cmd'])
    expect(loginShellArguments('/bin/tcsh', 'cmd')).toEqual(['-ic', 'cmd'])
  })

  it('reads the environment between its markers, whatever the rc files print', () => {
    const marker = '__M__'
    const output = `Welcome!\n${marker}${JSON.stringify({ PATH: '/opt/homebrew/bin:/usr/bin', SHLVL: '2', PWD: '/x', COUNT: 3 })}${marker}\n`
    expect(parseShellEnvironment(output, marker)).toEqual({ PATH: '/opt/homebrew/bin:/usr/bin' })
    expect(parseShellEnvironment('no markers', marker)).toBeNull()
    expect(parseShellEnvironment(`${marker}not json${marker}`, marker)).toBeNull()
  })

  it('adopts the shell values except the ones the app keeps', () => {
    const target: NodeJS.ProcessEnv = { PATH: '/usr/bin', PI_CODING_AGENT_DIR: '/app/agent' }
    applyShellEnvironment(target, { PATH: '/opt/homebrew/bin:/usr/bin', PI_CODING_AGENT_DIR: '/shell/agent', LANG: 'zh_CN.UTF-8' }, ['PI_CODING_AGENT_DIR'])
    expect(target).toEqual({ PATH: '/opt/homebrew/bin:/usr/bin', PI_CODING_AGENT_DIR: '/app/agent', LANG: 'zh_CN.UTF-8' })
  })

  it.skipIf(process.platform === 'win32')('resolves through a real shell, and gives up on one that fails', async () => {
    const resolved = await resolveShellEnvironment({
      environment: { SHELL: '/bin/sh', PATH: process.env.PATH, HOME: process.env.HOME, PIPILOT_PROBE: 'from shell' },
      executable: process.execPath,
    })
    expect(resolved?.PIPILOT_PROBE).toBe('from shell')
    expect(resolved?.PATH).toBeTruthy()
    expect(resolved).not.toHaveProperty('ELECTRON_RUN_AS_NODE')
    expect(await resolveShellEnvironment({ environment: { SHELL: '/nonexistent/shell' } })).toBeNull()
  }, 20_000)
})
