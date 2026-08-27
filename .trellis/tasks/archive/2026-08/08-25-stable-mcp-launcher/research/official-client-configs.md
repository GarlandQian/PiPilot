# Official client configuration research

Checked 2026-08-25.

- Codex owns MCP configuration in `~/.codex/config.toml` and supports stdio
  registration through `codex mcp add <name> -- <command>`. Source:
  <https://developers.openai.com/codex/mcp/>.
- Claude Code owns user/project MCP configuration and supports stdio through
  `claude mcp add` or `add-json`. Source:
  <https://docs.anthropic.com/en/docs/claude-code/mcp>.
- `pi-mcp-adapter` reads standard `.mcp.json` and user-global shared JSON, but
  host-specific configuration import is explicit. Source:
  <https://github.com/nicobailon/pi-mcp-adapter/blob/main/README.md>.

Conclusion: PiPilot should output a standard JSON document but not pretend one
physical JSON file is authoritative for all three clients. Client-file mutation
is outside this task.
