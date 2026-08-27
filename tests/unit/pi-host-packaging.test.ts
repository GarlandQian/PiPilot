import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const projectRoot = process.cwd()

describe('embedded Pi host packaging', () => {
  it('pins the official Pi SDK as an exact production dependency', async () => {
    const manifest = JSON.parse(
      await readFile(join(projectRoot, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    expect(manifest.dependencies?.['@earendil-works/pi-coding-agent']).toBe('0.84.2')
    expect(manifest.devDependencies?.['@earendil-works/pi-coding-agent']).toBeUndefined()
  })

  it('emits a stable utility entry and unpacks its native, WASM, and worker assets', async () => {
    const viteConfig = await readFile(join(projectRoot, 'electron.vite.config.ts'), 'utf8')
    const builderConfig = await readFile(join(projectRoot, 'electron-builder.yml'), 'utf8')

    expect(viteConfig).toContain(
      "'pi-host-utility': resolve(projectRoot, 'src/main/pi-host/pi-host-utility.ts')",
    )
    expect(builderConfig).toContain(
      'node_modules/@earendil-works/pi-coding-agent/dist/utils/image-resize-worker.js',
    )
    expect(builderConfig).toContain(
      'node_modules/@earendil-works/pi-tui/native/**/prebuilds/**/*',
    )
    expect(builderConfig).toContain('node_modules/@mariozechner/clipboard-*/**/*.node')
    expect(builderConfig).toContain('node_modules/@silvia-odwyer/photon-node/**/*.wasm')
  })
})
