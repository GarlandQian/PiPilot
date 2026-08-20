const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const releaseDirectory = path.resolve(process.argv[2] || 'release')
const expectedVersion = String(process.argv[3] || '')
const platforms = ['macos', 'windows', 'linux']
const expectedArchitectures = {
  macos: ['arm64', 'x64'],
  windows: ['x64'],
  linux: ['x64'],
}
const architectureAliases = {
  arm64: ['arm64', 'aarch64'],
  x64: ['x64', 'x86_64', 'amd64'],
}
const expectedTrust = {
  macos: 'adhoc-no-developer-id',
  windows: 'unsigned',
  linux: 'unsigned',
}
const expectedUpdateCapability = {
  macos: 'manual-release',
  windows: 'manual-release',
  linux: 'native-install',
}
const expectedPackageExtensions = {
  macos: ['.dmg', '.zip'],
  windows: ['.exe'],
  linux: ['.AppImage', '.deb'],
}
const expectedPackageCounts = {
  macos: 4,
  windows: 1,
  linux: 2,
}

if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(expectedVersion)) {
  throw new Error(`invalid expected release version: ${expectedVersion}`)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(releaseDirectory, file), 'utf8'))
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function sha512(file) {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64')
}

function parseScalar(value, field, metadataFile) {
  const trimmed = value.trim()
  const unquoted = trimmed.match(/^(?:'([^']*)'|"([^"]*)"|([^#\s][^#]*?))\s*(?:#.*)?$/u)
  const result = unquoted?.[1] ?? unquoted?.[2] ?? unquoted?.[3]?.trim()
  if (!result) throw new Error(`${metadataFile} has an invalid ${field}`)
  return result
}

function parseUpdateMetadata(metadataFile) {
  const metadataPath = path.join(releaseDirectory, metadataFile)
  const stat = fs.statSync(metadataPath)
  if (!stat.isFile() || stat.size <= 0 || stat.size > 64 * 1024) {
    throw new Error(`${metadataFile} has an invalid size`)
  }

  const text = fs.readFileSync(metadataPath, 'utf8')
  const versionMatch = /^version:\s*(.+)$/mu.exec(text)
  const pathMatch = /^path:\s*(.+)$/mu.exec(text)
  const legacyShaMatch = /^sha512:\s*(.+)$/mu.exec(text)
  const filesStart = text.search(/^files:\s*$/mu)
  if (!versionMatch || !pathMatch || !legacyShaMatch || filesStart < 0) {
    throw new Error(`${metadataFile} is missing required updater fields`)
  }

  const entries = []
  const lines = text.slice(filesStart).split(/\r?\n/u).slice(1)
  let current = null
  for (const line of lines) {
    if (/^\S/u.test(line)) break
    const urlMatch = /^\s*-\s+url:\s*(.+)$/u.exec(line)
    if (urlMatch) {
      if (current) entries.push(current)
      current = { url: parseScalar(urlMatch[1], 'files.url', metadataFile) }
      continue
    }
    if (!current) continue
    const shaMatch = /^\s+sha512:\s*(.+)$/u.exec(line)
    if (shaMatch) {
      current.sha512 = parseScalar(shaMatch[1], 'files.sha512', metadataFile)
      continue
    }
    const sizeMatch = /^\s+size:\s*(.+)$/u.exec(line)
    if (sizeMatch) current.size = Number(parseScalar(sizeMatch[1], 'files.size', metadataFile))
  }
  if (current) entries.push(current)

  return {
    version: parseScalar(versionMatch[1], 'version', metadataFile),
    path: parseScalar(pathMatch[1], 'path', metadataFile),
    sha512: parseScalar(legacyShaMatch[1], 'sha512', metadataFile),
    files: entries,
  }
}

function assertUpdateMetadata(
  metadataFile,
  expectedExtensions,
  primaryExtension,
  manifestFiles,
  requireExternalBlockmap,
) {
  const metadata = parseUpdateMetadata(metadataFile)
  if (metadata.version !== expectedVersion) {
    throw new Error(`${metadataFile} does not identify version ${expectedVersion}`)
  }

  const expectedPackages = [...manifestFiles]
    .filter((name) => expectedExtensions.some((extension) =>
      name.endsWith(extension)))
    .sort()
  const metadataPackages = metadata.files.map((entry) => entry?.url).sort()
  if (JSON.stringify(metadataPackages) !== JSON.stringify(expectedPackages)) {
    throw new Error(
      `${metadataFile} package inventory does not match its platform manifest`,
    )
  }

  for (const entry of metadata.files) {
    if (
      !entry ||
      typeof entry.url !== 'string' ||
      path.basename(entry.url) !== entry.url ||
      !expectedExtensions.some((extension) => entry.url.endsWith(extension))
    ) {
      throw new Error(`${metadataFile} references an unsafe or unexpected package`)
    }
    if (!manifestFiles.has(entry.url)) {
      throw new Error(`${metadataFile} references a package outside its platform manifest`)
    }

    const assetPath = path.join(releaseDirectory, entry.url)
    const stat = fs.statSync(assetPath)
    if (!Number.isSafeInteger(entry.size) || entry.size !== stat.size) {
      throw new Error(`${metadataFile} size does not match ${entry.url}`)
    }
    if (entry.sha512 !== sha512(assetPath)) {
      throw new Error(`${metadataFile} SHA-512 does not match ${entry.url}`)
    }
    if (requireExternalBlockmap && !manifestFiles.has(`${entry.url}.blockmap`)) {
      throw new Error(`${metadataFile} is missing the blockmap for ${entry.url}`)
    }
  }

  const primaryEntry = metadata.files.find((entry) =>
    entry.url.endsWith(primaryExtension))
  if (
    !primaryEntry ||
    metadata.path !== primaryEntry.url ||
    metadata.sha512 !== primaryEntry.sha512
  ) {
    throw new Error(
      `${metadataFile} legacy update fields do not match the primary package`,
    )
  }
}

