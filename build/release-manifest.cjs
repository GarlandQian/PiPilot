const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const inventory = require('./release-inventory.cjs')

const platform = process.argv[2]
const releaseDirectory = path.resolve(process.argv[3] || 'release')
const version = String(JSON.parse(fs.readFileSync('package.json', 'utf8')).version)

if (!inventory.architectures[platform]) {
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
  windows: [/\.exe$/i, /\.zip$/i, /^latest\.yml$/i, /\.blockmap$/i],
  linux: [/\.AppImage$/i, /\.deb$/i, /\.rpm$/i, /^latest-linux\.yml$/i, /\.blockmap$/i],
  'linux-arm64': [/\.AppImage$/i, /\.deb$/i, /\.rpm$/i, /^latest-linux-arm64\.yml$/i, /\.blockmap$/i],
}[platform]

const isCurrentVersionBlockmap = (name) =>
  name.includes(version) && name.endsWith('.blockmap')

const names = fs.existsSync(releaseDirectory)
  ? fs.readdirSync(releaseDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => patterns.some((pattern) => pattern.test(name)))
    .filter((name) => name.includes(version) || /^latest(-linux(-arm64)?)?\.yml$/i.test(name) || isCurrentVersionBlockmap(name))
    .filter((name) => name.endsWith('.yml') || inventory.architectures[platform].some((arch) => inventory.hasArchitecture(name, arch)))
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
if (platform === 'linux-arm64' && !names.includes('latest-linux-arm64.yml')) throw new Error('linux-arm64 release is missing latest-linux-arm64.yml')

const expectedArchitectures = inventory.architectures[platform]
const packageNames = platform === 'macos'
  ? names.filter((name) => /\.(dmg|zip)$/iu.test(name))
  : platform === 'windows'
    ? names.filter((name) => /\.(exe|zip)$/iu.test(name))
    : names.filter((name) => /\.(AppImage|deb|rpm)$/iu.test(name))
inventory.assertPackages(platform, version, packageNames)
const observedArchitectures = [...new Set(
  packageNames.flatMap((name) =>
    expectedArchitectures.filter((arch) =>
      inventory.hasArchitecture(name, arch),
    ),
  ),
)].sort()
for (const name of packageNames) {
  if (!name.startsWith(`PiPilot-${version}-${inventory.os(platform)}-`)) {
    throw new Error(`${platform} package must identify its version and platform: ${name}`)
  }
}
if (observedArchitectures.join(',') !== expectedArchitectures.slice().sort().join(',')) {
  throw new Error(`${platform} release architecture inventory mismatch: expected ${expectedArchitectures.join(', ')}, found ${observedArchitectures.join(', ') || 'none'}`)
}
if (platform === 'macos' && packageNames.length !== 4) {
  throw new Error(`macOS release must contain exactly four DMG/ZIP assets, found ${packageNames.length}`)
}
if (platform === 'windows' && packageNames.length !== 3) {
  throw new Error(`Windows release must contain three package assets, found ${packageNames.length}`)
}
if (platform.startsWith('linux') && packageNames.length !== 3) {
  throw new Error(`Linux release must contain three package assets per architecture, found ${packageNames.length}`)
}
const expectedExtensions = platform === 'macos'
  ? ['.dmg', '.zip']
  : platform === 'windows'
    ? ['.exe', '.zip']
    : ['.AppImage', '.deb', '.rpm']
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
  // Windows NSIS and Linux AppImage use the official updater. macOS remains
  // manual until Developer ID signing and notarization are configured.
  updateCapability: platform === 'macos' ? 'manual-release' : 'native-install',
  files,
}
fs.writeFileSync(path.join(releaseDirectory, `${platform}-manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`)
fs.writeFileSync(
  path.join(releaseDirectory, `${platform}-SHA256SUMS.txt`),
  `${files.map((file) => `${file.sha256}  ${file.name}`).join('\n')}\n`,
)
process.stdout.write(`${JSON.stringify(manifest)}\n`)
