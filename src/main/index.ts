import {
  bootstrapMain,
  isConversationMcpStdioInvocation,
} from './bootstrap'

void bootstrapMain().catch((error: unknown) => {
  const isMcp = isConversationMcpStdioInvocation(process.argv)
  const message = error instanceof Error
    ? error.message
    : isMcp
      ? 'Headless startup failed.'
      : 'Application startup failed.'
  process.stderr.write(
    `[${isMcp ? 'PiPilot MCP' : 'PiPilot'}] ${message.slice(0, 512)}\n`,
  )
  process.exitCode = 1
})
