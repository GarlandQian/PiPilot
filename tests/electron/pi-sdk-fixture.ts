import { createServer, type Server } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import {
  createFixtureStreamWriter,
  fixtureRequestPath,
  readFixtureRequest,
  type FixtureProviderProtocol,
} from './pi-sdk-fixture-protocols'

interface PiSdkFixtureOptions {
  agentDir: string
  protocol?: FixtureProviderProtocol
  globalPackages?: readonly string[]
  includeReasoningModel?: boolean
  completionDelays?: Readonly<Record<string, number>>
  promptDelays?: Readonly<Record<string, number>>
  /** Hold the provider response until a test has completed a real UI action. */
  promptGates?: Readonly<Record<string, Promise<void>>>
  reasoningDelays?: Readonly<Record<string, number>>
  reasoningGates?: Readonly<Record<string, Promise<void>>>
  retryEnabled?: boolean
  writeToolPrompts?: Readonly<Record<string, {
    path: string
    content: string
  }>>
  /** Emit observable assistant commentary before the real SDK write call. */
  writeToolCommentary?: Readonly<Record<string, {
    text: string
    delayMs: number
  }>>
}

export interface PiSdkFixture {
  env: NodeJS.ProcessEnv
  prompts: string[]
  requests: { protocol: FixtureProviderProtocol; prompt: string; hasWriteResult: boolean }[]
  close(): Promise<void>
}

function delay(milliseconds: number) {
  return new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds)
  })
}

async function closeServer(server: Server) {
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose())
  })
}

/**
 * Real Pi SDK Electron fixture.
 *
 * The app still imports and runs the bundled SDK in utilityProcess. Only the
 * provider endpoint and user resources are deterministic: an isolated Pi
 * Agent directory contains official models/settings/extension/skill files,
 * while a local protocol-specific SSE server supplies model responses.
 */
