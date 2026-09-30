import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isAppImageMainProcess, isCanaryProcessEnvironment, isLinuxCanaryRunner,
  linuxCanaryEnvironment, readLinuxCanaryManifest, validateLinuxCanaryRoot,
} from '../packaged/linux-canary-support'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function temporary(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  directories.push(directory)
  return realpath(directory)
}

describe('Linux package canary isolation', () => {
  it('requires GitHub-hosted Linux x64 and both CI identities before native installation can run', () => {
    const ci = { CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' }
    expect(isLinuxCanaryRunner(ci, 'linux', 'x64')).toBe(true)
    expect(isLinuxCanaryRunner({ CI: 'true' }, 'linux', 'x64')).toBe(false)
    expect(isLinuxCanaryRunner({ GITHUB_ACTIONS: 'true' }, 'linux', 'x64')).toBe(false)
    expect(isLinuxCanaryRunner(ci, 'darwin', 'x64')).toBe(false)
    expect(isLinuxCanaryRunner(ci, 'linux', 'arm64')).toBe(false)
    expect(isLinuxCanaryRunner({ ...ci, RUNNER_ENVIRONMENT: 'self-hosted' }, 'linux', 'x64')).toBe(false)
  })

  it('accepts only dedicated temporary roots and rejects a matching-name symlink escaping that root', async () => {
    const temporaryParent = await temporary('linux-canary-boundary-')
    const allowed = join(temporaryParent, 'pipilot-packaged-smoke-linux-fixture')
    await mkdir(allowed)
    expect(await validateLinuxCanaryRoot(allowed, temporaryParent)).toBe(allowed)
    await expect(validateLinuxCanaryRoot(temporaryParent, temporaryParent)).rejects.toThrow('dedicated directory')
    await mkdir(join(allowed, 'pipilot-packaged-smoke-linux-nested'))
    await expect(validateLinuxCanaryRoot(join(allowed, 'pipilot-packaged-smoke-linux-nested'), temporaryParent)).rejects.toThrow('dedicated directory')
    const outside = await temporary('linux-canary-outside-')
    const link = join(temporaryParent, 'pipilot-packaged-smoke-linux-escape')
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(validateLinuxCanaryRoot(link, temporaryParent)).rejects.toThrow('dedicated directory')
  })

  it('rejects an older image outside the fixture before reading or operating on a release', async () => {
    const root = await temporary('pipilot-packaged-smoke-linux-')
    const outside = await temporary('linux-canary-image-')
    const image = join(outside, 'Other.AppImage')
    await writeFile(image, 'not an executable')
    await writeFile(join(root, 'canary.json'), JSON.stringify({
      olderAppImage: image, candidateDirectory: outside, version: '0.0.9', feedPort: 4000,
    }))
    await expect(readLinuxCanaryManifest(root)).rejects.toThrow('must belong to the isolated')
  })

  it('never matches unrelated process environment substrings or renderer children as the relaunched main', () => {
    const token = '/tmp/pipilot-packaged-smoke-linux-example/appimage'
    expect(isCanaryProcessEnvironment(`PATH=/bin\0PIPILOT_LINUX_CANARY_TOKEN=${token}\0`, token)).toBe(true)
    expect(isCanaryProcessEnvironment(`PIPILOT_LINUX_CANARY_TOKEN=${token}-unrelated\0`, token)).toBe(false)
    expect(isCanaryProcessEnvironment(`OTHER=PIPILOT_LINUX_CANARY_TOKEN=${token}\0`, token)).toBe(false)
    expect(isCanaryProcessEnvironment('PIPILOT_LINUX_CANARY_TOKEN=\0', '')).toBe(false)
    const main = { pid: 100, executable: '/tmp/.mount_fixture/pipilot', arguments: ['pipilot'], appImage: '/tmp/PiPilot.AppImage' }
    expect(isAppImageMainProcess(main, '/tmp/PiPilot.AppImage')).toBe(true)
    expect(isAppImageMainProcess({ ...main, arguments: ['pipilot', '--type=renderer'] }, '/tmp/PiPilot.AppImage')).toBe(false)
    expect(isAppImageMainProcess(main, '/tmp/Other.AppImage')).toBe(false)
  })

  it('isolates product state and lets only the actual package launcher set AppImage identity', () => {
    const root = join(tmpdir(), 'pipilot-packaged-smoke-linux-example', 'deb')
    const environment = linuxCanaryEnvironment(root, { PI_CODING_AGENT_DIR: join(root, 'agent-data') }, {
      PATH: '/usr/bin', APPIMAGE: '/personal/PiPilot.AppImage', APPDIR: '/personal/app',
      APPIMAGE_EXIT_AFTER_INSTALL: 'true', APPIMAGE_SILENT_INSTALL: 'true',
      APPIMAGE_EXTRACT_AND_RUN: '1', ELECTRON_RUN_AS_NODE: '1',
    })
    expect(environment).toMatchObject({
      PATH: '/usr/bin', PI_CODING_AGENT_DIR: join(root, 'agent-data'),
      PIPILOT_E2E_USER_DATA: join(root, 'user-data'), PIPILOT_LINUX_CANARY_TOKEN: root,
      XDG_CONFIG_HOME: join(root, 'xdg-config'), XDG_CACHE_HOME: join(root, 'xdg-cache'), XDG_DATA_HOME: join(root, 'xdg-data'),
    })
    for (const key of ['APPIMAGE', 'APPDIR', 'APPIMAGE_EXIT_AFTER_INSTALL', 'APPIMAGE_SILENT_INSTALL', 'APPIMAGE_EXTRACT_AND_RUN', 'ELECTRON_RUN_AS_NODE']) {
      expect(environment[key]).toBeUndefined()
    }
  })
})
