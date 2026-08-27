const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const platform = process.argv[2]
const releaseDirectory = path.resolve(process.argv[3] || 'release')
const version = String(JSON.parse(fs.readFileSync('package.json', 'utf8')).version)

if (!['macos', 'windows', 'linux'].includes(platform)) {
  throw new Error(`unsupported release platform: ${platform}`)
}

// electron-builder may generate macOS update metadata whenever ZIP targets and
// a publish provider are present. PiPilot's unsigned/ad-hoc macOS build is
// manual-download only, so this file must never enter the candidate inventory.
if (platform === 'macos') {
  fs.rmSync(path.join(releaseDirectory, 'latest-mac.yml'), { force: true })
}

const patterns = {
  macos: [/\.dmg$/i, /\.zip$/i],
  windows: [/\.exe$/i, /^latest\.yml$/i, /\.blockmap$/i],
  linux: [/\.AppImage$/i, /\.deb$/i, /latest-linux\.yml$/i, /\.blockmap$/i],
}[platform]

const isCurrentVersionBlockmap = (name) =>
  name.includes(version) && name.endsWith('.blockmap')

const names = fs.existsSync(releaseDirectory)
  ? fs.readdirSync(releaseDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => patterns.some((pattern) => pattern.test(name)))
    .filter((name) => name.includes(version) || /^latest(-linux)?\.yml$/i.test(name) || isCurrentVersionBlockmap(name))
    .sort()
  : []

if (names.length === 0) throw new Error(`no release assets found in ${releaseDirectory}`)
const directoryNames = fs.existsSync(releaseDirectory)
  ? fs.readdirSync(releaseDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
  : []
if (platform === 'macos' && directoryNames.some((name) => /^latest(-mac)?\.yml$/i.test(name))) {
  throw new Error('macOS release must not contain updater metadata')
}
if (platform === 'windows' && !names.some((name) => /^latest\.yml$/i.test(name))) {
  throw new Error('windows release is missing latest.yml')
}
if (platform === 'linux' && !names.some((name) => /^latest-linux\.yml$/i.test(name))) {
  throw new Error('linux release is missing latest-linux.yml')
}

const expectedArchitectures = platform === 'macos' ? ['arm64', 'x64'] : ['x64']
const architectureAliases = {
  arm64: ['arm64', 'aarch64'],
  x64: ['x64', 'x86_64', 'amd64'],
}
const packageNames = platform === 'macos'
  ? names.filter((name) => /\.(dmg|zip)$/iu.test(name))
  : platform === 'windows'
    ? names.filter((name) => /\.exe$/iu.test(name))
    : names.filter((name) => /\.(AppImage|deb)$/iu.test(name))
const observedArchitectures = [...new Set(
  packageNames.flatMap((name) =>
    expectedArchitectures.filter((arch) =>
      architectureAliases[arch].some((alias) => name.includes(`-${alias}.`)),
    ),
  ),
)].sort()
if (observedArchitectures.join(',') !== expectedArchitectures.slice().sort().join(',')) {
  throw new Error(`${platform} release architecture inventory mismatch: expected ${expectedArchitectures.join(', ')}, found ${observedArchitectures.join(', ') || 'none'}`)
}
if (platform === 'macos' && packageNames.length !== 4) {
  throw new Error(`macOS release must contain exactly four DMG/ZIP assets, found ${packageNames.length}`)
}
if (platform === 'windows' && packageNames.length !== 1) {
  throw new Error(`Windows release must contain exactly one NSIS package, found ${packageNames.length}`)
}
if (platform === 'linux' && packageNames.length !== 2) {
  throw new Error(`Linux release must contain exactly two package assets, found ${packageNames.length}`)
}
const expectedExtensions = platform === 'macos'
  ? ['.dmg', '.zip']
  : platform === 'windows'
    ? ['.exe']
    : ['.AppImage', '.deb']
for (const extension of expectedExtensions) {
  if (!packageNames.some((name) => name.endsWith(extension))) {
    throw new Error(`${platform} release is missing ${extension} package output`)
  }
}

const files = names.map((name) => {
  const content = fs.readFileSync(path.join(releaseDirectory, name))
  return {
    name,
    size: content.length,
    sha256: crypto.createHash('sha256').update(content).digest('hex'),
  }
})
const manifest = {
  version,
  platform,
  architectures: expectedArchitectures,
  trust: platform === 'macos' ? 'adhoc-no-developer-id' : 'unsigned',
  // Windows metadata is shipped for a future native canary, but the current
  // application deliberately keeps unsigned NSIS updates manual until that
  // canary proves the official updater path on a Windows runner.
  updateCapability: platform === 'linux' ? 'native-install' : 'manual-release',
  files,
}
fs.writeFileSync(path.join(releaseDirectory, `${platform}-manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`)
fs.writeFileSync(
  path.join(releaseDirectory, `${platform}-SHA256SUMS.txt`),
  `${files.map((file) => `${file.sha256}  ${file.name}`).join('\n')}\n`,
)
process.stdout.write(`${JSON.stringify(manifest)}\n`)
