import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildNotices, describePackage, packageRootOf, runtimeDependencyRoots } from '../../build/third-party-notices.mjs'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'pipilot-notices-'))
  roots.push(root)
  const write = async (path: string, value: unknown) => {
    await mkdir(join(root, path, '..'), { recursive: true })
    await writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value))
  }
  await write('package.json', { name: 'app', version: '1.0.0', dependencies: { alpha: '1' }, devDependencies: { bundled: '1' } })
  await write('node_modules/alpha/package.json', { name: 'alpha', version: '1.2.0', license: 'MIT', repository: 'git+https://github.com/x/alpha.git', dependencies: { beta: '1' } })
  await write('node_modules/alpha/LICENSE', 'MIT License\nCopyright Alpha')
  await write('node_modules/alpha/node_modules/beta/package.json', { name: 'beta', version: '2.0.0', license: { type: 'ISC' } })
  await write('node_modules/beta/package.json', { name: 'beta', version: '9.9.9', license: 'MIT' })
  await write('node_modules/bundled/package.json', { name: 'bundled', version: '3.0.0', license: 'Apache-2.0' })
  await write('node_modules/bundled/dist/esm/package.json', { type: 'module' })
  await write('node_modules/bundled/dist/esm/index.js', '')
  await write('node_modules/bundled/LICENSE.md', 'MIT License\nCopyright Alpha')
  return root
}

describe('third-party notices', () => {
  it('names the package a bundled file belongs to, past nested module-type manifests', async () => {
    const root = await project()
    expect(packageRootOf(join(root, 'node_modules/bundled/dist/esm/index.js'))).toBe(join(root, 'node_modules/bundled'))
    expect(packageRootOf(join(root, 'src/app.ts'))).toBeUndefined()
  })

  it('follows the shipped dependency tree with Node resolution, not devDependencies', async () => {
    const root = await project()
    const names = [...runtimeDependencyRoots(root)].map((path) => describePackage(path)).map(({ name, version }) => `${name}@${version}`)
    expect(names.sort()).toEqual(['alpha@1.2.0', 'beta@2.0.0'])
  })

  it('reads license names and files, and stores identical texts once', async () => {
    const root = await project()
    const alpha = describePackage(join(root, 'node_modules/alpha'))
    expect(alpha).toMatchObject({ license: 'MIT', url: 'https://github.com/x/alpha', text: 'MIT License\nCopyright Alpha' })
    const notices = buildNotices([alpha, describePackage(join(root, 'node_modules/bundled')), describePackage(join(root, 'node_modules/alpha/node_modules/beta'))])
    expect(notices.packages.map(({ name, license }) => `${name}:${license}`)).toEqual(['alpha:MIT', 'beta:ISC', 'bundled:Apache-2.0'])
    expect(Object.keys(notices.texts)).toHaveLength(1)
    expect(notices.packages[0]!.textId).toBe(notices.packages[2]!.textId)
    expect(notices.packages[1]!.textId).toBeUndefined()
  })
})
