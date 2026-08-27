import { randomUUID } from 'node:crypto'
import { connect, type Socket } from 'node:net'
import {
  EXTERNAL_CONTROL_PROTOCOL_VERSION,
  ExternalControlError,
  externalControlBridgeHelloAckSchema,
  externalControlBridgeRequestSchema,
  externalControlBridgeResponseSchema,
  parseExternalControlMethodResult,
  type ExternalControlBridgeMethod,
} from '../../shared/external-control'
import type { ExternalControlDescriptorRepository } from './descriptor-repository'
import { encodeExternalControlFrame, ExternalControlFrameDecoder } from './framing'

interface PendingRequest {
  method: ExternalControlBridgeMethod
  resolve(value: unknown): void
  reject(error: unknown): void
}

export class ConversationMcpBridgeClient {
  private socket: Socket | null = null
  private decoder: ExternalControlFrameDecoder | null = null
  private connectPromise: Promise<void> | null = null
  private ready = false
  private readonly pending = new Map<string, PendingRequest>()
  private readonly disconnectListeners = new Set<() => void>()

  constructor(private readonly descriptorRepository: ExternalControlDescriptorRepository) {}

  async connect(timeoutMs = 5_000) {
    if (this.ready && this.socket && !this.socket.destroyed) return
    if (this.connectPromise) return this.connectPromise
    const pending = this.openConnection(timeoutMs)
    this.connectPromise = pending
    try {
      await pending
    } finally {
      if (this.connectPromise === pending) this.connectPromise = null
    }
  }

  private async openConnection(timeoutMs: number) {
    const descriptor = this.descriptorRepository.read()
    const socket = connect({ path: descriptor.endpoint })
    this.socket = socket
    this.decoder = new ExternalControlFrameDecoder()
    this.ready = false
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          socket.once('error', reject)
          socket.once('connect', () => {
            socket.off('error', reject)
            resolve()
          })
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('connect timeout')), timeoutMs)
          timer.unref()
        }),
      ])
      socket.on('error', (error) => this.failPending(error))
      socket.on('close', () => {
        if (this.socket === socket) {
          this.helloWaiter?.reject(new Error('bridge closed during handshake'))
          this.helloWaiter = null
          this.socket = null
          this.decoder = null
          this.ready = false
          this.publishDisconnect()
        }
        this.failPending(new ExternalControlError(
          'pipilot_unavailable',
          'PiPilot External Control disconnected.',
        ))
      })
      socket.on('data', (chunk) => this.receive(
        typeof chunk === 'string' ? Buffer.from(chunk) : chunk,
      ))
      const hello = this.waitForHello(descriptor.instanceId, timeoutMs)
      socket.write(encodeExternalControlFrame({
        type: 'hello',
        protocolVersion: EXTERNAL_CONTROL_PROTOCOL_VERSION,
        instanceId: descriptor.instanceId,
        token: descriptor.token,
      }))
      await hello
      if (this.socket !== socket || socket.destroyed) throw new Error('bridge closed')
      this.ready = true
    } catch {
      socket.destroy()
      if (this.socket === socket) {
        this.socket = null
        this.decoder = null
        this.ready = false
      }
      throw new ExternalControlError(
        'pipilot_unavailable',
        'PiPilot External Control is unavailable.',
      )
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async call(method: ExternalControlBridgeMethod, params: unknown) {
    await this.connect()
    const socket = this.socket
    if (!socket || socket.destroyed) {
      throw new ExternalControlError('pipilot_unavailable', 'PiPilot is unavailable.')
    }
    const requestId = randomUUID()
    const request = externalControlBridgeRequestSchema.parse({
      type: 'request',
      requestId,
      method,
      params,
    })
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(requestId, { method, resolve, reject })
    })
    socket.write(encodeExternalControlFrame(request), (error) => {
      if (!error) return
      const pending = this.pending.get(requestId)
      if (!pending) return
      this.pending.delete(requestId)
      pending.reject(new ExternalControlError(
        'pipilot_unavailable',
        'PiPilot External Control is unavailable.',
      ))
    })
    return result
  }

  close() {
    this.helloWaiter?.reject(new Error('bridge closed during handshake'))
    this.helloWaiter = null
    this.socket?.destroy()
    this.socket = null
    this.decoder = null
    this.ready = false
    this.failPending(new ExternalControlError(
      'pipilot_unavailable',
      'PiPilot External Control disconnected.',
    ))
  }

  subscribeDisconnect(listener: () => void) {
    this.disconnectListeners.add(listener)
    return () => this.disconnectListeners.delete(listener)
  }

  private helloWaiter: {
    instanceId: string
    resolve(): void
    reject(error: unknown): void
  } | null = null

  private waitForHello(instanceId: string, timeoutMs: number) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.helloWaiter = null
        reject(new Error('handshake timeout'))
      }, timeoutMs)
      timer.unref()
      this.helloWaiter = {
        instanceId,
        resolve: () => { clearTimeout(timer); resolve() },
        reject: (error) => { clearTimeout(timer); reject(error) },
      }
    })
  }

  private receive(chunk: Buffer) {
    try {
      if (!this.decoder) throw new Error('bridge decoder unavailable')
      for (const frame of this.decoder.push(chunk)) {
        if (this.helloWaiter) {
          const ack = externalControlBridgeHelloAckSchema.parse(frame)
          if (ack.instanceId !== this.helloWaiter.instanceId) {
            throw new Error('instance mismatch')
          }
          const waiter = this.helloWaiter
          this.helloWaiter = null
          waiter.resolve()
          continue
        }
        const response = externalControlBridgeResponseSchema.parse(frame)
        const pending = this.pending.get(response.requestId)
        if (!pending) continue
        this.pending.delete(response.requestId)
        if (!response.ok) {
          pending.reject(new ExternalControlError(response.error.code, response.error.message))
          continue
        }
        pending.resolve(parseExternalControlMethodResult(pending.method, response.result))
      }
    } catch (error) {
      this.helloWaiter?.reject(error)
      this.helloWaiter = null
      this.socket?.destroy()
      this.failPending(error)
    }
  }

  private failPending(error: unknown) {
    for (const request of this.pending.values()) request.reject(error)
    this.pending.clear()
  }

  private publishDisconnect() {
    for (const listener of this.disconnectListeners) {
      try { listener() } catch { /* isolate lifecycle consumers */ }
    }
  }
}
