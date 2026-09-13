import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { displayPiAgentPath, resolvePiAgentDirectory } from '../../src/main/pi-agent-directory'

const homeDirectory = resolve('/fixture-home')
const startupCwd = resolve('/fixture-app')

it('abbreviates only verified home descendants and keeps custom paths truthful', () => {
  expect(displayPiAgentPath(join(homeDirectory, '.pi', 'agent', 'mcp.json'), homeDirectory))
    .toBe('~/.pi/agent/mcp.json')
  const external = resolve('/custom-agent/mcp.json')
  expect(displayPiAgentPath(external, homeDirectory)).toBe(external)
  const similar = `${homeDirectory}-other/mcp.json`
  expect(displayPiAgentPath(similar, homeDirectory)).toBe(similar)
})

describe('resolvePiAgentDirectory', () => {
  it('defaults to the supplied home without reading the process home', () => {
    expect(resolvePiAgentDirectory({ homeDirectory, environment: {} }))
      .toBe(join(homeDirectory, '.pi', 'agent'))
    expect(resolvePiAgentDirectory({ homeDirectory, environment: { PI_CODING_AGENT_DIR: '' } }))
      .toBe(join(homeDirectory, '.pi', 'agent'))
  })

  it('honors an explicit absolute Pi Agent directory', () => {
    const agentDirectory = resolve('/fixture-agent')
    expect(resolvePiAgentDirectory({
      homeDirectory,
      environment: { PI_CODING_AGENT_DIR: agentDirectory },
    })).toBe(agentDirectory)
  })

  it('expands bare and prefixed tilde against the supplied home', () => {
    expect(resolvePiAgentDirectory({ homeDirectory, environment: { PI_CODING_AGENT_DIR: '~' } }))
      .toBe(homeDirectory)
    expect(resolvePiAgentDirectory({ homeDirectory, environment: { PI_CODING_AGENT_DIR: '~/custom-agent' } }))
      .toBe(join(homeDirectory, 'custom-agent'))
  })

  it('resolves relative overrides once against the Main startup directory', () => {
    expect(resolvePiAgentDirectory({
      homeDirectory,
      cwd: startupCwd,
      environment: { PI_CODING_AGENT_DIR: './agent/../custom-agent' },
    })).toBe(join(startupCwd, 'custom-agent'))
  })

  it('preserves literal spaces and does not expand another user tilde', () => {
    expect(resolvePiAgentDirectory({
      homeDirectory,
      cwd: startupCwd,
      environment: { PI_CODING_AGENT_DIR: '~someone/agent with spaces ' },
    })).toBe(join(startupCwd, '~someone', 'agent with spaces '))
  })

  it('supports the Pi file URL override form', () => {
    const agentDirectory = resolve('/fixture-agent with spaces')
    expect(resolvePiAgentDirectory({
      homeDirectory,
      environment: { PI_CODING_AGENT_DIR: pathToFileURL(agentDirectory).href },
    })).toBe(agentDirectory)
  })

  it('keeps test defaults and tilde paths isolated while honoring an explicit fixture', () => {
    const userData = resolve('/fixture-test/user-data')
    const isolatedHome = join(userData, 'home')
    const fixtureAgent = resolve('/fixture-test/pi-agent')
    expect(resolvePiAgentDirectory({ homeDirectory: isolatedHome, environment: {}, isolatedTest: true }))
      .toBe(join(isolatedHome, '.pi', 'agent'))
    expect(resolvePiAgentDirectory({
      homeDirectory: isolatedHome,
      isolatedTest: true,
      environment: { PIPILOT_E2E_AGENT_DIR: '~/.pi/agent' },
    })).toBe(join(isolatedHome, '.pi', 'agent'))
    expect(resolvePiAgentDirectory({
      homeDirectory: isolatedHome,
      isolatedTest: true,
      environment: {
        PI_CODING_AGENT_DIR: resolve('/ambient-agent'),
        PIPILOT_E2E_AGENT_DIR: fixtureAgent,
      },
    })).toBe(fixtureAgent)
  })

  it('ignores an inherited official Agent directory during an isolated test', () => {
    const isolatedHome = resolve('/fixture-test/user-data/home')
    expect(resolvePiAgentDirectory({
      homeDirectory: isolatedHome,
      isolatedTest: true,
      environment: { PI_CODING_AGENT_DIR: resolve('/ambient-home/.pi/agent') },
    })).toBe(join(isolatedHome, '.pi', 'agent'))
  })

  it('ignores test-only overrides in production even when they are inherited', () => {
    const agentDirectory = resolve('/production-agent')
    const testDirectory = resolve('/test-agent')
    expect(resolvePiAgentDirectory({
      homeDirectory,
      environment: { PI_CODING_AGENT_DIR: agentDirectory, PIPILOT_E2E_AGENT_DIR: testDirectory },
    })).toBe(agentDirectory)
    expect(resolvePiAgentDirectory({
      homeDirectory,
      environment: { PIPILOT_E2E_AGENT_DIR: testDirectory },
    })).toBe(join(homeDirectory, '.pi', 'agent'))
  })

  it('rejects a relative home before resolving any configuration path', () => {
    expect(() => resolvePiAgentDirectory({ homeDirectory: 'relative-home', environment: {} }))
      .toThrow('must be absolute')
  })

  it.skipIf(process.platform !== 'win32')('supports Windows tilde and shell drive paths', () => {
    expect(resolvePiAgentDirectory({ homeDirectory, environment: { PI_CODING_AGENT_DIR: '~\\custom-agent' } }))
      .toBe(join(homeDirectory, 'custom-agent'))
    for (const directory of ['/c/pi-agent', '/mnt/c/pi-agent', '/cygdrive/c/pi-agent']) {
      expect(resolvePiAgentDirectory({ homeDirectory, environment: { PI_CODING_AGENT_DIR: directory } }))
        .toBe('C:\\pi-agent')
    }
  })
})
