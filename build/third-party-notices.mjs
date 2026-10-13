// Third-party notices for what a PiPilot package ships: the libraries the
// bundles inline (collected from each build's modules) and the runtime
// dependencies electron-builder copies into node_modules. Written next to the
// renderer as third-party-notices.json for Settings › About.
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'

const LICENSE_FILE = /^(?:licen[cs]e|copying|notice)(?:[-._].*)?$/i
const MAX_TEXT = 64 * 1024

/** The package.json that names the package a file belongs to (nested `{"type":"module"}` files are skipped). */
export function packageRootOf(file) {
  if (!file.includes(`${sep}node_modules${sep}`) && !file.includes('/node_modules/')) return undefined
  for (let directory = dirname(file); dirname(directory) !== directory; directory = dirname(directory)) {
    const manifest = join(directory, 'package.json')
    if (!existsSync(manifest)) continue
    try {
      const json = JSON.parse(readFileSync(manifest, 'utf8'))
      if (typeof json.name === 'string' && typeof json.version === 'string') return directory
    } catch { /* Keep looking upward. */ }
  }
  return undefined
}

function licenseOf(json) {
  if (typeof json.license === 'string') return json.license
  if (json.license && typeof json.license.type === 'string') return json.license.type
  if (Array.isArray(json.licenses)) return json.licenses.map((entry) => entry?.type ?? entry).filter(Boolean).join(' OR ')
  return 'UNKNOWN'
}

function urlOf(json) {
  const repository = typeof json.repository === 'string' ? json.repository : json.repository?.url
  const url = (typeof json.homepage === 'string' && json.homepage) || repository || ''
  return url.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://')
    .replace(/^github:/, 'https://github.com/').replace(/^(?!https?:)([\w.-]+\/[\w.-]+)$/, 'https://github.com/$1')
}

export function describePackage(root) {
  const json = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const texts = readdirSync(root).filter((name) => LICENSE_FILE.test(name)).sort()
    .map((name) => { try { return readFileSync(join(root, name), 'utf8').slice(0, MAX_TEXT).trim() } catch { return '' } })
    .filter(Boolean)
  return { name: json.name, version: json.version, license: licenseOf(json), url: urlOf(json), text: texts.join('\n\n') }
}

/** Node's resolution from `from`: the nearest node_modules/<name> above it. */
function findPackage(name, from) {
  for (let directory = from; ; directory = dirname(directory)) {
    const candidate = join(directory, 'node_modules', name, 'package.json')
    if (existsSync(candidate)) return realpathSync(dirname(candidate))
    if (dirname(directory) === directory) return undefined
  }
}

/** The production dependency tree electron-builder ships, minus excluded packages. */
export function runtimeDependencyRoots(projectRoot, excluded = []) {
  const roots = new Set()
  const visit = (name, from) => {
    if (excluded.includes(name)) return
    const root = findPackage(name, from)
    if (!root || roots.has(root)) return
    roots.add(root)
    const json = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    for (const dependency of Object.keys({ ...json.dependencies, ...json.optionalDependencies })) visit(dependency, root)
  }
  const json = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
  for (const dependency of Object.keys(json.dependencies ?? {})) visit(dependency, projectRoot)
  return roots
}

/** Merge packages into one list, keyed by name@version, with identical license texts stored once. */
export function buildNotices(packages, extra = []) {
  const byKey = new Map()
  for (const entry of [...packages, ...extra]) byKey.set(`${entry.name}@${entry.version}`, entry)
  const texts = {}
  const list = [...byKey.values()].sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version))
    .map(({ text, ...entry }) => {
      if (!text) return entry
      const id = createHash('sha256').update(text).digest('hex').slice(0, 16)
      texts[id] = text
      return { ...entry, textId: id }
    })
  return { packages: list, texts }
}

const collected = new Set()

/**
 * A Vite plugin for each electron-vite build: it notes the packages the bundle
 * inlined; the renderer build (the last) writes the notices file.
 */
export function thirdPartyNotices({ projectRoot, write = false, outFile, excluded = [], extra = [] }) {
  return {
    name: 'pipilot-third-party-notices',
    apply: 'build',
    generateBundle() {
      for (const id of this.getModuleIds()) {
        const file = id.replace(/^\0/, '').split('?')[0]
        const root = packageRootOf(file)
        if (root) collected.add(realpathSync(root))
      }
    },
    closeBundle() {
      if (!write) return
      const roots = new Set([...collected, ...runtimeDependencyRoots(projectRoot, excluded)])
      const packages = [...roots].map((root) => { try { return describePackage(root) } catch { return undefined } }).filter(Boolean)
      writeFileSync(outFile, `${JSON.stringify(buildNotices(packages, extra))}\n`)
    },
  }
}
