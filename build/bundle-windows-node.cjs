const { copyFileSync, mkdirSync, writeFileSync } = require('node:fs')
const { dirname, join } = require('node:path')

// Release builds already install this official Node distribution with setup-node.
// Keep a real node.exe: npm scripts and MCP bins can spawn it without Electron flags.
exports.bundleWindowsNode = function bundleWindowsNode(resources, arch) {
  if (process.platform !== 'win32' || process.arch !== 'x64' || arch !== 1
    || process.versions.node !== '24.18.0') {
    throw new Error('Windows packaging requires native Windows x64 Node.js 24.18.0.')
  }
  const directory = join(resources, 'node')
  mkdirSync(directory, { recursive: true })
  copyFileSync(process.execPath, join(directory, 'node.exe'))
  copyFileSync(join(dirname(process.execPath), 'LICENSE'), join(directory, 'LICENSE'))
  for (const command of ['npm', 'npx']) {
    writeFileSync(join(directory, `${command}.cmd`),
      `@ECHO OFF\r\n"%~dp0node.exe" "%~dp0..\\npm\\bin\\${command}-cli.js" %*\r\n`, 'utf8')
  }
}
