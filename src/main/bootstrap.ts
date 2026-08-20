import { PIPILOT_VERSION } from '../shared/build-info'

const MCP_STDIO_FLAG = '--pipilot-mcp-stdio'

interface BootstrapApp {
  exit(exitCode?: number): void
  getVersion(): string
  whenReady(): Promise<void>
  quit(): void
  setActivationPolicy(policy: 'prohibited'): void
}

export interface MainBootstrapDependencies {
  platform?: NodeJS.Platform
  importElectron?: () => Promise<{ app: BootstrapApp }>
  importGuiMain?: () => Promise<unknown>
  importMcpStdio?: () => Promise<{
    runConversationMcpStdio(
      argv: string[],
      options: { serverVersion: string },
    ): Promise<number>
  }>
  runAsNode?: boolean
  setExitCode?: (exitCode: number) => void
}

export function isConversationMcpStdioInvocation(argv: string[]) {
  return argv.includes(MCP_STDIO_FLAG)
}

export async function bootstrapMain(
  argv = process.argv,
  dependencies: MainBootstrapDependencies = {},
) {
  if (!isConversationMcpStdioInvocation(argv)) {
    await (dependencies.importGuiMain ?? (() => import('./gui-main')))()
    return
  }

  const runAsNode = dependencies.runAsNode ?? process.env.ELECTRON_RUN_AS_NODE === '1'
  if (runAsNode) {
    const { runConversationMcpStdio } = await (
      dependencies.importMcpStdio ?? (() => import('./external-control/mcp-stdio'))
    )()
    const exitCode = await runConversationMcpStdio(argv, {
      serverVersion: PIPILOT_VERSION,
    })
    ;(dependencies.setExitCode ?? ((code) => { process.exitCode = code }))(exitCode)
    return
  }

  const { app } = await (
    dependencies.importElectron ?? (() => import('electron'))
  )()
  if ((dependencies.platform ?? process.platform) === 'darwin') {
    app.setActivationPolicy('prohibited')
  }
  try {
    await app.whenReady()
    const { runConversationMcpStdio } = await (
      dependencies.importMcpStdio ?? (() => import('./external-control/mcp-stdio'))
    )()
    const exitCode = await runConversationMcpStdio(argv, {
      serverVersion: app.getVersion(),
    })
    ;(dependencies.setExitCode ?? ((code) => { process.exitCode = code }))(exitCode)
    app.exit(exitCode)
  } catch (error) {
    app.quit()
    throw error
  }
}
