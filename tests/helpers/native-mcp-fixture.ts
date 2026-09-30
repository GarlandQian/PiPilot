import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export const NATIVE_MCP_CANARY_TEXT = 'native MCP canary passed'
export const NATIVE_MCP_CANARY_TOOL = 'get_test_value'

/** A real, isolated Streamable HTTP endpoint with one read-only MCP tool. */
export async function startNativeMcpFixture() {
  const calls: Array<{ method: string; name?: string }> = []
  const server = createServer((request, response) => {
    if (request.url !== '/mcp') {
      response.writeHead(404).end()
      return
    }
    if (request.method !== 'POST') {
      response.writeHead(request.method === 'DELETE' ? 204 : 405).end()
      return
    }
    const chunks: Buffer[] = []
    let length = 0
    request.on('data', (chunk: Buffer) => {
      length += chunk.length
      if (length > 64 * 1_024) request.destroy()
      else chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          id?: string | number
          method?: string
          params?: { name?: string; protocolVersion?: string }
        }
        const method = body.method ?? ''
        calls.push({ method, ...(body.params?.name ? { name: body.params.name } : {}) })
        if (body.id === undefined) {
          response.writeHead(202).end()
          return
        }
        const result = method === 'initialize'
          ? {
              protocolVersion: body.params?.protocolVersion ?? '2025-11-25',
              capabilities: { tools: {} },
              serverInfo: { name: 'pipilot-native-mcp-fixture', version: '1.0.0' },
            }
          : method === 'tools/list'
            ? { tools: [{
                name: NATIVE_MCP_CANARY_TOOL,
                description: 'Return a deterministic read-only packaging canary.',
                inputSchema: { type: 'object', properties: {}, additionalProperties: false },
                annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
              }] }
            : method === 'tools/call' && body.params?.name === NATIVE_MCP_CANARY_TOOL
              ? { content: [{ type: 'text', text: NATIVE_MCP_CANARY_TEXT }] }
              : method === 'ping' ? {} : null
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          ...(result === null
            ? { error: { code: -32601, message: 'Method not found' } }
            : { result }),
        }))
      } catch {
        response.writeHead(400).end()
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    calls,
    async close() {
      const closed = new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
      })
      server.closeAllConnections()
      await closed
    },
  }
}
