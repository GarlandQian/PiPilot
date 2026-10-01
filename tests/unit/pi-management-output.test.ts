import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

describe('Pi management helper output', () => {
  it('keeps noisy actual SDK package-manager stdout out of the JSONL channel', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pipilot-output-guard-'))
    try {
      const runner = join(root, 'noisy-npm.cjs')
      const child = join(root, 'helper.mjs')
      await writeFile(runner, "process.stdout.write('npm package installation output\\n'); process.stderr.write('npm diagnostic\\n');")
      const sdk = import.meta.resolve('@earendil-works/pi-coding-agent')
      const output = pathToFileURL(resolve('src/main/local-pi-management/pi-management-output.ts')).href
      await writeFile(child, `
import { createPiManagementOutput } from ${JSON.stringify(output)};
import { DefaultPackageManager, SettingsManager } from ${JSON.stringify(sdk)};
const output = await createPiManagementOutput();
const settings = SettingsManager.create(${JSON.stringify(root)}, ${JSON.stringify(root)}, { projectTrusted: true });
const manager = new DefaultPackageManager({ cwd: ${JSON.stringify(root)}, agentDir: ${JSON.stringify(root)}, settingsManager: settings });
manager.setProgressCallback((event) => output.writeRawStdout(JSON.stringify({ type: 'progress', event }) + '\\n'));
await manager.installAndPersist('npm:output-fixture@1.0.0', { local: false });
await settings.flush();
output.writeRawStdout(JSON.stringify({ type: 'result' }) + '\\n');
await output.flushRawStdout();
`)
      await writeFile(join(root, 'settings.json'), JSON.stringify({ npmCommand: [process.execPath, runner] }))
      const result = await promisify(execFile)(process.execPath, [child], { encoding: 'utf8' })
      const records = result.stdout.trim().split('\n').map((line) => JSON.parse(line))
      expect(records.map((record) => record.type)).toEqual(['progress', 'progress', 'result'])
      expect(result.stdout).not.toContain('npm package installation output')
      expect(result.stderr).toContain('npm package installation output')
      expect(result.stderr).toContain('npm diagnostic')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
