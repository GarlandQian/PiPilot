import { isAbsolute } from 'node:path'
import { PassThrough, type Readable, type Writable } from 'node:stream'
import { StdioServerTransport, serveStdio } from '@modelcontextprotocol/server/stdio'
import {
  EXTERNAL_CONTROL_MAX_FRAME_BYTES,
  EXTERNAL_CONTROL_STDIO_IDLE_TIMEOUT_MS,
  EXTERNAL_CONTROL_STDIO_STARTUP_TIMEOUT_MS,
  ExternalControlError,
} from '../../shared/external-control'
import { ConversationMcpBridgeClient } from './bridge-client'
import { ExternalControlDescriptorRepository } from './descriptor-repository'
import {
  createConversationMcpServer,
  type ExternalControlBridgeCaller,
} from './mcp-server'

const DESCRIPTOR_FLAG = '--descriptor'

export interface ConversationMcpStdioOptions {
  input?: Readable
  output?: Writable
  errorOutput?: Pick<NodeJS.WriteStream, 'write'>
  startupTimeoutMs?: number
  idleTimeoutMs?: number
  serverVersion?: string
  createClient?: (
    repository: ExternalControlDescriptorRepository,
  ) => ConversationMcpBridgeClient
}

export function parseConversationMcpDescriptorPath(argv: string[]) {
  const indexes = argv.flatMap((value, index) =>
    value === DESCRIPTOR_FLAG ? [index] : [])
  if (indexes.length !== 1) {
    throw new ExternalControlError(
      'invalid_state',
      'The PiPilot MCP descriptor argument is required.',
    )
  }
  const descriptorPath = argv[indexes[0]! + 1]
  if (
    !descriptorPath ||
    descriptorPath.includes('\0') ||
    !isAbsolute(descriptorPath)
  ) {
    throw new ExternalControlError(
      'invalid_state',
      'The PiPilot MCP descriptor path is invalid.',
    )
  }
  return descriptorPath
}

export async function runConversationMcpStdio(
  argv: string[],
  options: ConversationMcpStdioOptions = {},
) {
  const errorOutput = options.errorOutput ?? process.stderr
  const sourceInput = options.input ?? process.stdin
  // Buffer the child-side pipe while the authenticated local bridge is being
  // established. Windows Electron can otherwise consume stdin before the MCP
  // transport installs its JSON-RPC reader.
  const input = new PassThrough()
  sourceInput.pipe(input)
  const discardInput = () => {
    sourceInput.unpipe(input)
    sourceInput.pause()
    input.destroy()
  }
  let client: ConversationMcpBridgeClient | null = null
  try {
    const descriptorPath = parseConversationMcpDescriptorPath(argv)
    const repository = new ExternalControlDescriptorRepository(descriptorPath)
    client = (options.createClient ?? ((descriptor) =>
      new ConversationMcpBridgeClient(descriptor)))(repository)
    await client.connect(
      options.startupTimeoutMs ?? EXTERNAL_CONTROL_STDIO_STARTUP_TIMEOUT_MS,
    )
  } catch {
    errorOutput.write('[PiPilot MCP] PiPilot External Control is unavailable.\n')
    client?.close()
    discardInput()
    return 1
  }

  const output = options.output ?? process.stdout
  const transport = new StdioServerTransport(input, output, {
    maxBufferSize: EXTERNAL_CONTROL_MAX_FRAME_BYTES,
  })
  let finish!: (exitCode: number) => void
  const finished = new Promise<number>((resolve) => {
    finish = resolve
  })
  let closing = false
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let handle: ReturnType<typeof serveStdio> | null = null
  let unsubscribeDisconnect = () => false
  let receivedInput = false
  const markInputReceived = () => { receivedInput = true }

  const close = (exitCode: number) => {
    if (closing) return
    closing = true
    if (idleTimer) clearTimeout(idleTimer)
    input.off('data', markInputReceived)
    input.off('end', onInputClosed)
    discardInput()
    unsubscribeDisconnect()
    client?.close()
    if (handle) void handle.close().finally(() => finish(exitCode))
    else finish(exitCode)
  }
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(
      () => close(0),
      options.idleTimeoutMs ?? EXTERNAL_CONTROL_STDIO_IDLE_TIMEOUT_MS,
    )
    idleTimer.unref()
  }
  const bridge: ExternalControlBridgeCaller = {
    call: async (method, params) => {
      resetIdleTimer()
      return client!.call(method, params)
    },
  }
  const onInputClosed = () => {
    // Electron on Windows can report an inherited stdin pipe as ended before
    // the first buffered request is delivered. Keep the server alive until
    // the stream has carried protocol data; the idle timer still reaps an
    // abandoned process.
    if (!receivedInput) return
    close(0)
  }
  input.on('data', markInputReceived)
  input.once('end', onInputClosed)
  resetIdleTimer()
  handle = serveStdio(() => createConversationMcpServer(
    bridge,
    options.serverVersion,
  ), {
    transport,
    onerror: () => close(1),
  })
  unsubscribeDisconnect = client.subscribeDisconnect(() => close(1))
  return finished
}
