import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server, type Socket } from 'node:net'
import {
  EXTERNAL_CONTROL_MAX_CLIENTS,
  EXTERNAL_CONTROL_MAX_IN_FLIGHT_PER_CLIENT,
  EXTERNAL_CONTROL_BRIDGE_HANDSHAKE_TIMEOUT_MS,
  EXTERNAL_CONTROL_PROTOCOL_VERSION,
  ExternalControlError,
  externalControlBridgeHelloAckSchema,
  externalControlBridgeHelloSchema,
  externalControlBridgeRequestSchema,
  externalControlBridgeResponseSchema,
  externalControlDescriptorSchema,
  parseExternalControlMethodParams,
  parseExternalControlMethodResult,
  sanitizeExternalControlError,
  type ExternalControlBridgeMethod,
  type ExternalControlDescriptor,
} from '../../shared/external-control'
import type { ExternalControlDescriptorRepository } from './descriptor-repository'
import { encodeExternalControlFrame, ExternalControlFrameDecoder } from './framing'

export type ExternalControlBridgeHandler = (
  method: ExternalControlBridgeMethod,
  params: unknown,
  signal: AbortSignal,
) => unknown | Promise<unknown>

export interface ConversationMcpBridgeServerOptions {
  descriptorRepository: ExternalControlDescriptorRepository
  handler: ExternalControlBridgeHandler
  platform?: NodeJS.Platform
  temporaryDirectory?: string
  createId?: () => string
  createToken?: () => string
  onClientCountChanged?: (count: number) => void
  createServer?: typeof createServer
  chmod?: typeof chmod
  handshakeTimeoutMs?: number
}

interface ClientState {
  socket: Socket
  decoder: ExternalControlFrameDecoder
  authenticated: boolean
  inFlight: Map<string, AbortController>
  handshakeTimer: ReturnType<typeof setTimeout> | null
}

function tokensMatch(left: string, right: string) {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
}

export class ConversationMcpBridgeServer {
  private readonly platform: NodeJS.Platform
  private readonly temporaryDirectory: string
  private readonly createId: () => string
  private readonly createToken: () => string
  private readonly chmodPath: typeof chmod
  private readonly handshakeTimeoutMs: number
  private readonly clients = new Set<ClientState>()
  private server: Server | null = null
  private startPromise: Promise<ExternalControlDescriptor> | null = null
  private descriptor: ExternalControlDescriptor | null = null
  private socketDirectory: string | null = null

  constructor(private readonly options: ConversationMcpBridgeServerOptions) {
    this.platform = options.platform ?? process.platform
    this.temporaryDirectory = options.temporaryDirectory ??
      (this.platform === 'darwin' ? '/tmp' : tmpdir())
    this.createId = options.createId ?? randomUUID
    this.createToken = options.createToken ?? (() => randomBytes(32).toString('base64url'))
    this.chmodPath = options.chmod ?? chmod
    this.handshakeTimeoutMs = Math.max(
      1,
      options.handshakeTimeoutMs ?? EXTERNAL_CONTROL_BRIDGE_HANDSHAKE_TIMEOUT_MS,
    )
  }

  get connectedClients() {
    let count = 0
    for (const client of this.clients) {
      if (client.authenticated) count += 1
    }
    return count
  }

  get currentDescriptor() {
    return this.descriptor ? structuredClone(this.descriptor) : null
  }

  async start() {
    if (this.server && this.descriptor) return structuredClone(this.descriptor)
    if (this.startPromise) return structuredClone(await this.startPromise)
    const pending = this.openServer()
    this.startPromise = pending
    try {
      return structuredClone(await pending)
    } finally {
      if (this.startPromise === pending) this.startPromise = null
    }
  }

