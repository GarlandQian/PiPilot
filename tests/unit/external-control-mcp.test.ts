import { mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import {
  InMemoryTransport,
  LATEST_PROTOCOL_VERSION,
  type JSONRPCMessage,
} from '@modelcontextprotocol/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConversationMcpBridgeServer } from '../../src/main/external-control/bridge-server'
import { ExternalControlDescriptorRepository } from '../../src/main/external-control/descriptor-repository'
import { createConversationMcpServer } from '../../src/main/external-control/mcp-server'
import {
  parseConversationMcpDescriptorPath,
  runConversationMcpStdio,
} from '../../src/main/external-control/mcp-stdio'
import type { ExternalControlBridgeMethod } from '../../src/shared/external-control'
import { PIPILOT_VERSION } from '../../src/shared/build-info'

const conversationId = `conv_${'m'.repeat(43)}`
const operationId = `op_${'o'.repeat(43)}`
const timestamp = '2026-08-22T00:00:00.000Z'
const temporaryDirectories: string[] = []

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'pipilot-mcp-test-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })))
})

function resultFor(method: ExternalControlBridgeMethod) {
  const conversation = {
    conversationId,
    createdAt: timestamp,
    modifiedAt: timestamp,
    lifecycle: 'idle' as const,
    queueCount: 0,
  }
  const receipt = {
    operationId,
    conversationId,
    kind: method === 'abort_conversation'
      ? 'abort_conversation' as const
      : 'send_prompt' as const,
    ...(method === 'send_prompt' ? { requestedMode: 'auto' as const } : {}),
    status: 'received' as const,
    receivedAt: timestamp,
  }
  const operation = {
    ...receipt,
    updatedAt: timestamp,
  }
  switch (method) {
    case 'list_conversations':
      return { conversations: [conversation], nextCursor: null, diagnostics: [] }
    case 'get_conversation_status':
      return { conversation }
    case 'send_prompt':
    case 'abort_conversation':
      return receipt
    case 'get_operation':
      return { operation }
    case 'wait_for_turn':
      return { reached: false, timedOut: true, operation }
  }
}

class InMemoryMcpClient {
  private readonly messages: JSONRPCMessage[] = []
  private readonly waiters = new Set<() => void>()

  constructor(readonly transport: InMemoryTransport) {
    transport.onmessage = (message) => {
      this.messages.push(message)
      for (const waiter of this.waiters) waiter()
      this.waiters.clear()
    }
  }

  async request(id: number, method: string, params?: Record<string, unknown>) {
    await this.transport.send({
      jsonrpc: '2.0',
      id,
      method,
      ...(params ? { params } : {}),
    })
    return this.waitFor((message) => 'id' in message && message.id === id)
  }

  notify(method: string, params?: Record<string, unknown>) {
    return this.transport.send({
      jsonrpc: '2.0',
      method,
      ...(params ? { params } : {}),
    })
  }

  private async waitFor(predicate: (message: JSONRPCMessage) => boolean) {
    for (;;) {
      const index = this.messages.findIndex(predicate)
      if (index >= 0) return this.messages.splice(index, 1)[0]!
      await new Promise<void>((resolve) => this.waiters.add(resolve))
    }
  }
}

