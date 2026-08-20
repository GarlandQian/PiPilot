import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentSessionRuntime } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  dispatchExternalSubmit,
  dispatchRuntimeCommand,
  ensureRuntimeSessionDirectory,
  getRuntimeCommandArgumentCompletions,
} from '../../src/main/pi-host/runtime-command-dispatcher'
import {
  LOCAL_PI_COMMAND_ARGUMENT_COMPLETION_MAX_ITEMS,
  LOCAL_PI_COMMAND_ARGUMENT_COMPLETION_VALUE_MAX_LENGTH,
  LOCAL_PI_COMMAND_ARGUMENT_PREFIX_MAX_LENGTH,
  localPiRpcCommandSchema,
  localPiRpcResponseSchema,
} from '../../src/shared/local-pi'

const temporaryDirectories: string[] = []

function completionRuntime({
  commandName = 'goal',
  provider,
  sessionDirectory = '/tmp/pipilot-command-completion-fixture',
}: {
  commandName?: string
  provider?: (prefix: string) => unknown
  sessionDirectory?: string
} = {}): AgentSessionRuntime {
  return {
    session: {
      extensionRunner: {
        getCommand(name: string) {
          if (name !== commandName) return undefined
          return provider
            ? { getArgumentCompletions: provider }
            : { name: commandName }
        },
        getRegisteredCommands() {
          return [{
            name: commandName,
            invocationName: commandName,
            sourceInfo: {
              path: '/fixture/extension.js',
              source: 'fixture',
              scope: 'temporary',
              origin: 'top-level',
            },
            ...(provider ? { getArgumentCompletions: provider } : {}),
          }]
        },
      },
      promptTemplates: [],
      resourceLoader: { getSkills: () => ({ skills: [] }) },
      sessionManager: { getSessionDir: () => sessionDirectory },
    },
  } as unknown as AgentSessionRuntime
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })))
})

