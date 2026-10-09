import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { prepareBundledNodeEnvironment } from './bundled-npm'

const npmRequire = createRequire(import.meta.url)
const command = process.argv[3]
if (process.argv[2] !== '--' || (command !== 'npm' && command !== 'npx')) throw new Error('Invalid bundled npm invocation.')
prepareBundledNodeEnvironment()
const packagedCli = join(import.meta.dirname, '..', '..', '..', 'npm', 'bin', `${command}-cli.js`)
const cli = existsSync(packagedCli) ? packagedCli
  : join(dirname(npmRequire.resolve('pipilot-npm/package.json')), 'bin', `${command}-cli.js`)
process.argv = [process.execPath, cli, ...process.argv.slice(4)]
npmRequire(cli)