describe('official conversation MCP server', () => {
  it('registers exactly the six bounded tools and dispatches each bridge method', async () => {
    const calls: Array<{ method: ExternalControlBridgeMethod; params: unknown }> = []
    const server = createConversationMcpServer({
      async call(method, params) {
        calls.push({ method, params: structuredClone(params) })
        return resultFor(method)
      },
    })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new InMemoryMcpClient(clientTransport)
    await clientTransport.start()
    await server.connect(serverTransport)

    const initialized = await client.request(1, 'initialize', {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'PiPilot test', version: '1.0.0' },
    })
    expect(initialized).toHaveProperty('result.serverInfo.name', 'pipilot-conversations')
    expect(initialized).toHaveProperty('result.serverInfo.version', PIPILOT_VERSION)
    await client.notify('notifications/initialized')
    const listed = await client.request(2, 'tools/list')
    const tools = 'result' in listed && listed.result &&
      typeof listed.result === 'object' && 'tools' in listed.result
      ? listed.result.tools
      : []
    expect(Array.isArray(tools) ? tools.map((tool) =>
      typeof tool === 'object' && tool && 'name' in tool ? tool.name : null) : [])
      .toEqual([
        'list_conversations',
        'get_conversation_status',
        'send_prompt',
        'abort_conversation',
        'get_operation',
        'wait_for_turn',
      ])

    const inputs: Record<ExternalControlBridgeMethod, Record<string, unknown>> = {
      list_conversations: { limit: 10 },
      get_conversation_status: { conversationId },
      send_prompt: {
        conversationId,
        prompt: 'Run the MCP operation.',
        mode: 'auto',
        idempotencyKey: 'mcp-send',
      },
      abort_conversation: { conversationId, idempotencyKey: 'mcp-abort' },
      get_operation: { operationId },
      wait_for_turn: { operationId, until: 'terminal', timeoutMs: 5 },
    }
    let requestId = 10
    for (const method of Object.keys(inputs) as ExternalControlBridgeMethod[]) {
      const response = await client.request(requestId++, 'tools/call', {
        name: method,
        arguments: inputs[method],
      })
      expect(response).not.toHaveProperty('error')
      expect(response).not.toHaveProperty('result.isError', true)
    }
    expect(calls.map((call) => call.method)).toEqual(
      Object.keys(inputs),
    )

    await clientTransport.close()
    await server.close()
  })

  it('serves discovery through stdio and the authenticated local bridge', async () => {
    if (process.platform === 'win32') return
    const directory = temporaryDirectory()
    const descriptorPath = join(directory, 'descriptor.json')
    const descriptor = new ExternalControlDescriptorRepository(descriptorPath)
    const bridge = new ConversationMcpBridgeServer({
      descriptorRepository: descriptor,
      temporaryDirectory: directory,
      handler(method) {
        return resultFor(method)
      },
    })
    await bridge.start()
    const input = new PassThrough()
    const output = new PassThrough()
    let outputBuffer = ''
    const lines: string[] = []
    output.on('data', (chunk: Buffer) => {
      outputBuffer += chunk.toString('utf8')
      const parts = outputBuffer.split('\n')
      outputBuffer = parts.pop() ?? ''
      lines.push(...parts.filter(Boolean))
    })
    const run = runConversationMcpStdio([
      '/Applications/PiPilot',
      '--pipilot-mcp-stdio',
      '--descriptor',
      descriptorPath,
    ], { input, output, idleTimeoutMs: 10_000 })
    // A Windows child stdin can emit `close` while the pipe is still usable.
    // The protocol must wait for actual request data before shutting down.
    input.emit('close')
    input.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'stdio test', version: '1.0.0' },
      },
    })}\n`)
    await vi.waitFor(() => {
      expect(lines.map((line) => JSON.parse(line) as unknown)).toContainEqual(
        expect.objectContaining({ id: 1, result: expect.any(Object) }),
      )
    })
    input.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })}\n`)
    input.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    })}\n`)
    await vi.waitFor(() => {
      const messages = lines.map((line) => JSON.parse(line) as {
        id?: number
        result?: { tools?: unknown[] }
      })
      expect(messages.find((message) => message.id === 2)?.result?.tools).toHaveLength(6)
    })

    input.end()
    await expect(run).resolves.toBe(0)
    await bridge.close()
  })

  it('requires one absolute descriptor path and fails unavailable without stdout', async () => {
    expect(() => parseConversationMcpDescriptorPath([
      '--pipilot-mcp-stdio',
    ])).toThrowError(expect.objectContaining({ code: 'invalid_state' }))
    expect(() => parseConversationMcpDescriptorPath([
      '--descriptor',
      'relative.json',
    ])).toThrowError(expect.objectContaining({ code: 'invalid_state' }))
    expect(() => parseConversationMcpDescriptorPath([
      '--descriptor',
      `${join(temporaryDirectory(), 'descriptor.json')}\0suffix`,
    ])).toThrowError(expect.objectContaining({ code: 'invalid_state' }))

    const output = new PassThrough()
    const errorOutput = { write: vi.fn(() => true) }
    await expect(runConversationMcpStdio([
      '--descriptor',
      join(temporaryDirectory(), 'missing.json'),
    ], { output, errorOutput, startupTimeoutMs: 5 })).resolves.toBe(1)
    expect(output.readableLength).toBe(0)
    expect(errorOutput.write).toHaveBeenCalledWith(
      '[PiPilot MCP] PiPilot External Control is unavailable.\n',
    )
  })
})