describe('runtime command dispatcher', () => {
  it('accepts an idle auto Prompt only at the explicit Pi preflight boundary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-external-prompt-'))
    temporaryDirectories.push(root)
    const prompt = vi.fn((_message: string, options: {
      preflightResult?(accepted: boolean): void
    }) => {
      options.preflightResult?.(true)
      return new Promise<void>(() => undefined)
    })
    const runtime = {
      session: {
        isStreaming: false,
        sessionManager: { getSessionDir: () => join(root, 'sessions') },
        prompt,
        followUp: vi.fn(),
        steer: vi.fn(),
      },
    } as unknown as AgentSessionRuntime

    await expect(dispatchExternalSubmit(runtime, {
      message: 'Inspect the current change.',
      mode: 'auto',
    })).resolves.toEqual({ acceptedMode: 'prompt' })
    expect(prompt).toHaveBeenCalledOnce()
  })

  it('atomically maps running auto to Follow-up and preserves explicit Steer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-external-running-'))
    temporaryDirectories.push(root)
    const followUp = vi.fn().mockResolvedValue(undefined)
    const steer = vi.fn().mockResolvedValue(undefined)
    const runtime = {
      session: {
        isStreaming: true,
        sessionManager: { getSessionDir: () => join(root, 'sessions') },
        prompt: vi.fn(),
        followUp,
        steer,
      },
    } as unknown as AgentSessionRuntime

    await expect(dispatchExternalSubmit(runtime, {
      message: 'Continue after this turn.',
      mode: 'auto',
    })).resolves.toEqual({ acceptedMode: 'follow_up' })
    await expect(dispatchExternalSubmit(runtime, {
      message: 'Adjust the current turn.',
      mode: 'steer',
    })).resolves.toEqual({ acceptedMode: 'steer' })
    expect(followUp).toHaveBeenCalledWith('Continue after this turn.')
    expect(steer).toHaveBeenCalledWith('Adjust the current turn.')
  })

  it('rejects invalid explicit modes and never guesses Prompt acceptance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-external-invalid-'))
    temporaryDirectories.push(root)
    const idle = {
      session: {
        isStreaming: false,
        sessionManager: { getSessionDir: () => join(root, 'idle') },
        prompt: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn(),
        steer: vi.fn(),
      },
    } as unknown as AgentSessionRuntime
    const running = {
      session: {
        isStreaming: true,
        sessionManager: { getSessionDir: () => join(root, 'running') },
        prompt: vi.fn(),
        followUp: vi.fn(),
        steer: vi.fn(),
      },
    } as unknown as AgentSessionRuntime

    await expect(dispatchExternalSubmit(idle, {
      message: 'Not running.', mode: 'follow_up',
    })).rejects.toMatchObject({ code: 'RUNTIME_EXTERNAL_SUBMIT_INVALID_STATE' })
    await expect(dispatchExternalSubmit(running, {
      message: 'Already running.', mode: 'prompt',
    })).rejects.toMatchObject({ code: 'RUNTIME_EXTERNAL_SUBMIT_INVALID_STATE' })
    await expect(dispatchExternalSubmit(idle, {
      message: 'Missing preflight signal.', mode: 'prompt',
    })).rejects.toThrow('without an acceptance signal')
  })

  it('restores a missing SDK session directory before dispatch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-runtime-dispatch-'))
    temporaryDirectories.push(root)
    const sessionDirectory = join(root, 'agent', 'sessions', 'encoded-cwd')

    await ensureRuntimeSessionDirectory({
      sessionManager: { getSessionDir: () => sessionDirectory },
    })

    const details = await stat(sessionDirectory)
    expect(details.isDirectory()).toBe(true)
  })

  it('uses the exact current extension command provider and preserves item semantics', async () => {
    const prefixes: string[] = []
    const runtime = completionRuntime({
      provider: (prefix) => {
        prefixes.push(prefix)
        return [{
          value: 'resume',
          label: 'Resume',
          description: 'Resume the current goal',
        }]
      },
    })

    await expect(getRuntimeCommandArgumentCompletions(runtime, {
      type: 'get_command_argument_completions',
      commandName: 'goal',
      argumentPrefix: 'r',
    })).resolves.toEqual([{
      value: 'resume',
      label: 'Resume',
      description: 'Resume the current goal',
    }])
    expect(prefixes).toEqual(['r'])
  })

  it('returns no suggestions for unknown commands or commands without a provider', async () => {
    const runtime = completionRuntime()

    await expect(getRuntimeCommandArgumentCompletions(runtime, {
      type: 'get_command_argument_completions',
      commandName: 'goal',
      argumentPrefix: '',
    })).resolves.toEqual([])
    await expect(getRuntimeCommandArgumentCompletions(runtime, {
      type: 'get_command_argument_completions',
      commandName: 'missing',
      argumentPrefix: '',
    })).resolves.toEqual([])
  })

  it('drops malformed and oversized values', async () => {
    const runtime = completionRuntime({
      provider: () => [
        { value: '', label: 'Empty value' },
        {
          value: 'x'.repeat(LOCAL_PI_COMMAND_ARGUMENT_COMPLETION_VALUE_MAX_LENGTH + 1),
          label: 'Oversized value',
        },
        { value: 'strict', label: 'Strict', extra: true },
        { value: 'valid', label: 'Valid' },
      ],
    })

    await expect(getRuntimeCommandArgumentCompletions(runtime, {
      type: 'get_command_argument_completions',
      commandName: 'goal',
      argumentPrefix: '',
    })).resolves.toEqual([{ value: 'valid', label: 'Valid' }])
  })

  it('caps the number of extension items inspected and returned', async () => {
    const runtime = completionRuntime({
      provider: () => Array.from(
        { length: LOCAL_PI_COMMAND_ARGUMENT_COMPLETION_MAX_ITEMS + 5 },
        (_, index) => ({ value: `value-${index}`, label: `Value ${index}` }),
      ),
    })

    const items = await getRuntimeCommandArgumentCompletions(runtime, {
      type: 'get_command_argument_completions',
      commandName: 'goal',
      argumentPrefix: '',
    })
    expect(items).toHaveLength(LOCAL_PI_COMMAND_ARGUMENT_COMPLETION_MAX_ITEMS)
    expect(items[items.length - 1]).toEqual({ value: 'value-99', label: 'Value 99' })
  })

  it('turns provider rejection and timeout into bounded stable failures', async () => {
    const rejected = completionRuntime({
      provider: () => Promise.reject(new Error('/private/secret-token')),
    })
    await expect(getRuntimeCommandArgumentCompletions(rejected, {
      type: 'get_command_argument_completions',
      commandName: 'goal',
      argumentPrefix: '',
    })).rejects.toThrow('could not provide argument completions')

    const stalled = completionRuntime({ provider: () => new Promise(() => undefined) })
    await expect(getRuntimeCommandArgumentCompletions(stalled, {
      type: 'get_command_argument_completions',
      commandName: 'goal',
      argumentPrefix: '',
    }, { timeoutMs: 5 })).rejects.toThrow('timed out')
  })

  it('dispatches clone-safe completion DTOs and enforces command input bounds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-command-completion-'))
    temporaryDirectories.push(root)
    const runtime = completionRuntime({
      sessionDirectory: join(root, 'agent', 'sessions', 'fixture'),
      provider: (prefix) => prefix === 'r'
        ? [{ value: 'resume', label: 'Resume' }]
        : null,
    })
    const result = await dispatchRuntimeCommand(runtime, {
      type: 'get_command_argument_completions',
      commandName: 'goal',
      argumentPrefix: 'r',
    })
    expect(result).toEqual({
      replaced: false,
      response: {
        type: 'response',
        command: 'get_command_argument_completions',
        success: true,
        data: { items: [{ value: 'resume', label: 'Resume' }] },
      },
    })
    expect(localPiRpcResponseSchema.safeParse(result.response).success).toBe(true)
    expect(localPiRpcCommandSchema.safeParse({
      type: 'get_command_argument_completions',
      commandName: '/goal',
      argumentPrefix: '',
    }).success).toBe(false)
    expect(localPiRpcCommandSchema.safeParse({
      type: 'get_command_argument_completions',
      commandName: 'goal',
      argumentPrefix: 'x'.repeat(LOCAL_PI_COMMAND_ARGUMENT_PREFIX_MAX_LENGTH + 1),
    }).success).toBe(false)
  })

  it('advertises argument completion capability only for commands that provide it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-command-capability-'))
    temporaryDirectories.push(root)
    const withProvider = completionRuntime({
      sessionDirectory: join(root, 'with-provider'),
      provider: () => [],
    })
    const withoutProvider = completionRuntime({
      commandName: 'plain',
      sessionDirectory: join(root, 'without-provider'),
    })

    await expect(dispatchRuntimeCommand(withProvider, { type: 'get_commands' }))
      .resolves.toMatchObject({
        response: {
          success: true,
          data: {
            commands: [{
              name: 'goal',
              hasArgumentCompletions: true,
            }],
          },
        },
      })
    await expect(dispatchRuntimeCommand(withoutProvider, { type: 'get_commands' }))
      .resolves.toMatchObject({
        response: {
          success: true,
          data: { commands: [{ name: 'plain' }] },
        },
    })
    const plain = await dispatchRuntimeCommand(withoutProvider, { type: 'get_commands' })
    if (!plain.response.success || plain.response.command !== 'get_commands') {
      throw new Error('Expected the command catalog fixture to succeed.')
    }
    expect(plain.response.data.commands[0]).not.toHaveProperty('hasArgumentCompletions')
  })
})
