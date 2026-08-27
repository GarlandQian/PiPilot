const fs = require('node:fs')

const version = String(process.argv[2] || '')
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error(`invalid release version: ${version}`)
}

fs.writeFileSync(
  process.argv[3] || 'release-notes.md',
  `## PiPilot ${version}\n\n` +
  'This public release was published only after all native package, smoke, manifest, and checksum gates completed successfully.\n\n' +
  '| Platform | Trust | Update path |\n| --- | --- | --- |\n' +
  '| macOS | Ad-hoc; not Developer ID signed or notarized | Manual GitHub Release download |\n' +
  '| Windows | Unsigned; SmartScreen may warn | Manual GitHub Release download; native install remains disabled |\n' +
  '| Linux AppImage | Unsigned | Native metadata included |\n' +
  '| Linux DEB | Unsigned | Manual package download |\n\n' +
  'SHA-256 manifests are included for each platform.\n',
)
