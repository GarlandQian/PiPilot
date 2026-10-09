import { expect, it } from 'vitest'
import { SettingsManager } from '@earendil-works/pi-coding-agent'
import { prependWindowsNodePath, useBundledNpm } from '../../src/main/bundled-npm'
import { portableDataDirectory } from '../../src/main/portable-storage'

it('supplies npm after SDK reload without persisting an application-specific command', async () => {
  const settings = SettingsManager.inMemory()
  const command = ['C:\\PiPilot\\PiPilot.exe', 'C:\\PiPilot\\npm-runner.js', '--', 'npm']
  useBundledNpm(settings, command)
  expect(settings.getNpmCommand()).toEqual(command)
  await settings.reload()
  expect(settings.getNpmCommand()).toEqual(command)
  expect(settings.getGlobalSettings().npmCommand).toBeUndefined()
})
it('preserves explicitly configured package managers', () => {
  const settings = SettingsManager.inMemory({ npmCommand: ['custom-pnpm', '--reporter=silent'] })
  useBundledNpm(settings, ['bundled'])
  expect(settings.getNpmCommand()).toEqual(['custom-pnpm', '--reporter=silent'])
})
it.each(['npm', 'npm.cmd'])('replaces the default %s command after reload', async (npm) => {
  const settings = SettingsManager.inMemory({ npmCommand: [npm] })
  useBundledNpm(settings, ['bundled-npm'])
  await settings.reload()
  expect(settings.getNpmCommand()).toEqual(['bundled-npm'])
  expect(settings.getGlobalSettings().npmCommand).toEqual([npm])
})
it('prepends the app runtime and retains Windows PATH variants without duplicates', () => {
  const environment = { Path: 'C:\\fnm\\stale;C:\\Windows\\System32', PATH: 'C:\\WINDOWS\\system32;"D:\\应用 With Spaces\\node"', KEEP: 'unchanged' }
  prependWindowsNodePath(environment, 'D:\\应用 With Spaces\\node')
  prependWindowsNodePath(environment, 'D:\\应用 With Spaces\\node')
  expect(environment).toEqual({ PATH: 'D:\\应用 With Spaces\\node;C:\\fnm\\stale;C:\\Windows\\System32', KEEP: 'unchanged' })
})
it('uses the original portable EXE directory instead of its temporary extraction directory', () => {
  expect(portableDataDirectory({ packaged: true, portable: true, platform: 'win32', executablePath: 'C:\\Temp\\extract\\PiPilot.exe', environment: { PORTABLE_EXECUTABLE_DIR: 'D:\\应用 With Spaces' } })).toBe('D:\\应用 With Spaces\\data')
  expect(portableDataDirectory({ packaged: true, portable: false, platform: 'win32' })).toBeUndefined()
})
