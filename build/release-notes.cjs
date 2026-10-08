const fs = require('node:fs')

const version = String(process.argv[2] || '')
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error(`invalid release version: ${version}`)
}

const highlights = version === '0.3.5'
  ? [
      'Redesigned workspace panels, terminal tabs, and conversation navigation.',
      'Improved diff review, Git actions, and external editor integration.',
      'Quick provider setup and remote model discovery in model settings.',
      'Installer filenames now identify the operating system and architecture.',
      'Persistent Check for updates button in Settings > About; all platforms check automatically.',
    ]
  : version === '0.3.2'
  ? [
      'Conversation overview with summaries, blockers, next steps, and plugin state.',
      'Import and export conversations as Markdown, with adjacent image attachments.',
      'Plan Mode, Goal, and Subagents integration with shared Pi package management.',
      'Choose queue or steer while Pi replies; reorder or restore unsent messages and attachments.',
      'Start Plan or Goal from the composer with shortcuts, and manage the active work near the input.',
      'Configurable completion sounds and a macOS 27 sidebar title bar fix.',
    ]
  : []

fs.writeFileSync(
  process.argv[3] || 'release-notes.md',
  `## PiPilot ${version}\n\n` +
  (highlights.length ? `### Highlights\n\n${highlights.map((item) => `- ${item}`).join('\n')}\n\n` : '') +
  'This public release was published only after all native package, smoke, manifest, and checksum gates completed successfully.\n\n' +
  '| Platform | Trust | Update path |\n| --- | --- | --- |\n' +
  '| macOS | Ad-hoc; not Developer ID signed or notarized | Automatic checks; manual download and installation |\n' +
  '| Windows | Unsigned; SmartScreen may warn | In-app download, then confirmed restart and install |\n' +
  '| Linux AppImage | Unsigned | In-app download, then confirmed restart and install |\n' +
  '| Linux DEB | Unsigned | Automatic checks; manual download and installation |\n\n' +
  'SHA-256 manifests are included for each platform.\n',
)
