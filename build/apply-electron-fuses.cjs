const {
  basename,
  dirname,
  extname,
  join,
} = require('node:path')
const {
  copyFileSync,
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
  const launcherPath = join(
    dirname(executablePath),
    `${basename(executablePath, extname(executablePath))}-mcp.exe`,
  )
  copyFileSync(executablePath, launcherPath)

  const executable = readFileSync(launcherPath)
  const peOffset = executable.readUInt32LE(0x3c)
  if (executable.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error(`Windows launcher is not a PE executable: ${launcherPath}`)
  }
  const optionalHeaderOffset = peOffset + 4 + 20
  const optionalHeaderMagic = executable.readUInt16LE(optionalHeaderOffset)
  if (optionalHeaderMagic !== 0x10b && optionalHeaderMagic !== 0x20b) {
    throw new Error(`Unsupported Windows launcher optional header: ${launcherPath}`)
  }
  // IMAGE_OPTIONAL_HEADER.Subsystem: 3 = IMAGE_SUBSYSTEM_WINDOWS_CUI.
  executable.writeUInt16LE(3, optionalHeaderOffset + 68)
  writeFileSync(launcherPath, executable)
}

exports.default = async function applyElectronFuses(context) {
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