export async function startPiSdkFixture(
  options: PiSdkFixtureOptions,
): Promise<PiSdkFixture> {
  const prompts: string[] = []
  const requests: PiSdkFixture['requests'] = []
  const protocol = options.protocol ?? 'openai-completions'
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || !fixtureRequestPath(protocol, request.url ?? '')) {
      response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({
        error: { message: `Unsupported fixture route: ${request.method} ${new URL(request.url ?? '/', 'http://fixture.invalid').pathname}` },
      }))
      return
    }
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      void (async () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
        const { prompt, model, hasWriteResult } = readFixtureRequest(protocol, body)
        prompts.push(prompt)
        requests.push({ protocol, prompt, hasWriteResult })
        await options.promptGates?.[prompt]
        const promptDelay = options.promptDelays?.[prompt] ?? 0
        if (promptDelay > 0) await delay(promptDelay)
        const content = `Fixture response: ${prompt}`
        const stream = createFixtureStreamWriter(protocol, response, model)
        const writeTool = options.writeToolPrompts?.[prompt]
        if (writeTool && !hasWriteResult) {
          const commentary = options.writeToolCommentary?.[prompt]
          if (commentary) {
            stream.text(commentary.text)
            if (commentary.delayMs > 0) await delay(commentary.delayMs)
          }
          stream.writeTool(writeTool)
          stream.finish(true)
          return
        }
        const reasoningDelay = options.reasoningDelays?.[prompt]
        if (reasoningDelay !== undefined) {
          stream.thinking(`Fixture reasoning: ${prompt}`)
          if (reasoningDelay > 0) await delay(reasoningDelay)
          await options.reasoningGates?.[prompt]
        }
        stream.text(content)
        const completionDelay = options.completionDelays?.[prompt] ?? 0
        if (completionDelay > 0) await delay(completionDelay)
        stream.finish(false)
      })().catch((error) => {
        if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain' })
        response.end(error instanceof Error ? error.message : 'Fixture failure')
      })
    })
  })
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address() as AddressInfo
  const apiPath = protocol.startsWith('openai-') ? '/v1'
    : protocol === 'google-generative-ai' ? '/v1beta' : ''
  const baseUrl = `http://127.0.0.1:${address.port}${apiPath}`

  await Promise.all([
    mkdir(join(options.agentDir, 'extensions'), { recursive: true }),
    mkdir(join(options.agentDir, 'skills', 'fixture-skill'), { recursive: true }),
  ])
  await Promise.all([
    writeFile(join(options.agentDir, 'models.json'), `${JSON.stringify({
      providers: {
        fixture: {
          baseUrl,
          api: protocol,
          apiKey: 'fixture-key',
          ...(protocol === 'openai-completions' ? { compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: false,
          } } : {}),
          models: [
            {
              id: 'fake-chat',
              name: 'Fake Chat',
              reasoning: false,
              input: ['text', 'image'],
              contextWindow: 1_000_000,
              maxTokens: 128_000,
              cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
            },
            {
              id: 'fake-fast',
              name: 'Fake Fast',
              reasoning: false,
              input: ['text', 'image'],
              contextWindow: 500_000,
              maxTokens: 64_000,
              cost: { input: 0.5, output: 1, cacheRead: 0, cacheWrite: 0 },
            },
            ...(options.includeReasoningModel ? [{
              id: 'fake-reasoning',
              name: 'Fake Reasoning',
              reasoning: true,
              input: ['text', 'image'],
              contextWindow: 500_000,
              maxTokens: 64_000,
              cost: { input: 0.5, output: 1, cacheRead: 0, cacheWrite: 0 },
            }] : []),
          ],
        },
      },
    }, null, 2)}\n`, 'utf8'),
    writeFile(join(options.agentDir, 'settings.json'), `${JSON.stringify({
      defaultProvider: 'fixture',
      defaultModel: 'fake-chat',
      defaultProjectTrust: 'always',
      ...(options.globalPackages?.length
        ? { packages: [...options.globalPackages] }
        : {}),
      retry: {
        enabled: options.retryEnabled ?? false,
        maxRetries: options.retryEnabled ? 3 : 0,
        baseDelayMs: 10,
      },
    }, null, 2)}\n`, 'utf8'),
    writeFile(
      join(options.agentDir, 'skills', 'fixture-skill', 'SKILL.md'),
      '---\nname: fixture-skill\ndescription: Deterministic Electron fixture Skill.\n---\n\nUse the fixture skill.\n',
      'utf8',
    ),
    writeFile(join(options.agentDir, 'extensions', 'pipilot-e2e.js'), `
export default function pipilotE2eExtension(pi) {
  pi.registerCommand('fixture-command', {
    description: 'Run the deterministic PiPilot fixture command.',
    handler: async (_args, ctx) => {
      ctx.ui.notify('Fixture command ran', 'info')
    },
  })

  pi.registerCommand('fixture-silent-command', {
    description: 'Run a deterministic command without transcript or UI output.',
    handler: async () => {},
  })

  pi.registerCommand('fixture-options-command', {
    description: 'Expose deterministic command argument completions.',
    getArgumentCompletions: (prefix) => [
      { value: 'resume', label: 'Resume', description: 'Resume the fixture operation' },
      { value: 'restart', label: 'Restart', description: 'Restart the fixture operation' },
      { value: 'status', label: 'Status', description: 'Inspect the fixture operation' },
    ].filter((item) => item.value.startsWith(prefix)),
    handler: async () => {},
  })

  pi.on('session_start', async (_event, ctx) => {
    const delay = Number(process.env.PIPILOT_E2E_STARTUP_DELAY_MS || 0)
    if (Number.isFinite(delay) && delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    if (process.env.PIPILOT_E2E_STARTUP_SURFACES === '1') {
      ctx.ui.notify('Startup fixture notification', 'info')
      ctx.ui.setWidget('startup', ['Startup fixture widget'])
      ctx.ui.setStatus('startup', 'startup: ready')
      ctx.ui.setTitle('Startup fixture title')
      ctx.ui.setEditorText('startup extension draft')
      }
  })

  pi.registerCommand('fixture-host-failure', {
    description: 'Trigger one deterministic embedded Host failure.',
    handler: async (_args, ctx) => {
      const marker = process.env.PIPILOT_E2E_HOST_FAILURE_MARKER
      if (!marker) return
      const fs = await import('node:fs')
      if (fs.existsSync(marker)) return
      fs.writeFileSync(marker, 'triggered\\n', 'utf8')
      ctx.shutdown()
    },
  })

  pi.on('before_agent_start', async (event, ctx) => {
    const acceptanceDelayPrompt = process.env.PIPILOT_E2E_ACCEPTANCE_DELAY_PROMPT
    const acceptanceDelay = Number(process.env.PIPILOT_E2E_ACCEPTANCE_DELAY_MS || 0)
    if (
      event.prompt === acceptanceDelayPrompt &&
      Number.isFinite(acceptanceDelay) &&
      acceptanceDelay > 0
    ) {
      await new Promise((resolve) => setTimeout(resolve, acceptanceDelay))
    }
    if (
      process.env.PIPILOT_E2E_UI_SURFACES === '1' &&
      event.prompt === 'ui'
    ) {
      const confirmed = await ctx.ui.confirm('Continue?', 'Continue?')
      if (confirmed) {
        ctx.ui.notify('Fixture notification', 'info')
        ctx.ui.setStatus('fixture', 'fixture: ready')
        ctx.ui.setWidget('fixture', ['Fixture widget', 'ready'])
      }
    }
  })
}
`, 'utf8'),
  ])

  return {
    env: {
      PI_CODING_AGENT_DIR: options.agentDir,
      PIPILOT_E2E_AGENT_DIR: options.agentDir,
      PI_OFFLINE: '1',
      PI_SKIP_VERSION_CHECK: '1',
      PI_TELEMETRY: '0',
    },
    prompts,
    requests,
    close: () => closeServer(server),
  }
}
