import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MessageChannelMain, MessagePortMain, UtilityProcess } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PiHostController,
  resolvePiHostUtilityModulePath,
  type PiHostElectronAdapter,
} from '../../src/main/pi-host/pi-host-controller'
import {
  PI_HOST_PROTOCOL_VERSION,
  piHostBootstrapEnvelopeSchema,
  piHostCreditEnvelopeSchema,
  piHostFailureEnvelopeSchema,
  piHostRequestEnvelopeSchema,
  type PiHostDto,
  type PiHostRequestEnvelope,
} from '../../src/shared/pi-host-protocol'

describe('Pi Host utility path resolution', () => {
  it('resolves a utility entry outside a lazy Main chunk directory', () => {
    const chunkUrl = pathToFileURL(resolve(
      'out/main/chunks/gui-main.js',
    )).href
    expect(resolvePiHostUtilityModulePath(chunkUrl)).toBe(
      resolve('out/main/pi-host-utility.js'),
    )
  })
})

class FakeMessagePort extends EventEmitter {
  peer: FakeMessagePort | null = null
  closed = false

  start() {}

  postMessage(message: unknown) {
    if (this.closed || !this.peer || this.peer.closed) {
      throw new Error('MessagePort is closed.')
    }
    const peer = this.peer
    queueMicrotask(() => {
      if (!peer.closed) peer.emit('message', { data: structuredClone(message) })
    })
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.emit('close')
    const peer = this.peer
    if (peer && !peer.closed) {
      peer.closed = true
      peer.emit('close')
    }
  }
}

function createFakeChannel() {
  const port1 = new FakeMessagePort()
  const port2 = new FakeMessagePort()
  port1.peer = port2
  port2.peer = port1
  return { port1, port2 }
}

class FakeUtilityProcess extends EventEmitter {
  pid: number | undefined
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  killed = false
  hostPort: FakeMessagePort | null = null
  bootstrap: unknown = null

  constructor(
    private readonly sdkVersion: string,
    private readonly onRequest?: (
      request: PiHostRequestEnvelope,
      utility: FakeUtilityProcess,
    ) => PiHostDto | undefined,
  ) {
    super()
    queueMicrotask(() => {
      this.pid = 4_242
      this.emit('spawn')
    })
  }

  postMessage(message: unknown, ports: MessagePortMain[] = []) {
    this.bootstrap = structuredClone(message)
    const bootstrap = piHostBootstrapEnvelopeSchema.parse(message)
    const hostPort = ports[0] as unknown as FakeMessagePort | undefined
    if (!hostPort) throw new Error('Expected transferred Host port.')
    this.hostPort = hostPort
    hostPort.on('message', ({ data }: { data: unknown }) => {
      const credit = piHostCreditEnvelopeSchema.safeParse(data)
      if (credit.success) return
      const request = piHostRequestEnvelopeSchema.parse(data)
      const result = this.onRequest?.(request, this)
      if (result === undefined) return
      const responseRuntime = request.command.type === 'runtime.create'
        ? { runtimeId: request.command.runtimeId, runtimeGeneration: 1 }
        : request.runtimeId === undefined
          ? {}
          : {
              runtimeId: request.runtimeId,
              runtimeGeneration: request.runtimeGeneration,
            }
      hostPort.postMessage({
        kind: 'response',
        protocolVersion: PI_HOST_PROTOCOL_VERSION,
        hostEpoch: request.hostEpoch,
        requestId: request.requestId,
        ...responseRuntime,
        ok: true,
        result,
      })
      if (request.command.type === 'shutdown') {
        queueMicrotask(() => {
          this.pid = undefined
          this.emit('exit', 0)
        })
      }
    })
    hostPort.start()
    hostPort.postMessage({
      kind: 'handshake',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      hostEpoch: bootstrap.hostEpoch,
      requestId: bootstrap.requestId,
      ok: true,
      sdkVersion: this.sdkVersion,
      nodeVersion: '24.18.1',
      electronVersion: '43.4.1',
      capabilities: ['ping', 'shutdown'],
    })
  }

  kill() {
    this.killed = true
    if (this.pid === undefined) return false
    this.pid = undefined
    queueMicrotask(() => this.emit('exit', 1))
    return true
  }
}

