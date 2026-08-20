// Phase 7 benchmark slice — local macOS measurement (2026-08-16)
//
// Compares the installed official CLI (`pi --mode rpc`) baseline against the
// bundled embedded SDK path using the user's real ~/.pi/agent directory (the
// real 9-package plugin set). Sessions are created only under temporary
// sessionDir values so the real session catalog is never touched.

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const AGENT_DIR = join(process.env.HOME, '.pi', 'agent')
const CWD = process.cwd()
const results = []
const now = () => performance.now()
const report = (name, value, unit = 'ms') => {
  results.push({ name, value, unit })
  console.log(`${name.padEnd(46)} ${String(value).padStart(9)} ${unit}`)
}

async function measureCli() {
  const t0 = now()
  const child = spawn('pi', ['--mode', 'rpc', '--approve'], {
    cwd: CWD,
    env: { ...process.env, PI_CODING_AGENT_DIR: AGENT_DIR },
    stdio: ['pipe', 'pipe', 'ignore'],
    shell: false,
  })
  let buffer = ''
  const settle = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('get_state timeout')), 90_000)
    const onData = (chunk) => {
      buffer += chunk.toString('utf8')
      while (true) {
        const nl = buffer.indexOf('\n')
        if (nl < 0) break
        const raw = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        try {
          const msg = JSON.parse(raw)
          if (msg.type === 'response' && msg.command === 'get_state') {
            clearTimeout(timer)
            resolve(msg)
            return
          }
        } catch {
          // event or partial; ignore
        }
      }
    }
    child.stdout.on('data', onData)
    child.on('exit', () => clearTimeout(timer))
    child.on('error', reject)
  })
  try {
    child.stdin.write(JSON.stringify({ type: 'get_state' }) + '\n')
    await settle
    report('CLI first get_state (real 9-plugin agent dir)', Math.round(now() - t0))
  } finally {
    child.kill('SIGKILL')
    await new Promise((resolve) => child.once('exit', resolve))
  }
}

let sdk
{
  const t0 = now()
  sdk = await import('@earendil-works/pi-coding-agent')
  report('Embedded SDK ESM import', now() - t0)
  if (sdk.VERSION !== '0.84.2') throw new Error(`unexpected SDK version ${sdk.VERSION}`)
}

const sessionRoots = []
async function createRuntime(label, { cwd = CWD } = {}) {
  const sessionDir = await mkdtemp(join(tmpdir(), 'pipilot-bench-sessions-'))
  sessionRoots.push(sessionDir)
  const t0 = now()
  const sessionManager = sdk.SessionManager.create(cwd, sessionDir)
  const tManager = now()
  const createRuntime = async ({ cwd: nextCwd, agentDir, sessionManager: nextSessionManager, sessionStartEvent }) => {
    const services = await sdk.createAgentSessionServices({ cwd: nextCwd, agentDir })
    const result = await sdk.createAgentSessionFromServices({
      services,
      sessionManager: nextSessionManager,
      sessionStartEvent,
    })
    return { ...result, services, diagnostics: services.diagnostics }
  }
  const runtime = await sdk.createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir: AGENT_DIR,
    sessionManager,
  })
  const tReady = now()
  report(`${label} session manager`, tManager - t0)
  report(`${label} total first-ready (services+resources+extensions+bind)`, tReady - tManager)
  return { runtime, sessionDir }
}

try {
  if (globalThis.gc) globalThis.gc()
  const rssBefore = process.memoryUsage().rss
  const first = await createRuntime('runtime #1 (cold host)', {})
  report('RSS delta after 1 runtime', Math.round((process.memoryUsage().rss - rssBefore) / 1024 / 1024), 'MiB')

  const extra = []
  for (let i = 2; i <= 8; i += 1) {
    extra.push(await createRuntime(`runtime #${i} (same cwd)`, {}))
  }
  report('RSS delta after 8 runtimes', Math.round((process.memoryUsage().rss - rssBefore) / 1024 / 1024), 'MiB')

  const otherCwd = await mkdtemp(join(tmpdir(), 'pipilot-bench-ws-'))
  try {
    const tSwitch = now()
    await first.runtime.switchSession(first.runtime.session.sessionFile, { cwdOverride: otherCwd })
    report('switchSession across cwd (warm host)', now() - tSwitch)
  } catch (error) {
    console.log('[switchSession] skipped:', error.message)
  }

  for (const entry of [first, ...extra]) {
    await entry.runtime.dispose()
  }
} finally {
  for (const root of sessionRoots) await rm(root, { recursive: true, force: true }).catch(() => undefined)
}

try {
  await measureCli()
} catch (error) {
  console.log('[CLI probe] skipped:', error.message)
}

console.log('\n[machine]', process.platform, process.arch, 'node', process.version)
console.log('[agent]', AGENT_DIR)
console.log(JSON.stringify(results, null, 2))