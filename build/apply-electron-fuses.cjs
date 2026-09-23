const {
  dirname,
  join,
} = require('node:path')
const {
  copyFileSync,
  chmodSync,
  lstatSync,
  readFileSync,
  writeFileSync,
} = require('node:fs')

function resolveElectronExecutable(context) {
  const { appOutDir, electronPlatformName, packager } = context
  const productFilename = packager.appInfo.productFilename

  if (electronPlatformName === 'darwin') {
    return join(
      appOutDir,
      `${productFilename}.app`,
      'Contents',
      'MacOS',
      productFilename,
    )
  }
  if (electronPlatformName === 'win32') {
    return join(appOutDir, `${productFilename}.exe`)
  }
  if (electronPlatformName === 'linux') {
    return join(appOutDir, packager.executableName)
  }
  throw new Error(`Unsupported Electron packaging platform: ${electronPlatformName}`)
}

function createWindowsConsoleLauncher(executablePath) {
  const launcherPath = join(dirname(executablePath), 'pipilot-mcp.exe')
  copyFileSync(executablePath, launcherPath)

  const executable = readFileSync(launcherPath)
  if (executable.length < 0x40) {
    throw new Error(`Windows launcher is too small to contain a PE header: ${launcherPath}`)
  }
  const peOffset = executable.readUInt32LE(0x3c)
  if (peOffset < 0 || peOffset + 24 > executable.length) {
    throw new Error(`Windows launcher PE header is out of bounds: ${launcherPath}`)
  }
  if (executable.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error(`Windows launcher is not a PE executable: ${launcherPath}`)
  }
  const optionalHeaderOffset = peOffset + 4 + 20
  const optionalHeaderSize = executable.readUInt16LE(peOffset + 4 + 16)
  if (
    optionalHeaderSize < 70 ||
    optionalHeaderOffset + optionalHeaderSize > executable.length
  ) {
    throw new Error(`Windows launcher optional header is out of bounds: ${launcherPath}`)
  }
  const optionalHeaderMagic = executable.readUInt16LE(optionalHeaderOffset)
  if (optionalHeaderMagic !== 0x10b && optionalHeaderMagic !== 0x20b) {
    throw new Error(`Unsupported Windows launcher optional header: ${launcherPath}`)
  }
  // IMAGE_OPTIONAL_HEADER.Subsystem: 3 = IMAGE_SUBSYSTEM_WINDOWS_CUI.
  executable.writeUInt16LE(3, optionalHeaderOffset + 68)
  writeFileSync(launcherPath, executable)
}

function repairPackagedTerminalHelpers(context) {
  if (context.electronPlatformName !== 'darwin') return
  const { Arch } = require('electron-builder')
  const architecture = Arch[context.arch]
  const architectures = architecture === 'universal' ? ['arm64', 'x64'] : [architecture]
  if (architectures.some((arch) => arch !== 'arm64' && arch !== 'x64')) {
    throw new Error(`Unsupported macOS terminal packaging architecture: ${context.arch}`)
  }
  const packageRoot = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
  )
  for (const arch of architectures) {
    const candidates = [
      join(packageRoot, 'build', 'Release', 'spawn-helper'),
      join(packageRoot, 'prebuilds', `darwin-${arch}`, 'spawn-helper'),
    ]
    let found = false
    for (const helper of candidates) {
      const details = lstatSync(helper, { throwIfNoEntry: false })
      if (!details) continue
      if (!details.isFile()) {
        throw new Error(`Packaged node-pty spawn helper must be a regular file: ${helper}`)
      }
      // Dependency installs/caches can strip executable bits. Repair only the
      // helper in the packaged payload, before signing, independently of dev.
      chmodSync(helper, details.mode | 0o111)
      found = true
    }
    if (!found) {
      throw new Error(`Packaged node-pty spawn helper is missing for darwin-${arch}: ${packageRoot}`)
    }
  }
}

exports.repairPackagedTerminalHelpers = repairPackagedTerminalHelpers

exports.default = async function applyElectronFuses(context) {
  repairPackagedTerminalHelpers(context)
  const {
    flipFuses,
    FuseV1Options,
    FuseVersion,
  } = await import('@electron/fuses')

  const executablePath = resolveElectronExecutable(context)
  await flipFuses(executablePath, {
    version: FuseVersion.V1,
    strictlyRequireAllFuses: true,
    [FuseV1Options.RunAsNode]: true,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    [FuseV1Options.WasmTrapHandlers]: true,
  })
  if (context.electronPlatformName === 'win32') {
    createWindowsConsoleLauncher(executablePath)
  }
}
