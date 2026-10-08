const aliases = { arm64: ['arm64', 'aarch64'], x64: ['x64', 'x86_64', 'amd64'] }
const architectures = { macos: ['arm64', 'x64'], windows: ['x64'], linux: ['x64'], 'linux-arm64': ['arm64'] }
const extensions = { macos: ['.dmg', '.zip'], windows: ['.exe', '.zip'], linux: ['.AppImage', '.deb', '.rpm'], 'linux-arm64': ['.AppImage', '.deb', '.rpm'] }
const os = (platform) => platform.startsWith('linux') ? 'linux' : platform
const hasArchitecture = (name, arch) => aliases[arch].some((alias) => name.includes(`-${alias}.`) || name.includes(`-${alias}-`))
function assertPackages(platform, version, names) {
  const packages = names.filter((name) => extensions[platform].some((ext) => name.endsWith(ext)))
  for (const name of packages) {
    if (!name.startsWith(`PiPilot-${version}-${os(platform)}-`)) throw new Error(`${platform} package must identify its version and platform: ${name}`)
  }
  if (platform === 'windows') {
    const expected = ['setup.exe', 'portable.exe', 'portable.zip'].map((suffix) => `PiPilot-${version}-windows-x64-${suffix}`).sort()
    if (JSON.stringify(packages.slice().sort()) !== JSON.stringify(expected)) throw new Error('Windows package inventory mismatch: expected setup EXE, portable EXE and portable ZIP')
  } else {
    if (packages.length !== architectures[platform].length * extensions[platform].length) throw new Error(`${platform} package inventory mismatch`)
    for (const arch of architectures[platform]) for (const extension of extensions[platform]) {
      if (packages.filter((name) => hasArchitecture(name, arch) && name.endsWith(extension)).length !== 1) throw new Error(`${platform} requires exactly one ${arch} ${extension} package`)
    }
  }
  return packages
}
module.exports = { architectures, extensions, os, hasArchitecture, assertPackages }
