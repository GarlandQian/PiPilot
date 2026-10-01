import { readFile, readdir, readlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface LinuxCanaryManifest {
  candidateDirectory: string
  version: string
  feedPort: number
  olderAppImage: string
}

export function isLinuxCanaryRunner(environment = process.env, platform = process.platform, architecture = process.arch) {
  return platform === 'linux' && architecture === 'x64'
    && environment.GITHUB_ACTIONS === 'true' && environment.CI === 'true'
    && environment.RUNNER_ENVIRONMENT === 'github-hosted'
}

export async function validateLinuxCanaryRoot(candidate: string, temporaryDirectory = tmpdir()) {
  const [root, temporary] = await Promise.all([realpath(candidate), realpath(temporaryDirectory)])
  if (dirname(root) !== temporary || !/^pipilot-packaged-smoke-linux-[\w-]+$/u.test(basename(root))) {
    throw new Error('Linux canary root must be a dedicated directory directly inside the system temporary directory.')
  }
  return root
}

export async function readLinuxCanaryManifest(root: string): Promise<LinuxCanaryManifest> {
  const value = JSON.parse(await readFile(join(root, 'canary.json'), 'utf8')) as LinuxCanaryManifest
  if (!/^\d+\.\d+\.\d+$/u.test(value.version) || value.version === '0.0.0'
    || !Number.isInteger(value.feedPort) || value.feedPort < 1 || value.feedPort > 65_535) {
    throw new Error('Invalid Linux canary version or loopback feed port.')
  }
  const olderAppImage = await realpath(value.olderAppImage)
  const child = relative(root, olderAppImage)
  if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child) || !olderAppImage.endsWith('.AppImage')) {
    throw new Error('Older AppImage must belong to the isolated Linux canary directory.')
  }
  const candidateDirectory = await realpath(value.candidateDirectory)
  if (candidateDirectory !== await realpath(resolve('release'))) {
    throw new Error('Linux canary must use this checkout’s exact release candidate directory.')
  }
  return { ...value, candidateDirectory, olderAppImage }
}

export function linuxCanaryEnvironment(root: string, fixture: NodeJS.ProcessEnv, inherited = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...inherited, ...fixture,
    PIPILOT_PACKAGED_SMOKE: '1',
    PIPILOT_E2E_USER_DATA: join(root, 'user-data'),
    PIPILOT_LINUX_CANARY_TOKEN: root,
    XDG_CONFIG_HOME: join(root, 'xdg-config'),
    XDG_CACHE_HOME: join(root, 'xdg-cache'),
    XDG_DATA_HOME: join(root, 'xdg-data'),
  }
  // Package identity must come from the real launcher, including for DEB.
  for (const key of ['APPIMAGE', 'APPDIR', 'APPIMAGE_EXIT_AFTER_INSTALL', 'APPIMAGE_SILENT_INSTALL', 'APPIMAGE_EXTRACT_AND_RUN', 'ELECTRON_RUN_AS_NODE']) delete environment[key]
  return environment
}

export interface LinuxCanaryProcess {
  pid: number
  executable: string
  arguments: string[]
  appImage: string | undefined
}

export function isCanaryProcessEnvironment(contents: string, token: string) {
  return token.length > 0 && contents.split('\0').includes(`PIPILOT_LINUX_CANARY_TOKEN=${token}`)
}

export async function linuxCanaryProcesses(token: string): Promise<LinuxCanaryProcess[]> {
  const entries = await readdir('/proc')
  const processes = await Promise.all(entries.filter((entry) => /^\d+$/u.test(entry)).map(async (entry) => {
    try {
      const environment = await readFile(`/proc/${entry}/environ`, 'utf8')
      if (!isCanaryProcessEnvironment(environment, token)) return null
      const [executable, commandLine] = await Promise.all([
        readlink(`/proc/${entry}/exe`), readFile(`/proc/${entry}/cmdline`, 'utf8'),
      ])
      return {
        pid: Number(entry), executable, arguments: commandLine.split('\0').filter(Boolean),
        appImage: environment.split('\0').find((item) => item.startsWith('APPIMAGE='))?.slice('APPIMAGE='.length),
      }
    } catch { return null } // Other users and processes that exited are outside this fixture.
  }))
  return processes.filter((entry): entry is LinuxCanaryProcess => entry !== null)
}

export function isAppImageMainProcess(entry: LinuxCanaryProcess, appImage: string) {
  const executableIsAppImage = entry.executable === appImage || entry.executable === `${appImage} (deleted)`
  return entry.appImage === appImage && (executableIsAppImage || basename(entry.executable) === 'pipilot')
    && !entry.arguments.some((argument) => argument.startsWith('--type='))
    && !entry.arguments.some((argument) => /(?:^|[/\\])pi-management-helper\.js$/u.test(argument))
}
