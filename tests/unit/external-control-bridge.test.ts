import { EventEmitter } from 'node:events'
import { chmodSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { access, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createConnection, type Server } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EXTERNAL_CONTROL_MAX_FRAME_BYTES,
  ExternalControlError,
} from '../../src/shared/external-control'
import { ConversationMcpBridgeClient } from '../../src/main/external-control/bridge-client'
import { ConversationMcpBridgeServer } from '../../src/main/external-control/bridge-server'
import { ExternalControlDescriptorRepository } from '../../src/main/external-control/descriptor-repository'
import {
  encodeExternalControlFrame,
  ExternalControlFrameDecoder,
} from '../../src/main/external-control/framing'

const temporaryDirectories: string[] = []

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'pipilot-external-control-test-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })))
})

describe('external-control local bridge', () => {
  it('decodes fragmented and adjacent bounded frames', () => {
    const decoder = new ExternalControlFrameDecoder()
    const first = encodeExternalControlFrame({ value: 1 })
    const second = encodeExternalControlFrame({ value: 2 })
    expect(decoder.push(first.subarray(0, 3))).toEqual([])
    expect(decoder.push(Buffer.concat([first.subarray(3), second]))).toEqual([
      { value: 1 },
      { value: 2 },
    ])

    const largeValue = 'x'.repeat(600 * 1024)
    const adjacentLargeFrames = Buffer.concat([
      encodeExternalControlFrame({ value: largeValue }),
      encodeExternalControlFrame({ value: largeValue }),
    ])
    expect(new ExternalControlFrameDecoder().push(adjacentLargeFrames)).toEqual([
      { value: largeValue },
      { value: largeValue },
    ])

    const oversized = Buffer.alloc(4)
    oversized.writeUInt32BE(EXTERNAL_CONTROL_MAX_FRAME_BYTES + 1)
    expect(() => new ExternalControlFrameDecoder().push(oversized)).toThrow(
      ExternalControlError,
    )
  })

  it('stores a private descriptor and rejects relaxed permissions', () => {
    const directory = temporaryDirectory()
    const filePath = join(directory, 'descriptor.json')
    const repository = new ExternalControlDescriptorRepository(filePath)
    repository.write({
      protocolVersion: 1,
      instanceId: '00000000-0000-4000-8000-000000000001',
      endpoint: join(directory, 'bridge.sock'),
      token: 'a'.repeat(43),
      createdAt: '2026-08-22T00:00:00.000Z',
    })
    expect(repository.read().instanceId).toBe('00000000-0000-4000-8000-000000000001')
    expect(readFileSync(filePath, 'utf8')).not.toContain('prompt')

    if (process.platform !== 'win32') {
      chmodSync(filePath, 0o644)
      expect(() => repository.read()).toThrowError(
        expect.objectContaining({ code: 'authentication_failed' }),
      )
    }
  })

  it('authenticates a client and validates method results', async () => {
    if (process.platform === 'win32') return
    const directory = temporaryDirectory()
    const descriptor = new ExternalControlDescriptorRepository(
      join(directory, 'descriptor.json'),
    )
    const clientCounts: number[] = []
    const server = new ConversationMcpBridgeServer({
      descriptorRepository: descriptor,
      temporaryDirectory: '/tmp',
      onClientCountChanged: (count) => clientCounts.push(count),
      handler(method) {
        if (method !== 'list_conversations') throw new Error('unexpected method')
        return { conversations: [], nextCursor: null, diagnostics: [] }
      },
    })
    await server.start()
    const client = new ConversationMcpBridgeClient(descriptor)
    await client.connect()
    await expect(Promise.all([
      client.call('list_conversations', {}),
      client.call('list_conversations', {}),
    ])).resolves.toEqual(Array.from({ length: 2 }, () => ({
      conversations: [], nextCursor: null, diagnostics: [],
    })))
    expect(clientCounts).toContain(1)
    client.close()
    await server.close()
    expect(clientCounts[clientCounts.length - 1]).toBe(0)
  })

  it('rolls back descriptor and socket directory when listen fails', async () => {
    if (process.platform === 'win32') return
    const directory = temporaryDirectory()
    const descriptor = new ExternalControlDescriptorRepository(
      join(directory, 'descriptor.json'),
    )
    const brokenServer = new EventEmitter() as Server
    brokenServer.listen = vi.fn((..._args: unknown[]) => {
      queueMicrotask(() => brokenServer.emit('error', new Error('listen failed')))
      return brokenServer
    }) as Server['listen']
    brokenServer.close = vi.fn((callback?: (error?: Error) => void) => {
      callback?.()
      return brokenServer
    }) as Server['close']
    const server = new ConversationMcpBridgeServer({
      descriptorRepository: descriptor,
      temporaryDirectory: directory,
      createServer: (() => brokenServer) as typeof import('node:net').createServer,
      handler() {
        return { conversations: [], nextCursor: null, diagnostics: [] }
      },
    })

    await expect(server.start()).rejects.toThrow('listen failed')
    expect(server.currentDescriptor).toBeNull()
    expect(readdirSync(directory)).toEqual([])
    expect(() => descriptor.read()).toThrowError(
      expect.objectContaining({ code: 'pipilot_unavailable' }),
    )
    await server.close()
  })

  it('rolls back a listening server when endpoint permissions fail', async () => {
    if (process.platform === 'win32') return
    const directory = temporaryDirectory()
    const descriptor = new ExternalControlDescriptorRepository(
      join(directory, 'descriptor.json'),
    )
    let endpoint = ''
    let chmodCalls = 0
    const chmod = vi.fn(async (path: string) => {
      chmodCalls += 1
      endpoint = path
      if (chmodCalls === 2) throw new Error('endpoint chmod failed')
    }) as unknown as typeof import('node:fs/promises').chmod
    const server = new ConversationMcpBridgeServer({
      descriptorRepository: descriptor,
      temporaryDirectory: '/tmp',
      chmod,
      handler() {
        return { conversations: [], nextCursor: null, diagnostics: [] }
      },
    })

    await expect(server.start()).rejects.toThrow('endpoint chmod failed')
    expect(server.currentDescriptor).toBeNull()
    await expect(access(endpoint)).rejects.toBeDefined()
    await expect(access(dirname(endpoint))).rejects.toBeDefined()
    expect(readdirSync(directory)).toEqual([])
  })

  it('rolls back a listening server when descriptor publication fails', async () => {
    if (process.platform === 'win32') return
    const directory = temporaryDirectory()
    const descriptor = new ExternalControlDescriptorRepository(
      join(directory, 'descriptor.json'),
    )
    let endpoint = ''
    vi.spyOn(descriptor, 'write').mockImplementation((value) => {
      endpoint = value.endpoint
      throw new Error('descriptor write failed')
    })
    const server = new ConversationMcpBridgeServer({
      descriptorRepository: descriptor,
      temporaryDirectory: '/tmp',
      handler() {
        return { conversations: [], nextCursor: null, diagnostics: [] }
      },
    })

    await expect(server.start()).rejects.toThrow('descriptor write failed')
    expect(server.currentDescriptor).toBeNull()
    await expect(access(endpoint)).rejects.toBeDefined()
    await expect(access(dirname(endpoint))).rejects.toBeDefined()
    expect(readdirSync(directory)).toEqual([])
  })

  it('closes clients and socket state when descriptor removal fails', async () => {
    if (process.platform === 'win32') return
    const directory = temporaryDirectory()
    const descriptor = new ExternalControlDescriptorRepository(
      join(directory, 'descriptor.json'),
    )
    const originalRemove = descriptor.remove.bind(descriptor)
    vi.spyOn(descriptor, 'remove').mockImplementation((instanceId) => {
      if (instanceId) throw new Error('descriptor remove failed')
      return originalRemove(instanceId)
    })
    const server = new ConversationMcpBridgeServer({
      descriptorRepository: descriptor,
      temporaryDirectory: '/tmp',
      handler() {
        return { conversations: [], nextCursor: null, diagnostics: [] }
      },
    })
    const active = await server.start()
    const client = new ConversationMcpBridgeClient(descriptor)
    await client.connect()
    const disconnected = new Promise<void>((resolve) => {
      client.subscribeDisconnect(resolve)
    })

    await expect(server.close()).rejects.toThrow('descriptor remove failed')
    await disconnected
    expect(server.connectedClients).toBe(0)
    await expect(access(active.endpoint)).rejects.toBeDefined()
    await expect(access(dirname(active.endpoint))).rejects.toBeDefined()
    client.close()
  })

  it('times out unauthenticated sockets without counting them as clients', async () => {
    if (process.platform === 'win32') return
    const directory = temporaryDirectory()
    const descriptor = new ExternalControlDescriptorRepository(
      join(directory, 'descriptor.json'),
    )
    const clientCounts: number[] = []
    const server = new ConversationMcpBridgeServer({
      descriptorRepository: descriptor,
      temporaryDirectory: '/tmp',
      handshakeTimeoutMs: 20,
      onClientCountChanged: (count) => clientCounts.push(count),
      handler() {
        return { conversations: [], nextCursor: null, diagnostics: [] }
      },
    })
    const active = await server.start()
    const socket = createConnection(active.endpoint)
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve)
      socket.once('error', reject)
    })
    expect(server.connectedClients).toBe(0)
    expect(clientCounts).not.toContain(1)
    await new Promise<void>((resolve) => socket.once('close', resolve))
    expect(server.connectedClients).toBe(0)

    const authenticated = new ConversationMcpBridgeClient(descriptor)
    await authenticated.connect()
    expect(server.connectedClients).toBe(1)
    expect(clientCounts).toContain(1)
    authenticated.close()
    await server.close()
  })

  it('rejects a descriptor with a stale token without invoking the handler', async () => {
    if (process.platform === 'win32') return
    const directory = temporaryDirectory()
    const descriptor = new ExternalControlDescriptorRepository(
      join(directory, 'descriptor.json'),
    )
    let invoked = false
    const server = new ConversationMcpBridgeServer({
      descriptorRepository: descriptor,
      temporaryDirectory: '/tmp',
      handler() {
        invoked = true
        return { conversations: [], nextCursor: null, diagnostics: [] }
      },
    })
    const active = await server.start()
    descriptor.write({ ...active, token: 'b'.repeat(43) })
    const client = new ConversationMcpBridgeClient(descriptor)
    await expect(client.connect(100)).rejects.toMatchObject({
      code: 'pipilot_unavailable',
    })
    expect(invoked).toBe(false)
    await server.close()
  })
})
