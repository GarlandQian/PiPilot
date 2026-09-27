// Build an older fixture installer from the same reviewed source. The release
// candidate, repository metadata and executable security fuses are untouched.
const { spawnSync } = require('node:child_process')
const { appendFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true') {
  throw new Error('The Windows installer canary must run on a disposable GitHub Actions Windows runner.')
}
const root = mkdtempSync(join(tmpdir(), 'pipilot-packaged-smoke-update-'))
const output = join(root, 'older-installer')
const candidateDirectory = resolve('release')
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
if (!/^\d+\.\d+\.\d+$/.test(version) || version === '0.0.0') throw new Error('A stable candidate newer than 0.0.0 is required.')
const builder = require.resolve('electron-builder/cli.js')
const built = spawnSync(process.execPath, [
  builder, '--config', 'electron-builder.update.yml', '--win', '--x64', '--publish', 'never',
  '--config.extraMetadata.version=0.0.0',
  `--config.directories.output=${output}`,
  '--config.npmRebuild=false',
], { stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } })
if (built.error) throw built.error
if (built.status !== 0) throw new Error(`The older fixture installer build exited with ${built.status}.`)
const installers = readdirSync(output).filter((file) => file.endsWith('.exe'))
if (installers.length !== 1) throw new Error('Expected exactly one older fixture installer.')
writeFileSync(join(root, 'canary.json'), JSON.stringify({
  candidateDirectory, version, olderInstaller: join(output, installers[0]),
}, null, 2))
if (!process.env.GITHUB_ENV) throw new Error('Missing GitHub Actions environment file.')
appendFileSync(process.env.GITHUB_ENV, `PIPILOT_WINDOWS_UPDATE_CANARY=${root}\n`)
console.log(`Prepared Windows updater canary A=0.0.0 → B=${version}.`)
