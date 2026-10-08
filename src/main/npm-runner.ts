import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const npmRequire = createRequire(import.meta.url)
if (process.argv[2] !== '--' || process.argv[3] !== 'npm') throw new Error('Invalid bundled npm invocation.')
const packagedCli = join(import.meta.dirname, '..', '..', '..', 'npm', 'bin', 'npm-cli.js')
const cli = existsSync(packagedCli) ? packagedCli
  : join(dirname(npmRequire.resolve('pipilot-npm/package.json')), 'bin', 'npm-cli.js')
process.argv = [process.execPath, cli, ...process.argv.slice(4)]
npmRequire(cli)
