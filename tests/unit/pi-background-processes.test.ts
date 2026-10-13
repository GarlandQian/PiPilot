import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

interface ProbeCall {
  phase: string
  command: string
  args: string[]
  windowsHide?: boolean
  stdio: unknown
}

/** Observe the installed SDK's actual spawn options without starting npm, git or external tools. */
async function probe(body: string): Promise<{ calls: ProbeCall[]; result: unknown }> {
  const root = await mkdtemp(join(tmpdir(), 'pipilot-background-processes-'))
  const entry = import.meta.resolve('@earendil-works/pi-coding-agent')
  try {
    const script = `
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.env.PIPILOT_TEST_DIRECTORY;
const entry = ${JSON.stringify(entry)};
const calls = [];
let phase = '';
let output = '';
let result;
childProcess.spawn = (command, args, options = {}) => {
  calls.push({ phase, command, args, windowsHide: options.windowsHide, stdio: options.stdio });
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  setImmediate(() => {
    child.stdout.end(output);
    child.stderr.end();
    child.emit('exit', 0);
    child.emit('close', 0);
  });
  return child;
};
childProcess.spawnSync = (command, args, options = {}) => {
  calls.push({ phase, command, args, windowsHide: options.windowsHide, stdio: options.stdio });
  return { status: 0, stdout: output, stderr: '' };
};
syncBuiltinESMExports();
${body}
process.stdout.write(JSON.stringify({ calls, result }));
`
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root, windowsHide: true, timeout: 15_000,
      env: { ...process.env, PI_CODING_AGENT_DIR: root, PI_OFFLINE: '0', PIPILOT_TEST_DIRECTORY: root },
    })
    return JSON.parse(stdout)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

it('hides npm discovery, installation, update checks and extension commands in the installed SDK', async () => {
  const captured = await probe(`
const { DefaultPackageManager, SettingsManager } = await import(entry);
const settings = SettingsManager.inMemory({ npmCommand: ['fixture-npm'], packages: ['npm:fixture-package'] });
const manager = new DefaultPackageManager({ cwd: root, agentDir: root, settingsManager: settings });
phase = 'discover';
output = join(root, 'global-node-modules');
manager.getInstalledPath('npm:missing-package', 'user');
phase = 'install';
await manager.install('npm:fixture-package@1.0.0', { local: false });
const installed = join(root, 'npm', 'node_modules', 'fixture-package');
mkdirSync(installed, { recursive: true });
writeFileSync(join(installed, 'package.json'), JSON.stringify({ name: 'fixture-package', version: '1.0.0' }));
phase = 'check-updates';
output = JSON.stringify('2.0.0');
const updates = await manager.checkForAvailableUpdates();
phase = 'extension-command';
output = 'extension output';
const { execCommand } = await import(new URL('./core/exec.js', entry));
result = { updates, execution: await execCommand('fixture-extension', ['argument with spaces'], root) };
`)
  expect([...new Set(captured.calls.map((call) => call.phase))]).toEqual(['discover', 'install', 'check-updates', 'extension-command'])
  // Pi marks installed directories as ignored by file providers on macOS/Linux.
  // These platform-only attribute commands cannot create a Windows console.
  const attributeCalls = captured.calls.filter((call) => ['xattr', 'setfattr'].includes(call.command))
  expect(attributeCalls.every((call) => call.phase === 'install' && call.stdio === 'ignore')).toBe(true)
  for (const call of captured.calls.filter((call) => !['xattr', 'setfattr'].includes(call.command))) {
    expect(call, `${call.phase}: ${call.command}`).toHaveProperty('windowsHide', true)
  }
  expect(captured.calls.filter((call) => call.phase !== 'install').every((call) =>
    JSON.stringify(call.stdio) === JSON.stringify(['ignore', 'pipe', 'pipe']))).toBe(true)
  expect(captured.result).toMatchObject({
    updates: [{ source: 'npm:fixture-package', type: 'npm' }],
    execution: { stdout: 'extension output', stderr: '', code: 0, killed: false },
  })
})

it('hides Windows tool detection and archive extraction without suppressing tool results', async () => {
  const captured = await probe(`
const { default: os } = await import('node:os');
os.platform = () => 'win32';
os.arch = () => 'x64';
childProcess.spawnSync = (command, args, options = {}) => {
  calls.push({ phase, command, args, windowsHide: options.windowsHide, stdio: options.stdio });
  if (args[0] === '--version') return { status: null, error: Object.assign(new Error('Fixture: not installed'), { code: 'ENOENT' }) };
  const destination = args[args.indexOf('-C') + 1];
  writeFileSync(join(destination, 'fd.exe'), 'fixture executable');
  return { status: 0, stdout: '', stderr: '' };
};
syncBuiltinESMExports();
globalThis.fetch = async (url) => String(url).endsWith('/releases/latest')
  ? new Response(null, { status: 302, headers: { location: 'https://github.com/sharkdp/fd/releases/tag/v10.0.0' } })
  : new Response('fixture archive');
const { ensureTool } = await import(new URL('./utils/tools-manager.js', entry));
phase = 'ensure-tool';
result = await ensureTool('fd');
`)
  const discovery = captured.calls.filter((call) => call.args[0] === '--version')
  const extraction = captured.calls.filter((call) => call.args[0] !== '--version')
  expect(discovery.map((call) => call.command)).toEqual(['fd', 'fdfind'])
  expect(extraction).toHaveLength(1)
  expect(extraction[0]?.args).toContain('-C')
  expect(captured.calls.every((call) => call.windowsHide === true)).toBe(true)
  expect(captured.result).toEqual(expect.stringMatching(/[\\/]bin[\\/]fd\.exe$/u))
})
