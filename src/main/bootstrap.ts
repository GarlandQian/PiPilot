import { createReadStream } from 'node:fs'
import { basename, join, win32 } from 'node:path'
import { PassThrough, type Readable } from 'node:stream'
import { resolveTestUserDataOverride } from './application-storage'

const MCP_STDIO_FLAG = '--pipilot-mcp-stdio'

interface BootstrapApp {
  exit(exitCode?: number): void
  getPath(name: 'userData'): string
  getVersion(): string
  readonly isPackaged: boolean
  setPath(name: 'userData', path: string): void
  whenReady(): Promise<void>
  quit(): void
  setActivationPolicy(policy: 'prohibited'): void
}

export interface MainBootstrapDependencies {
  environment?: NodeJS.ProcessEnv
  executablePath?: string
  platform?: NodeJS.Platform
  stdin?: Readable
  importElectron?: () => Promise<{ app: BootstrapApp }>
  importGuiMain?: () => Promise<unknown>
  importMcpStdio?: () => Promise<{
    runConversationMcpStdio(
      argv: string[],
      options: {
        descriptorPath: string
        requireNoArguments?: boolean
        serverVersion: string
        input?: PassThrough
      },
    ): Promise<number>
  }>
  setExitCode?: (exitCode: number) => void
}

export function isConversationMcpStdioInvocation(
  argv: string[],
  platform: NodeJS.Platform = process.platform,
  executablePath: string = process.execPath,
) {
  if (argv.includes(MCP_STDIO_FLAG)) return true
  const executableName = platform === 'win32'
    ? win32.basename(executablePath).toLocaleLowerCase('en-US')
    : basename(executablePath)
  return platform === 'win32' && executableName === 'pipilot-mcp.exe'
}

function isWindowsPublicLauncher(
  platform: NodeJS.Platform,
  executablePath: string,
) {
  return platform === 'win32' &&
    win32.basename(executablePath).toLocaleLowerCase('en-US') === 'pipilot-mcp.exe'
}

function publicLauncherArguments(argv: string[], executablePath: string) {
  const first = argv[0]
  if (
    first &&
    win32.normalize(first).toLocaleLowerCase('en-US') ===
      win32.normalize(executablePath).toLocaleLowerCase('en-US')
  ) {
    return argv.slice(1)
  }
  return argv
}

export async function bootstrapMain(
  argv = process.argv,
  dependencies: MainBootstrapDependencies = {},
) {
  const platform = dependencies.platform ?? process.platform
  const executablePath = dependencies.executablePath ?? process.execPath
  if (!isConversationMcpStdioInvocation(
    argv,
    platform,
    executablePath,
  )) {
    await (dependencies.importGuiMain ?? (() => import('./gui-main')))()
    return
  }

  const { app } = await (
    dependencies.importElectron ?? (() => import('electron'))
  )()
  const environment = dependencies.environment ?? process.env
  const publicWindowsLauncher = isWindowsPublicLauncher(platform, executablePath)
  const stdioArgv = publicWindowsLauncher
    ? publicLauncherArguments(argv, executablePath)
    : argv
  const testUserDataOverride = resolveTestUserDataOverride({
    candidate: environment.PIPILOT_E2E_USER_DATA,
    isPackaged: app.isPackaged,
    packagedSmoke: environment.PIPILOT_PACKAGED_SMOKE,
  })
  if (testUserDataOverride) app.setPath('userData', testUserDataOverride)
  // Electron's Windows bootstrap can take long enough for an MCP client to
  // send its initialize frame before `app.whenReady()` resolves. Start
  // reading stdin immediately so that the OS pipe is buffered instead of
  // losing the first request while the headless app is starting.
  const bufferedInput = new PassThrough()
  // Electron's Windows console launcher inherits the MCP pipe as fd 0, but
  // its process.stdin wrapper is not consistently wired to that handle while
  // the browser process is bootstrapping. Read the inherited descriptor
  // directly so the first JSON-RPC frame cannot be stranded in Electron's
  // wrapper. Tests and non-Windows launches keep their injected/standard
  // stream so this fallback stays platform-local.
  const useDirectWindowsStdin = process.platform === 'win32' &&
    platform === 'win32' &&
    dependencies.stdin === undefined
  const sourceInput = dependencies.stdin ?? (
    useDirectWindowsStdin
      ? createReadStream('NUL', { fd: 0, autoClose: false })
      : process.stdin
  )
  sourceInput.pipe(bufferedInput)
  if (useDirectWindowsStdin) sourceInput.resume()
  if (platform === 'darwin') {
    app.setActivationPolicy('prohibited')
  }
  try {
    const { runConversationMcpStdio } = await (
      dependencies.importMcpStdio ?? (() => import('./external-control/mcp-stdio'))
    )()
    // The stdio child only talks to the already-running GUI bridge. Waiting
    // for Electron's browser readiness adds a large cold-start delay on
    // Windows and is unnecessary because this path never creates a window.
    const exitCode = await runConversationMcpStdio(stdioArgv, {
      descriptorPath: (platform === 'win32' ? win32.join : join)(
        app.getPath('userData'),
        'external-control',
        'descriptor.json',
      ),
      requireNoArguments: publicWindowsLauncher,
      serverVersion: app.getVersion(),
      input: bufferedInput,
    })
    ;(dependencies.setExitCode ?? ((code) => { process.exitCode = code }))(exitCode)
    app.exit(exitCode)
  } catch (error) {
    app.quit()
    throw error
  }
}
