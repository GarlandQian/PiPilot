const { spawnSync } = require('node:child_process')
const { copyFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')

const version = require('../package.json').version
const result = spawnSync(process.execPath, [
  require.resolve('electron-builder/cli.js'), '--config', 'electron-builder.portable.yml',
  '--win', '--x64', '--publish', 'never',
], { stdio: 'inherit' })
if (result.error) throw result.error
if (result.status !== 0) throw new Error(`Portable packaging exited with ${result.status}`)
for (const extension of ['exe', 'zip']) {
  const name = `PiPilot-${version}-windows-x64-portable.${extension}`
  const source = join('release', 'portable', name)
  if (!existsSync(source)) throw new Error(`Missing portable package: ${name}`)
  copyFileSync(source, join('release', name))
}
