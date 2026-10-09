import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const NPX_MCP_CANARY_TEXT = 'npx MCP and child node passed 中文 with spaces'
export const NPX_MCP_CANARY_TOOL = 'check_node'

/** Offline package: exercises npx, Windows bin shims, stdio and a bare node child. */
export async function createNpxMcpFixture(root: string) {
  const directory = join(root, '中文 npx package (A) & Notes')
  const callsFile = join(root, 'npx-calls.jsonl')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify({
    name: 'pipilot-npx-canary', version: '1.0.0', bin: { 'pipilot-npx-canary': 'server.cjs' },
  }))
  await writeFile(join(directory, 'server.cjs'), `#!/usr/bin/env node
const { createInterface } = require('node:readline')
const { appendFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const lines = createInterface({ input: process.stdin })
lines.on('line', line => {
  const message = JSON.parse(line)
  appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify(message) + '\\n')
  if (message.id === undefined) return
  let result = {}
  if (message.method === 'initialize') result = {
    protocolVersion: message.params.protocolVersion, capabilities: { tools: {} },
    serverInfo: { name: 'pipilot-npx-canary', version: '1.0.0' }
  }
  if (message.method === 'tools/list') result = { tools: [{
    name: '${NPX_MCP_CANARY_TOOL}', description: 'Verify the bundled child runtime',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  }] }
  if (message.method === 'tools/call') result = { content: [{ type: 'text', text:
    execFileSync('node', ['-e', 'process.stdout.write(process.argv[1])', ${JSON.stringify(NPX_MCP_CANARY_TEXT)}],
      { encoding: 'utf8', windowsHide: true })
  }] }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\\n')
})
lines.on('close', () => process.exit(0))
`)
  return {
    config: {
      command: 'npx', args: ['--offline', '--yes', '--package', directory, 'pipilot-npx-canary'],
      env: { npm_config_cache: join(root, 'npx-cache') }, exposure: 'codemode' as const,
    },
    async hasCall(method: string) {
      try {
        return (await readFile(callsFile, 'utf8')).trim().split('\n')
          .some((line) => (JSON.parse(line) as { method: string }).method === method)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
      }
    },
  }
}
