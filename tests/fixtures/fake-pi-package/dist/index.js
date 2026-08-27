import {
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const VERSION = '0.84.1'

const fixtureRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const managedRoot = join(fixtureRoot, 'managed')
const PLAN_MODE_SOURCE = 'npm:@narumitw/pi-plan-mode@0.50.1'
const RETRY_SOURCE = 'npm:@narumitw/pi-retry@0.31.0'

function richPackageSources() {
  return process.env.FAKE_PI_RICH_ADAPTERS === '1'
    ? [PLAN_MODE_SOURCE, RETRY_SOURCE]
    : []
}

function defaultState() {
  return {
    global: ['npm:fake-global-package@1.0.0', ...richPackageSources()],
    project: ['git:https://example.test/fake-project-package.git@v2'],
    retry: {
      globalEnabled: true,
      ...(process.env.FAKE_PI_RICH_ADAPTERS === '1' ? { projectEnabled: false } : {}),
      maxRetries: 3,
      baseDelayMs: 1000,
    },
  }
}

function statePath(agentDir) {
  return join(agentDir, 'fake-pi-management.json')
}

function readState(agentDir) {
  try {
    const parsed = JSON.parse(readFileSync(statePath(agentDir), 'utf8'))
    const global = Array.isArray(parsed.global) ? parsed.global : []
    for (const source of richPackageSources()) {
      if (!global.includes(source)) global.push(source)
    }
    return {
      global,
      project: Array.isArray(parsed.project) ? parsed.project : [],
      retry: {
        globalEnabled: typeof parsed.retry?.globalEnabled === 'boolean'
          ? parsed.retry.globalEnabled
          : parsed.retry?.enabled !== false,
        ...(typeof parsed.retry?.projectEnabled === 'boolean'
          ? { projectEnabled: parsed.retry.projectEnabled }
          : process.env.FAKE_PI_RICH_ADAPTERS === '1'
            ? { projectEnabled: false }
            : {}),
        maxRetries: Number.isInteger(parsed.retry?.maxRetries) ? parsed.retry.maxRetries : 3,
        baseDelayMs: Number.isInteger(parsed.retry?.baseDelayMs) ? parsed.retry.baseDelayMs : 1000,
      },
    }
  } catch {
    return defaultState()
  }
}

async function writeState(agentDir, state) {
  await mkdir(agentDir, { recursive: true })
  await writeFile(statePath(agentDir), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

export function getAgentDir() {
  return process.env.FAKE_PI_AGENT_DIR || join(fixtureRoot, '.agent')
}

export class SettingsManager {
  static create(cwd, agentDir, options) {
    if (options?.projectTrusted !== true) throw new Error('Expected a trusted selected project.')
    return new SettingsManager(cwd, agentDir)
  }

  constructor(cwd, agentDir) {
    this.cwd = cwd
    this.agentDir = agentDir
    this.state = readState(agentDir)
    this.errors = []
  }

  getRetrySettings() {
    const projectEnabled = process.env.FAKE_PI_PROJECT_CWD &&
      this.cwd === process.env.FAKE_PI_PROJECT_CWD &&
      typeof this.state.retry.projectEnabled === 'boolean'
      ? this.state.retry.projectEnabled
      : undefined
    return {
      enabled: projectEnabled ?? this.state.retry.globalEnabled,
      maxRetries: this.state.retry.maxRetries,
      baseDelayMs: this.state.retry.baseDelayMs,
    }
  }

  getGlobalSettings() {
    return {
      retry: {
        enabled: this.state.retry.globalEnabled,
        maxRetries: this.state.retry.maxRetries,
        baseDelayMs: this.state.retry.baseDelayMs,
      },
    }
  }

  setRetryEnabled(enabled) {
    const errorMarker = process.env.FAKE_PI_RETRY_WRITE_ERROR_FILE
    if (errorMarker && existsSync(errorMarker)) {
      this.errors.push({ scope: 'global', error: new Error('Fixture global retry write failed') })
      return
    }
    this.state.retry.globalEnabled = enabled
  }

  drainErrors() {
    const errors = [...this.errors]
    this.errors = []
    return errors
  }

  async flush() {
    if (this.errors.length > 0) return
    await writeState(this.agentDir, this.state)
  }
}

function configuredPackage(source, scope) {
  const global = scope === 'user'
  const managedDirectory = source === PLAN_MODE_SOURCE
    ? 'plan-mode'
    : source === RETRY_SOURCE
      ? 'retry'
      : global
        ? 'global-package'
        : 'project-package'
  return {
    source,
    scope,
    filtered: false,
    installedPath: join(managedRoot, managedDirectory),
  }
}

function resource(path, source, scope, origin = 'package', enabled = true) {
  return {
    path,
    enabled,
    metadata: { source, scope, origin, baseDir: dirname(path) },
  }
}

export class DefaultPackageManager {
  constructor({ cwd, agentDir, settingsManager }) {
    this.cwd = cwd
    this.agentDir = agentDir
    this.settingsManager = settingsManager
    this.progress = undefined
  }

  setProgressCallback(callback) {
    this.progress = callback
  }

  listConfiguredPackages() {
    const state = this.settingsManager.state
    return [
      ...state.global.map((source) => configuredPackage(source, 'user')),
      ...state.project.map((source) => configuredPackage(source, 'project')),
    ]
  }

  async resolve() {
    const includeProject = !process.env.FAKE_PI_PROJECT_CWD ||
      this.cwd === process.env.FAKE_PI_PROJECT_CWD
    const globalSource = this.settingsManager.state.global[0] || 'npm:fake-global-package@1.0.0'
    const projectSource = this.settingsManager.state.project[0] || 'git:https://example.test/fake-project-package.git@v2'
    const richExtensions = this.settingsManager.state.global
      .filter((source) => source === PLAN_MODE_SOURCE || source === RETRY_SOURCE)
      .map((source) => resource(
        join(managedRoot, source === PLAN_MODE_SOURCE ? 'plan-mode' : 'retry', 'extension.ts'),
        source,
        'user',
      ))
    return {
      extensions: [resource(
        join(managedRoot, 'global-package', 'extension.ts'),
        globalSource,
        'user',
      ), ...richExtensions],
      skills: [resource(
        join(managedRoot, 'global-package', 'skills', 'review', 'SKILL.md'),
        globalSource,
        'user',
      )],
      prompts: includeProject
        ? [resource(
            join(managedRoot, 'project-package', 'prompts', 'ship.md'),
            projectSource,
            'project',
          )]
        : [],
      themes: [resource(
        join(managedRoot, 'global-package', 'themes', 'fixture.json'),
        globalSource,
        'user',
      )],
    }
  }

  async installAndPersist(source, { local = false } = {}) {
    await this.install(source, { local })
    const key = local ? 'project' : 'global'
    if (!this.settingsManager.state[key].includes(source)) this.settingsManager.state[key].push(source)
    await this.settingsManager.flush()
  }

  async install(source, { local = false } = {}) {
    this.progress?.({ type: 'start', action: 'install', source, message: 'Preparing package' })
    this.progress?.({ type: 'complete', action: 'install', source, message: 'Package installed' })
    this.settingsManager.state.lastInstall = { source, scope: local ? 'project' : 'global' }
  }

  async removeAndPersist(source, { local = false } = {}) {
    this.progress?.({ type: 'start', action: 'remove', source })
    const key = local ? 'project' : 'global'
    const before = this.settingsManager.state[key].length
    this.settingsManager.state[key] = this.settingsManager.state[key].filter((entry) => entry !== source)
    await this.settingsManager.flush()
    this.progress?.({ type: 'complete', action: 'remove', source })
    return this.settingsManager.state[key].length !== before
  }

  async update(source) {
    this.progress?.({ type: 'start', action: 'update', source })
    this.progress?.({ type: 'complete', action: 'update', source })
  }

  async checkForAvailableUpdates() {
    return [
      ...this.settingsManager.state.global.map((source) => ({
        source,
        displayName: 'Fake Global Package',
        type: 'npm',
        scope: 'user',
      })),
      ...this.settingsManager.state.project.map((source) => ({
        source,
        displayName: 'Fake Project Package',
        type: 'git',
        scope: 'project',
      })),
    ]
  }
}

export function loadSkills({ skillPaths }) {
  return {
    skills: skillPaths.map((filePath) => ({
      name: 'fixture-review',
      description: 'Reviews the fixture workspace without exposing secrets.',
      filePath,
    })),
    diagnostics: [],
  }
}

// Keep the fixture import observably backed by real package-owned files.
export async function readFixtureManifest() {
  return JSON.parse(await readFile(join(fixtureRoot, 'package.json'), 'utf8'))
}
