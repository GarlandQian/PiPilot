import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { resolvePackagedExecutable } from './resolve-packaged-executable'

test('runs packaged npm and installs a local extension without system Node or npm on PATH', async () => {
  const executable = resolvePackagedExecutable()
  const resources = process.platform === 'darwin'
    ? resolve(dirname(executable), '..', 'Resources')
    : join(dirname(executable), 'resources')
  const runner = join(resources, 'app.asar', 'out', 'main', 'npm-runner.js')
  const root = await mkdtemp(join(tmpdir(), 'pipilot-packaged-npm-'))
  try {
    const environment = { ...process.env, ELECTRON_RUN_AS_NODE: '1', npm_config_cache: join(root, 'cache') }
    for (const key of Object.keys(environment)) if (key.toLowerCase() === 'path') delete environment[key as keyof typeof environment]
    Object.assign(environment, { PATH: '' })
    const run = (args: string[]) => promisify(execFile)(executable, [runner, '--', 'npm', ...args], {
      env: environment, timeout: 60_000, windowsHide: true,
    })
    expect((await run(['--version'])).stdout.trim()).toBe('12.2.0')
    const source = join(root, 'extension with spaces')
    const prefix = join(root, 'agent', 'npm')
    await mkdir(source, { recursive: true })
    await mkdir(prefix, { recursive: true })
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'pipilot-offline-test-extension', version: '1.0.0' }))
    await writeFile(join(prefix, 'package.json'), '{"private":true}')
    await run(['install', source, '--prefix', prefix, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps'])
    expect(JSON.parse(await readFile(join(prefix, 'node_modules', 'pipilot-offline-test-extension', 'package.json'), 'utf8')).version).toBe('1.0.0')
  } finally { await rm(root, { recursive: true, force: true }) }
})
