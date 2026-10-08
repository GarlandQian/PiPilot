// Only disposable Linux release runners build the older AppImage fixture. The
// candidate artifacts and production updater configuration are never rewritten.
const { spawnSync } = require('node:child_process')
const { appendFileSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } = require('node:fs')
const { createServer } = require('node:net')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

async function main() {
  if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch) || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.CI !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
    throw new Error('The Linux package canary requires a disposable GitHub Actions Linux x64 or arm64 runner.')
  }
  if (!process.env.GITHUB_ENV) throw new Error('Missing GitHub Actions environment file.')
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version
  if (!/^\d+\.\d+\.\d+$/.test(version) || version === '0.0.0') throw new Error('A stable candidate newer than 0.0.0 is required.')
  const root = mkdtempSync(join(tmpdir(), 'pipilot-packaged-smoke-linux-'))
  const output = join(root, 'older-appimage')
  // The port is embedded in immutable fixture A. If another process takes it
  // before the test, binding fails; the test never uses somebody else's feed.
  const server = createServer()
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture feed port.')
  const feedPort = address.port
  await new Promise((done, fail) => server.close((error) => error ? fail(error) : done()))
  const configPath = join(root, 'builder.json')
  writeFileSync(configPath, JSON.stringify({
    extends: resolve('electron-builder.yml'),
    directories: { output },
    extraMetadata: { version: '0.0.0' },
    publish: { provider: 'generic', url: `http://127.0.0.1:${feedPort}/`, channel: 'latest' },
    npmRebuild: false,
  }, null, 2))
  const built = spawnSync(process.execPath, [
    require.resolve('electron-builder/cli.js'), '--config', configPath,
    '--linux', 'AppImage', `--${process.arch}`, '--publish', 'never',
  ], { stdio: 'inherit' })
  if (built.error) throw built.error
  if (built.status !== 0) throw new Error(`The older AppImage build exited with ${built.status}.`)
  const images = readdirSync(output).filter((file) => file.endsWith('.AppImage'))
  if (images.length !== 1) throw new Error('Expected exactly one older fixture AppImage.')
  writeFileSync(join(root, 'canary.json'), JSON.stringify({
    candidateDirectory: resolve('release'), version, feedPort,
    olderAppImage: join(output, images[0]),
  }, null, 2))
  appendFileSync(process.env.GITHUB_ENV, `PIPILOT_LINUX_PACKAGE_CANARY=${root}\n`)
  console.log(`Prepared Linux AppImage canary A=0.0.0 → B=${version}, plus candidate DEB installation.`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
