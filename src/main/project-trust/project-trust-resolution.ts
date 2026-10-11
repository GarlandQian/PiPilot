import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ProjectTrustStore, hasTrustRequiringProjectResources } from '@earendil-works/pi-coding-agent'
import type { ProjectTrustPolicy, ProjectTrustState } from '../../shared/project-trust'

/**
 * Names the file of decisions that last until PiPilot quits ("trust for this
 * session"). Main writes it; every Project Host reads it when a conversation
 * starts or reloads, next to Pi's own trust.json.
 */
export const PROJECT_TRUST_SESSION_FILE_ENV = 'PIPILOT_PROJECT_TRUST_SESSION_FILE'

export interface ResolvedProjectTrust {
  state: ProjectTrustState
  trusted: boolean
  savedPath?: string
  sessionOnly: boolean
  policy: ProjectTrustPolicy
}

/** Pi's own canonical form (`canonicalizePath`), so keys match trust.json. */
export function canonicalProjectPath(path: string) {
  try {
    return realpathSync(resolve(path))
  } catch {
    return resolve(path)
  }
}

export function parentProjectPath(path: string) {
  const canonical = canonicalProjectPath(path)
  const parent = dirname(canonical)
  return parent === canonical ? undefined : parent
}

/** Pi reads `defaultProjectTrust` from the global settings file only. */
export function readProjectTrustPolicy(agentDir: string): ProjectTrustPolicy {
  try {
    const value = (JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf8')) as { defaultProjectTrust?: unknown }).defaultProjectTrust
    return value === 'always' || value === 'never' ? value : 'ask'
  } catch {
    return 'ask'
  }
}

export function readSessionTrust(file: string | undefined): Map<string, boolean> {
  const decisions = new Map<string, boolean>()
  if (!file || !existsSync(file)) return decisions
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [path, value] of Object.entries(parsed)) if (typeof value === 'boolean') decisions.set(path, value)
    }
  } catch {
    // An unreadable session file means no session decisions, never trust.
  }
  return decisions
}

/**
 * The official CLI's rule: a project without gated resources loads fully; one
 * with them needs a saved decision (nearest ancestor wins), a session
 * decision, or a policy of "always". Undecided projects run untrusted.
 */
export function resolveProjectTrust(cwd: string, agentDir: string, sessionFile: string | undefined): ResolvedProjectTrust {
  const policy = readProjectTrustPolicy(agentDir)
  if (!hasTrustRequiringProjectResources(cwd)) return { state: 'not-required', trusted: true, sessionOnly: false, policy }
  const session = readSessionTrust(sessionFile).get(canonicalProjectPath(cwd))
  if (session !== undefined) return { state: session ? 'trusted' : 'untrusted', trusted: session, sessionOnly: true, policy }
  let saved: { path: string; decision: boolean } | null = null
  try {
    saved = new ProjectTrustStore(agentDir).getEntry(cwd)
  } catch {
    // A damaged trust.json is treated as no decision, like an untrusted start.
  }
  if (saved) return { state: saved.decision ? 'trusted' : 'untrusted', trusted: saved.decision, savedPath: saved.path, sessionOnly: false, policy }
  if (policy === 'always') return { state: 'trusted', trusted: true, sessionOnly: false, policy }
  if (policy === 'never') return { state: 'untrusted', trusted: false, sessionOnly: false, policy }
  return { state: 'undecided', trusted: false, sessionOnly: false, policy }
}

/** What a Project Host applies to a conversation in cwd. */
export function hostProjectTrusted(cwd: string, agentDir: string) {
  return resolveProjectTrust(cwd, agentDir, process.env[PROJECT_TRUST_SESSION_FILE_ENV]).trusted
}
