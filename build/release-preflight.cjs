const fs = require('node:fs')
const path = require('node:path')

const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
const version = String(packageJson.version || '')
// An explicit empty argument is how workflow_dispatch asks for a dry run. Do
// not fall back to the branch name in that case; only an omitted argument may
// use GITHUB_REF_NAME for a tag-triggered run.
const providedTag = process.argv.length > 2 ? process.argv[2] : undefined
const tag = providedTag === undefined ? (process.env.GITHUB_REF_NAME || '') : providedTag
const stableSemVer = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

if (!stableSemVer.test(version)) {
  throw new Error(`package.json version must be stable SemVer, received ${version}`)
}
if (tag && !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)) {
  throw new Error(`release tag must be stable SemVer, received ${tag}`)
}
if (tag && tag !== `v${version}`) {
  throw new Error(`release tag ${tag} does not match package version ${version}`)
}

process.stdout.write(`${JSON.stringify({ version, tag: tag || `v${version}` })}\n`)
