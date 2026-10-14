/** MCP permits diagnostics on stderr; native Chromium logs are not protocol output.
 * Assert PiPilot's own diagnostic contract separately from the JSON-RPC frames,
 * process exit code and bridge lifecycle checked by the packaged test.
 */
export function packagedMcpDiagnostics(stderr: string) {
  return stderr.split(/\r?\n/u)
    .filter((line) => /^\[PiPilot(?: MCP)?\]/u.test(line))
    .join('\n')
}