function createHarness(options: {
  sdkVersion?: string
  onRequest?: (
    request: PiHostRequestEnvelope,
    utility: FakeUtilityProcess,
  ) => PiHostDto | undefined
  maxPendingRequests?: number
  requestTimeoutMs?: number
} = {}) {
  let utility: FakeUtilityProcess | null = null
  const channels: ReturnType<typeof createFakeChannel>[] = []
  const forkUtility = vi.fn(() => {
    utility = new FakeUtilityProcess(
      options.sdkVersion ?? '0.84.2',
      options.onRequest,
    )
    return utility as unknown as UtilityProcess
  })
  const adapter: PiHostElectronAdapter = {
    waitUntilReady: vi.fn(async () => undefined),
    createMessageChannel: () => {
      const channel = createFakeChannel()
      channels.push(channel)
      return channel as unknown as MessageChannelMain
    },
    forkUtility,
  }
  let id = 0
  const controller = new PiHostController({
    cwd: resolve('.'),
    utilityModulePath: resolve('out/main/pi-host-utility.js'),
    electron: adapter,
    createId: () => `request-${++id}`,
    handshakeTimeoutMs: 500,
    requestTimeoutMs: options.requestTimeoutMs ?? 500,
    shutdownTimeoutMs: 100,
    maxPendingRequests: options.maxPendingRequests,
  })
  return {
    adapter,
    channels,
    controller,
    forkUtility,
    get utility() {
      if (!utility) throw new Error('Utility was not created.')
      return utility
    },
  }
}

const controllers = new Set<PiHostController>()

afterEach(async () => {
  await Promise.all([...controllers].map((controller) => controller.dispose()))
  controllers.clear()
})

