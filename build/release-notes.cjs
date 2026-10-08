const fs = require('node:fs')
const path = require('node:path')
const inventory = require('./release-inventory.cjs')

const repository = 'https://github.com/GarlandQian/PiPilot'
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function versionSections(changelog) {
  const headings = [...changelog.matchAll(/^## (.+)\r?$/gm)]
  return headings.map((match, index) => ({
    name: match[1].trim(),
    body: changelog.slice(match.index + match[0].length, headings[index + 1]?.index).trim(),
  }))
}

function downloadRows(version, directory) {
  const packages = {}
  if (directory) {
    for (const platform of Object.keys(inventory.architectures)) {
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, platform + '-manifest.json'), 'utf8'))
      if (manifest.version !== version || manifest.platform !== platform) {
        throw new Error('Release notes manifest identity mismatch: ' + platform)
      }
      const names = manifest.files.map((file) => file.name)
      if (names.some((name) => !/^[a-zA-Z0-9._-]+$/.test(name))) {
        throw new Error('Release notes require safe asset filenames')
      }
      packages[platform] = inventory.assertPackages(platform, version, names)
    }
  }
  const link = (platform, arch, suffix, label) => {
    if (!directory) return label
    const name = packages[platform].find((candidate) =>
      inventory.hasArchitecture(candidate, arch) && candidate.endsWith(suffix))
    if (!name) throw new Error('Missing download: ' + platform + ' ' + arch + ' ' + suffix)
    return '[' + label + '](' + repository + '/releases/download/v' + version + '/' + encodeURIComponent(name) + ')'
  }
  const mac = (arch) => [link('macos', arch, '.dmg', 'DMG'), link('macos', arch, '.zip', 'ZIP')].join(' · ')
  const linux = (platform, arch) => [
    link(platform, arch, '.AppImage', 'AppImage'),
    link(platform, arch, '.deb', 'DEB'),
    link(platform, arch, '.rpm', 'RPM'),
  ].join(' · ')
  return [
    '| macOS | Apple Silicon / arm64 | ' + mac('arm64') + ' |',
    '| macOS | Intel / x64 | ' + mac('x64') + ' |',
    '| Windows | x64 | ' + [
      link('windows', 'x64', '-setup.exe', 'Setup EXE'),
      link('windows', 'x64', '-portable.exe', 'Portable EXE'),
      link('windows', 'x64', '-portable.zip', 'Portable ZIP'),
    ].join(' · ') + ' |',
    '| Linux | x64 | ' + linux('linux', 'x64') + ' |',
    '| Linux | ARM64 | ' + linux('linux-arm64', 'arm64') + ' |',
  ].join('\n')
}

