export interface Notice { name: string; version: string; license: string; url?: string; textId?: string }
export interface Notices { packages: Notice[]; texts: Record<string, string> }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Validate the build artifact so a bad response becomes a retryable error, not a render crash. */
export function parseNotices(value: unknown): Notices {
  if (!isRecord(value) || !Array.isArray(value.packages) || !isRecord(value.texts)
    || !Object.values(value.texts).every((text) => typeof text === 'string')) {
    throw new Error('Invalid third-party notices')
  }
  const packages = value.packages.map((entry: unknown): Notice => {
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.version !== 'string'
      || typeof entry.license !== 'string' || (entry.url !== undefined && typeof entry.url !== 'string')
      || (entry.textId !== undefined && typeof entry.textId !== 'string')) {
      throw new Error('Invalid third-party notice')
    }
    return { name: entry.name, version: entry.version, license: entry.license, url: entry.url, textId: entry.textId }
  })
  return { packages: packages.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)), texts: value.texts as Record<string, string> }
}

let loaded: Promise<Notices> | null = null
/** Generated at build time next to the renderer (build/third-party-notices.mjs). */
export function loadNotices(): Promise<Notices> {
  loaded ??= fetch('/third-party-notices.json').then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return parseNotices(await response.json())
  }).catch((error: unknown) => { loaded = null; throw error })
  return loaded
}

export function noticeKey(entry: Notice): string { return `${entry.name}@${entry.version}` }

export function filterNotices(packages: Notice[], query: string, license: string): Notice[] {
  const needle = query.trim().toLowerCase()
  return packages.filter((entry) => (!license || entry.license === license)
    && (!needle || `${entry.name} ${entry.version} ${entry.license}`.toLowerCase().includes(needle)))
}

/** Package metadata must not turn the license viewer into an arbitrary URL launcher. */
export function noticeProjectUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch { return undefined }
}