describe('PiHostController', () => {
  it('waits for Electron readiness, completes the versioned handshake, and routes requests', async () => {
    const harness = createHarness({
      onRequest: (request): PiHostDto | undefined => {
        if (request.command.type === 'ping') return { pong: true }
        if (request.command.type === 'shutdown') return { stopped: true }
        return undefined
      },
    })
    controllers.add(harness.controller)

    await expect(harness.controller.start()).resolves.toMatchObject({
      state: 'ready',
      hostEpoch: 1,
      pid: 4_242,
      sdkVersion: '0.84.2',
      nodeVersion: '24.18.1',
      electronVersion: '43.4.1',
      capabilities: ['ping', 'shutdown'],
    })
    expect(harness.adapter.waitUntilReady).toHaveBeenCalledOnce()
    expect(harness.forkUtility).toHaveBeenCalledWith(
      resolve('out/main/pi-host-utility.js'),
      [],
      expect.objectContaining({
        cwd: resolve('.'),
        serviceName: 'PiPilot Pi Host',
        stdio: ['ignore', 'ignore', 'pipe'],
      }),
    )
    expect(piHostBootstrapEnvelopeSchema.parse(harness.utility.bootstrap)).toMatchObject({
      hostEpoch: 1,
      expectedSdkVersion: '0.84.2',
    })

    await expect(harness.controller.request({ type: 'ping' })).resolves.toEqual({
      pong: true,
    })
  })

  it('rejects a mismatched SDK handshake and terminates the utility', async () => {
    const harness = createHarness({ sdkVersion: '0.84.1' })
    controllers.add(harness.controller)

    await expect(harness.controller.start()).rejects.toMatchObject({
      code: 'HANDSHAKE_FAILED',
    })
    expect(harness.utility.killed).toBe(true)
    expect(harness.controller.getSnapshot()).toMatchObject({
      state: 'failed',
      hostEpoch: 1,
      pid: null,
    })
  })

  it('accepts Runtime identity established by a runtime.create response', async () => {
    const harness = createHarness({
      onRequest: (request): PiHostDto | undefined => {
        if (request.command.type === 'runtime.create') {
          return {
            runtime: {
              runtimeId: request.command.runtimeId,
              generation: 1,
            },
          }
        }
        if (request.command.type === 'runtime.bind') {
          return {
            bound: true,
            runtime: {
              runtimeId: request.runtimeId!,
              generation: request.runtimeGeneration!,
            },
          }
        }
        if (request.command.type === 'shutdown') return { stopped: true }
        return undefined
      },
    })
    controllers.add(harness.controller)
    await harness.controller.start()

    await expect(harness.controller.request({
      type: 'runtime.create',
      runtimeId: 'rt_created',
      sessionDir: resolve('sessions'),
    })).resolves.toEqual({
      runtime: {
        runtimeId: 'rt_created',
        generation: 1,
      },
    })

    await expect(harness.controller.request(
      { type: 'runtime.bind' },
      { runtimeId: 'rt_created', runtimeGeneration: 1 },
    )).resolves.toEqual({
      bound: true,
      runtime: {
        runtimeId: 'rt_created',
        generation: 1,
      },
    })
  })

  it('bounds pending requests and rejects them exactly once when the port closes', async () => {
    const harness = createHarness({
      maxPendingRequests: 1,
      onRequest: (request) =>
        request.command.type === 'shutdown' ? { stopped: true } : undefined,
    })
    controllers.add(harness.controller)
    await harness.controller.start()

    const pending = harness.controller.request({ type: 'ping' })
    await expect(harness.controller.request({ type: 'ping' })).rejects.toMatchObject({
      code: 'QUEUE_FULL',
    })
    harness.utility.hostPort?.close()
    await expect(pending).rejects.toMatchObject({ code: 'PORT_CLOSED' })
    await vi.waitFor(() => {
      expect(harness.controller.getSnapshot().state).toBe('failed')
    })
  })

  it('preserves the current epoch first fault when port close and exit follow', async () => {
    const harness = createHarness({
      onRequest: (request) =>
        request.command.type === 'shutdown' ? { stopped: true } : undefined,
    })
    controllers.add(harness.controller)
    await harness.controller.start()
    const hostPort = harness.utility.hostPort
    if (!hostPort) throw new Error('Missing Host port.')

    hostPort.postMessage(piHostFailureEnvelopeSchema.parse({
      kind: 'host_failure',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      hostEpoch: 1,
      error: {
        name: 'PiHostFatalError',
        message: 'The embedded Pi Host reported a fatal internal failure.',
        code: 'RUNTIME_EXTENSION_SHUTDOWN_REQUESTED',
      },
    }))
    const pending = harness.controller.request({ type: 'ping' })

    await expect(pending).rejects.toMatchObject({
      code: 'HOST_REPORTED_FAILURE',
      diagnostic: { code: 'RUNTIME_EXTENSION_SHUTDOWN_REQUESTED' },
    })
    harness.utility.emit('exit', 1)
    await vi.waitFor(() => {
      expect(harness.controller.getSnapshot()).toMatchObject({
        state: 'failed',
        error: { code: 'RUNTIME_EXTENSION_SHUTDOWN_REQUESTED' },
      })
    })
  })

  it('ignores a stale host failure without disturbing the ready epoch', async () => {
    const harness = createHarness({
      onRequest: (request) =>
        request.command.type === 'shutdown' ? { stopped: true } : undefined,
    })
    controllers.add(harness.controller)
    await harness.controller.start()
    const hostPort = harness.utility.hostPort
    if (!hostPort) throw new Error('Missing Host port.')

    hostPort.postMessage(piHostFailureEnvelopeSchema.parse({
      kind: 'host_failure',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      hostEpoch: 0,
      error: {
        name: 'PiHostFatalError',
        message: 'The embedded Pi Host reported a fatal internal failure.',
        code: 'STALE_FAILURE',
      },
    }))
    await new Promise((resolve) => setImmediate(resolve))

    expect(harness.controller.getSnapshot()).toMatchObject({
      state: 'ready',
      hostEpoch: 1,
      error: null,
    })
  })

  it('kills and fails the Host when a request exceeds its hard deadline', async () => {
    const harness = createHarness({
      requestTimeoutMs: 20,
      onRequest: (request) =>
        request.command.type === 'shutdown' ? { stopped: true } : undefined,
    })
    controllers.add(harness.controller)
    await harness.controller.start()

    await expect(harness.controller.request({ type: 'ping' })).rejects.toMatchObject({
      code: 'TIMEOUT',
    })
    await vi.waitFor(() => {
      expect(harness.utility.killed).toBe(true)
      expect(harness.controller.getSnapshot()).toMatchObject({
        state: 'failed',
        pid: null,
      })
    })
  })

  it('routes runtime events, ignores stale epochs, and sends validated credits', async () => {
    const harness = createHarness({
      onRequest: (request) =>
        request.command.type === 'shutdown' ? { stopped: true } : undefined,
    })
    controllers.add(harness.controller)
    const events: string[] = []
    harness.controller.subscribeEvents((envelope) => {
      events.push(String(envelope.event.type))
    })
    await harness.controller.start()
    const hostPort = harness.utility.hostPort
    if (!hostPort) throw new Error('Missing Host port.')

    hostPort.postMessage({
      kind: 'event',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      hostEpoch: 0,
      runtimeId: 'rt_one',
      runtimeGeneration: 1,
      sequence: 1,
      event: { type: 'stale' },
    })
    hostPort.postMessage({
      kind: 'event',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      hostEpoch: 1,
      runtimeId: 'rt_one',
      runtimeGeneration: 1,
      sequence: 2,
      event: { type: 'current' },
    })
    await vi.waitFor(() => expect(events).toEqual(['current']))

    const credits: unknown[] = []
    hostPort.on('message', ({ data }: { data: unknown }) => {
      if (piHostCreditEnvelopeSchema.safeParse(data).success) credits.push(data)
    })
    harness.controller.acknowledgeEvent({
      kind: 'event',
      protocolVersion: PI_HOST_PROTOCOL_VERSION,
      hostEpoch: 1,
      runtimeId: 'rt_one',
      runtimeGeneration: 1,
      sequence: 2,
      event: { type: 'current' },
    })
    await vi.waitFor(() => expect(credits).toHaveLength(1))
  })

  it('performs a correlated shutdown and reaches stopped state', async () => {
    const harness = createHarness({
      onRequest: (request) =>
        request.command.type === 'shutdown' ? { stopped: true } : undefined,
    })
    controllers.add(harness.controller)
    await harness.controller.start()

    await expect(harness.controller.stop()).resolves.toMatchObject({
      state: 'stopped',
      pid: null,
    })
    expect(harness.utility.killed).toBe(false)
  })
})