function renderReleaseNotes({ version, changelog, directory, preview = false }) {
  if (!stableVersion.test(version)) throw new Error('invalid release version: ' + version)
  if (!preview && !directory) throw new Error('Published release notes require an asset directory')
  const sections = versionSections(changelog)
  const release = sections.find((section) => section.name === version)
  const selected = release || (preview && sections.find((section) => section.name === 'Unreleased'))
  if (!selected?.body) throw new Error('Missing non-empty CHANGELOG section for ' + version)
  const previous = release && sections.slice(sections.indexOf(release) + 1).find((section) => stableVersion.test(section.name))
  const downloads = downloadRows(version, directory)
  const checksumLinks = Object.keys(inventory.architectures).map((platform) => {
    const name = platform + '-SHA256SUMS.txt'
    return directory ? '[' + name + '](' + repository + '/releases/download/v' + version + '/' + name + ')' : name
  }).join(' · ')
  const lines = [
    '# PiPilot ' + version + (preview ? ' — Preview / 发布预览' : ''),
    '',
    ...(preview ? ['> Preview only; no Release has been published by this command. Download links, when included, become available after publication.',
      '> 仅为说明预览，此命令不会发布 Release；如含下载链接，链接在正式发布后生效。', ''] : []),
    '## What’s changed / 更新内容', '', selected.body, '',
    '## Downloads / 下载', '',
    '| System / 系统 | Architecture / 架构 | Packages / 安装包 |',
    '| --- | --- | --- |',
    downloads, '',
    'Choose the package for your system and architecture. Filenames include both; Linux may use x86_64/amd64 for x64 and aarch64 for ARM64.',
    '按系统和架构选择安装包；文件名包含两者，Linux 的 x86_64/amd64 对应 x64，aarch64 对应 ARM64。', '',
    '## Updating / 更新方式', '',
    'Every edition checks automatically, and Settings → About → Check for updates remains available.',
    '所有发行类型均自动检查更新，也可点击「设置 → 关于 → 检查更新」。', '',
    '| Edition / 发行类型 | Update / 安装更新 |',
    '| --- | --- |',
    '| Windows Setup / Linux AppImage | In-app download, then confirmed restart and installation / 应用内下载，确认后重启安装 |',
    '| macOS / Linux DEB, RPM | Download and install manually / 手动下载并安装 |',
    '| Windows portable | Quit, replace application files, preserve data/ / 退出后替换程序文件，保留 data/ |', '',
    'Older Windows builds using manual updates need one manual installation. Active work and unsaved settings are checked before an in-app restart.',
    '旧版手动更新模式的 Windows 安装版需先手动安装一次；应用内重启安装前会检查运行中的任务与未保存配置。', '',
    '## Data and installation notes / 数据与安装提示', '',
    '- Pi defaults to ~/.pi/agent; portable Windows uses adjacent data/agent/. A custom Pi folder takes effect after quitting and reopening, without migrating old files.',
    '- Pi 默认使用 ~/.pi/agent，Windows 便携版默认使用旁边的 data/agent/。自定义目录退出重开后生效，不自动迁移旧文件。',
    '- Portable EXE extracts temporarily. Use Setup or portable ZIP for a stable MCP launcher.',
    '- 便携 EXE 临时解压运行；需要稳定 MCP 启动器时使用安装版或便携 ZIP。',
    '- macOS is ad-hoc signed, without Developer ID signing or notarization. Windows packages are unsigned; the operating system may show a security prompt.',
    '- macOS 为 ad-hoc 签名，未配置 Developer ID 或公证；Windows 未签名，系统可能显示安全提示。', '',
    '## Checksums / 校验', '', checksumLinks, '',
    'Compare your package’s SHA-256 against the matching list. Updater YAML, blockmap, and manifest files are support files, not installers.',
    '将安装包 SHA-256 与对应清单比较。更新 YAML、blockmap 和 manifest 为辅助文件，无需作为安装包打开。', '',
    '[User guide](' + repository + '/blob/' + (preview ? 'main' : 'v' + version) + '/docs/usage.md) · ' +
    '[使用指南](' + repository + '/blob/' + (preview ? 'main' : 'v' + version) + '/docs/usage.zh-CN.md)',
  ]
  if (!preview) lines.push('', previous
    ? '[Full Changelog](' + repository + '/compare/v' + previous.name + '...v' + version + ')'
    : '[Source](' + repository + '/tree/v' + version + ')')
  return lines.join('\n') + '\n'
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const preview = args.includes('--preview')
  if (args.some((arg) => arg.startsWith('--') && arg !== '--preview')) throw new Error('Unknown release notes option')
  const positional = args.filter((arg) => arg !== '--preview')
  const [version, output = 'release-notes.md', assetDirectory] = positional
  if (positional.length > 3) throw new Error('Usage: release-notes.cjs <version> [output] [asset-directory] [--preview]')
  const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8')
  const directory = assetDirectory || (preview ? undefined : 'release')
  fs.writeFileSync(output, renderReleaseNotes({ version, changelog, directory, preview }))
}

module.exports = { renderReleaseNotes }
