import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { bundledNpmCommand, prependWindowsNodePath } from '../../src/main/bundled-npm'

const require = createRequire(import.meta.url)
const { bundleWindowsNode } = require('../../build/bundle-windows-node.cjs') as {
  bundleWindowsNode(resources: string, arch: number): void
}

it.skipIf(process.platform !== 'win32')('builds usable Windows npm/npx and child node without a system or fnm PATH', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pipilot-windows-node-'))
  const resources = join(root, '中文 App (A) & Notes', 'resources')
  const environment: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() === 'path' || key === 'ELECTRON_RUN_AS_NODE') delete environment[key]
  }
  environment.Path = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
  const originalPath = process.env.PATH
  try {
    bundleWindowsNode(resources, 1)
    await cp(dirname(require.resolve('pipilot-npm/package.json')), join(resources, 'npm'), { recursive: true, dereference: true })
    const runtime = join(resources, 'node')
    const sourceUrl = pathToFileURL(join(resources, 'app.asar', 'out', 'main', 'chunks', 'bundled.js')).href
    expect(bundledNpmCommand(sourceUrl)).toEqual([join(runtime, 'npm.cmd')])
    prependWindowsNodePath(environment, runtime)
    const exec = promisify(execFile)
    const shell = process.env.ComSpec ?? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe')
    const run = (command: string, cwd = root) => exec(shell, ['/d', '/s', '/c', command], { cwd, env: environment, windowsHide: true, timeout: 30_000 })
    expect((await run('node --version')).stdout.trim()).toBe('v24.18.0')
    expect((await run('npm --version')).stdout.trim()).toBe('12.2.0')
    expect((await run('npx --version')).stdout.trim()).toBe('12.2.0')
    expect(await readFile(join(runtime, 'LICENSE'), 'utf8')).toContain('Node.js')
    const project = join(root, '中文 Project With Spaces')
    await mkdir(project)
    await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'canary', version: '1.0.0', scripts: { check: 'node check.cjs' } }))
    await writeFile(join(project, 'check.cjs'), "process.stdout.write(require('node:child_process').execFileSync('node', ['--version'], { windowsHide: true }))")
    expect((await run('npm run check', project)).stdout).toContain('v24.18.0')
  } finally {
    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)