const expectedAssets = new Set()
const manifestFilesByPlatform = new Map()
for (const platform of platforms) {
  const manifestFile = `${platform}-manifest.json`
  const sumsFile = `${platform}-SHA256SUMS.txt`
  const manifest = readJson(manifestFile)
  if (manifest.version !== expectedVersion) throw new Error(`${manifestFile} version mismatch`)
  if (manifest.platform !== platform) throw new Error(`${manifestFile} platform mismatch`)
  if (JSON.stringify(manifest.architectures) !== JSON.stringify(expectedArchitectures[platform])) {
    throw new Error(`${manifestFile} architecture mismatch`)
  }
  if (manifest.trust !== expectedTrust[platform]) throw new Error(`${manifestFile} trust policy mismatch`)
  if (manifest.updateCapability !== expectedUpdateCapability[platform]) {
    throw new Error(`${manifestFile} update capability mismatch`)
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > 32) {
    throw new Error(`${manifestFile} has no files`)
  }
  const manifestFiles = new Set(manifest.files.map((file) => file?.name))
  manifestFilesByPlatform.set(platform, manifestFiles)
  const packageFiles = manifest.files
    .map((file) => file?.name)
    .filter((name) => typeof name === 'string' && expectedPackageExtensions[platform].some((extension) => name.endsWith(extension)))
  if (packageFiles.length !== expectedPackageCounts[platform]) {
    throw new Error(`${manifestFile} package inventory mismatch`)
  }
  for (const extension of expectedPackageExtensions[platform]) {
    if (!packageFiles.some((name) => name.endsWith(extension))) {
      throw new Error(`${manifestFile} is missing a ${extension} package`)
    }
  }
  for (const arch of expectedArchitectures[platform]) {
    if (!packageFiles.some((name) =>
      architectureAliases[arch].some((alias) => name.includes(`-${alias}.`)))) {
      throw new Error(`${manifestFile} is missing the ${arch} package architecture`)
    }
  }
  const sumLines = fs.readFileSync(path.join(releaseDirectory, sumsFile), 'utf8')
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean)
  if (sumLines.length !== manifest.files.length) throw new Error(`${sumsFile} inventory mismatch`)
  for (const [index, file] of manifest.files.entries()) {
    if (!file || typeof file.name !== 'string' || path.basename(file.name) !== file.name) {
      throw new Error(`${manifestFile} contains an unsafe asset name`)
    }
    const assetPath = path.join(releaseDirectory, file.name)
    if (!fs.existsSync(assetPath)) throw new Error(`missing release asset: ${file.name}`)
    const stat = fs.statSync(assetPath)
    if (!Number.isSafeInteger(file.size) || file.size !== stat.size) {
      throw new Error(`size mismatch: ${file.name}`)
    }
    if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(file.sha256)) {
      throw new Error(`invalid SHA-256: ${file.name}`)
    }
    const actualHash = sha256(assetPath)
    if (actualHash !== file.sha256) throw new Error(`hash mismatch: ${file.name}`)
    const [sum, ...nameParts] = sumLines[index].trim().split(/\s+/u)
    if (sum !== file.sha256 || nameParts.join(' ') !== file.name) {
      throw new Error(`${sumsFile} does not match ${file.name}`)
    }
    if (expectedAssets.has(file.name)) throw new Error(`duplicate release asset: ${file.name}`)
    expectedAssets.add(file.name)
  }
  expectedAssets.add(manifestFile)
  expectedAssets.add(sumsFile)
}

assertUpdateMetadata(
  'latest.yml',
  ['.exe'],
  '.exe',
  manifestFilesByPlatform.get('windows'),
  true,
)
// AppImage embeds its blockmap in the update payload; unlike NSIS, it does not
// require a sibling .blockmap asset.
assertUpdateMetadata(
  'latest-linux.yml',
  ['.AppImage', '.deb'],
  '.AppImage',
  manifestFilesByPlatform.get('linux'),
  false,
)
if (fs.existsSync(path.join(releaseDirectory, 'latest-mac.yml'))) {
  throw new Error('macOS updater metadata is not part of this release')
}

const actualFiles = fs.readdirSync(releaseDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .sort()
for (const file of actualFiles) {
  if (!expectedAssets.has(file)) throw new Error(`unexpected release asset: ${file}`)
}
for (const file of expectedAssets) {
  if (!fs.existsSync(path.join(releaseDirectory, file))) throw new Error(`missing expected release file: ${file}`)
}

process.stdout.write(JSON.stringify({ version: expectedVersion, assets: actualFiles.length }) + '\n')