  private async openServer() {
    this.options.descriptorRepository.remove()
    const instanceId = this.createId()
    let endpoint: string
    try {
      if (this.platform === 'win32') {
        endpoint = `\\\\.\\pipe\\pipilot-${this.createId()}`
      } else {
        this.socketDirectory = await mkdtemp(join(this.temporaryDirectory, 'pipilot-mcp-'))
        await this.chmodPath(this.socketDirectory, 0o700)
        endpoint = join(this.socketDirectory, 'bridge.sock')
      }
    } catch (error) {
      await this.removeSocketDirectory()
      throw error
    }
    const token = this.createToken()
    let server: Server | null = null
    try {
      const createdServer = (this.options.createServer ?? createServer)(
        (socket) => this.accept(socket, instanceId, token),
      )
      server = createdServer
      this.server = server
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          createdServer.off('listening', onListening)
          reject(error)
        }
        const onListening = () => {
          createdServer.off('error', onError)
          resolve()
        }
        createdServer.once('error', onError)
        createdServer.once('listening', onListening)
        if (this.platform === 'win32') {
          createdServer.listen({ path: endpoint, readableAll: false, writableAll: false })
        } else {
          createdServer.listen(endpoint)
        }
      })
      if (this.platform !== 'win32') await this.chmodPath(endpoint, 0o600)
      const descriptor = externalControlDescriptorSchema.parse({
        protocolVersion: EXTERNAL_CONTROL_PROTOCOL_VERSION,
        instanceId,
        endpoint,
        token,
        createdAt: new Date().toISOString(),
      })
      this.options.descriptorRepository.write(descriptor)
      this.descriptor = descriptor
      return structuredClone(descriptor)
    } catch (error) {
      try {
        await this.close()
      } catch {
        // Preserve the acquire failure after exhausting rollback steps.
      }
      throw error
    }
  }

  async close() {
    const descriptor = this.descriptor
    this.descriptor = null
    let failure: unknown
    try {
      this.options.descriptorRepository.remove(descriptor?.instanceId)
    } catch (error) {
      failure = error
    }
    for (const client of this.clients) {
      if (client.handshakeTimer) clearTimeout(client.handshakeTimer)
      client.handshakeTimer = null
      for (const controller of client.inFlight.values()) controller.abort()
      client.socket.destroy()
    }
    this.clients.clear()
    this.options.onClientCountChanged?.(0)
    const server = this.server
    this.server = null
    if (server) {
      try {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve())
        })
      } catch (error) {
        failure ??= error
      }
    }
    try {
      await this.removeSocketDirectory()
    } catch (error) {
      failure ??= error
    }
    if (failure) throw failure
  }

  private async removeSocketDirectory() {
    const socketDirectory = this.socketDirectory
    this.socketDirectory = null
    if (socketDirectory) await rm(socketDirectory, { recursive: true, force: true })
  }

  private accept(socket: Socket, instanceId: string, token: string) {
    if (this.clients.size >= EXTERNAL_CONTROL_MAX_CLIENTS) {
      socket.destroy()
      return
    }
    const client: ClientState = {
      socket,
      decoder: new ExternalControlFrameDecoder(),
      authenticated: false,
      inFlight: new Map(),
      handshakeTimer: null,
    }
    this.clients.add(client)
    client.handshakeTimer = setTimeout(() => socket.destroy(), this.handshakeTimeoutMs)
    client.handshakeTimer.unref()
    const detach = () => {
      if (!this.clients.delete(client)) return
      if (client.handshakeTimer) clearTimeout(client.handshakeTimer)
      client.handshakeTimer = null
      for (const controller of client.inFlight.values()) controller.abort()
      client.inFlight.clear()
      if (client.authenticated) {
        this.options.onClientCountChanged?.(this.connectedClients)
      }
    }
    socket.once('close', detach)
    socket.on('error', () => socket.destroy())
    socket.on('data', (chunk) => {
      try {
        for (const frame of client.decoder.push(
          typeof chunk === 'string' ? Buffer.from(chunk) : chunk,
        )) {
          if (!client.authenticated) {
            const hello = externalControlBridgeHelloSchema.parse(frame)
            if (
              hello.instanceId !== instanceId ||
              !tokensMatch(hello.token, token)
            ) {
              throw new ExternalControlError(
                'authentication_failed',
                'External-control authentication failed.',
              )
            }
            client.authenticated = true
            if (client.handshakeTimer) clearTimeout(client.handshakeTimer)
            client.handshakeTimer = null
            this.options.onClientCountChanged?.(this.connectedClients)
            socket.write(encodeExternalControlFrame(
              externalControlBridgeHelloAckSchema.parse({
                type: 'hello_ack',
                protocolVersion: EXTERNAL_CONTROL_PROTOCOL_VERSION,
                instanceId,
              }),
            ))
            continue
          }
          const request = externalControlBridgeRequestSchema.parse(frame)
          if (
            client.inFlight.has(request.requestId) ||
            client.inFlight.size >= EXTERNAL_CONTROL_MAX_IN_FLIGHT_PER_CLIENT
          ) {
            this.writeFailure(client, request.requestId, new ExternalControlError(
              'invalid_state',
              'The bridge request limit was reached.',
            ))
            continue
          }
          const controller = new AbortController()
          client.inFlight.set(request.requestId, controller)
          void Promise.resolve()
            .then(async () => {
              const params = parseExternalControlMethodParams(request.method, request.params)
              const result = await this.options.handler(
                request.method,
                params,
                controller.signal,
              )
              const parsedResult = parseExternalControlMethodResult(request.method, result)
              const response = externalControlBridgeResponseSchema.parse({
                type: 'response',
                requestId: request.requestId,
                ok: true,
                result: parsedResult,
              })
              if (!socket.destroyed) socket.write(encodeExternalControlFrame(response))
            })
            .catch((error: unknown) => this.writeFailure(client, request.requestId, error))
            .finally(() => client.inFlight.delete(request.requestId))
        }
      } catch {
        socket.destroy()
      }
    })
  }

  private writeFailure(client: ClientState, requestId: string, error: unknown) {
    if (client.socket.destroyed) return
    const response = externalControlBridgeResponseSchema.parse({
      type: 'response',
      requestId,
      ok: false,
      error: sanitizeExternalControlError(error),
    })
    client.socket.write(encodeExternalControlFrame(response))
  }
}
