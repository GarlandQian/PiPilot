const { execFileSync } = require('node:child_process')

function gitLsFiles(args) {
  try {
    return execFileSync('git', ['ls-files', '-z', ...args, '--', 'tests/fixtures'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .split('\0')
      .filter(Boolean)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Could not verify test fixture inventory: ${message}`)
  }
}

const invalid = [
  ...gitLsFiles(['--others', '--exclude-standard']),
  ...gitLsFiles(['--others', '--ignored', '--exclude-standard']),
  ...gitLsFiles(['--deleted']),
]

if (invalid.length > 0) {
  throw new Error(
    `Test fixtures must be reproducible from Git. Stage, restore, or remove:\n${[
      ...new Set(invalid),
    ].sort().join('\n')}`,
  )
}

process.stdout.write('Test fixture inventory is reproducible from Git.\n')
