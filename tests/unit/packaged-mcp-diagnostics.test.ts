import { describe, expect, it } from 'vitest'
import { packagedMcpDiagnostics } from '../helpers/packaged-mcp-diagnostics'

describe('packaged MCP application diagnostics', () => {
  it('keeps the unavailable diagnostic with the native cache output observed in CI', () => {
    const stderr = '[24114:1014/112536.114782:ERROR:net/disk_cache/blockfile/block_files.cc:445] Failed to open /private/tmp/pipilot-packaged-smoke-mcp/GraphiteDawnCache/data_3\n[PiPilot MCP] PiPilot External Control is unavailable.\n'
    expect(packagedMcpDiagnostics(stderr)).toBe('[PiPilot MCP] PiPilot External Control is unavailable.')
  })

  it('preserves unexpected and repeated application diagnostics so exact assertions fail', () => {
    const lines = [
      '[PiPilot MCP] Headless startup failed.',
      '[PiPilot] Application startup failed.',
      '[PiPilot MCP] Headless startup failed.',
    ]
    expect(packagedMcpDiagnostics(lines.join('\r\n'))).toBe(lines.join('\n'))
  })
})
