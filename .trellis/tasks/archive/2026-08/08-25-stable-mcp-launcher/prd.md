# Stable cross-platform MCP launcher

## Goal

Let a user install one stable `pipilot-mcp` command from PiPilot and copy one
portable JSON configuration without exposing installation paths, descriptor
paths, capability tokens, or platform-specific arguments.

## Background

- External Control already runs as a local stdio MCP child and connects to the
  running PiPilot Main process over a current-user Unix-domain socket on
  macOS/Linux or named pipe on Windows.
- The current copied configuration exposes the packaged executable and
  descriptor as installation-specific absolute paths.
- Codex stores MCP configuration in TOML, Claude Code owns its user/project
  configuration, and `pi-mcp-adapter` reads standard shared JSON. PiPilot will
  not edit those client-owned files in this task.

## Requirements

### Public configuration

- Display and copy exactly one standard JSON document:

  ```json
  {
    "mcpServers": {
      "pipilot": {
        "command": "pipilot-mcp",
        "args": []
      }
    }
  }
  ```

- Keep the shared server-entry contract strict: `command` is exactly
  `pipilot-mcp`, `args` is exactly an empty array, and no `env`, descriptor,
  token, executable path, or unknown field may cross Main/preload/Renderer.
- Do not scan, import, update, remove, or otherwise mutate Codex, Claude Code,
  Pi, shell-client, or project MCP configuration files.

### Launcher installation and removal

- Settings > Integrations > External Control must report whether the stable
  launcher is installed, needs repair, is being installed, or cannot be
  installed safely.
- Installation is an explicit user action. It may create or replace only the
  PiPilot-owned `pipilot-mcp` launcher and its own receipt; it must not silently
  edit third-party client configuration.
- Removal is a separate confirmed user action. It removes only a launcher whose
  current identity and private receipt prove PiPilot ownership; it never disables
  External Control, stops sessions, removes the packaged application, or edits
  client configuration.
- On macOS/Linux, install a small executable wrapper into a secure,
  user-writable directory already present in `PATH`. Prefer a user-owned PATH
  directory and reject relative, symlinked, world-writable, NUL-bearing, or
  otherwise unsafe targets. Do not request administrator privileges or edit
  shell startup files in this task.
- On Windows, use the packaged CUI Electron copy named `pipilot-mcp.exe` and
  register its containing directory in the current user's PATH without
  requiring administrator privileges. Preserve unrelated PATH entries and
  report that the user must sign out and back in before newly launched clients
  inherit the change.
- On Windows, removal keeps the packaged executable and removes only the one
  PiPilot-added application-directory entry from current-user PATH. Preserve the
  registry value type and every unrelated entry, separator, variable, empty
  entry, and whitespace byte-for-byte; verify read-back and restore the original
  value if PATH or receipt cleanup fails.
- Development builds remain unavailable unless a test-only launcher target is
  explicitly injected. Product code must never expose that test seam.
- A stale wrapper caused by moving or replacing the application must be
  detected and repairable by the same action.

### Headless behavior and security

- Invoking the installed launcher with no arguments must enter the existing
  headless MCP path, locate the current user's External Control descriptor
  internally, and never open a BrowserWindow, Dock item, tray, or TCP listener.
- Preserve current descriptor permissions, endpoint/token rotation, bridge
  authentication, bounded stderr, protocol-only stdout, and disabled/stopped
  failure behavior.
- Do not auto-launch the PiPilot GUI when it is stopped or External Control is
  disabled.
- Keep all filesystem, PATH, process, and descriptor work in Electron Main.
  Renderer receives only bounded launcher state and the portable JSON.

### UI

- Extend the existing compact External Control band using current PiPilot
  primitives, tokens, icons, and bilingual locale files.
- Show installation or removal errors next to the launcher action. Confirm
  removal, but do not use a blocking success dialog or global notification.
- Keep light/dark themes, the 1100x680 minimum window, keyboard focus, and
  screen-reader labels intact.

## Acceptance Criteria

- [ ] Ready External Control displays and copies the exact `mcpServers.pipilot`
      JSON above on macOS, Windows, and Linux.
- [ ] Shared validation rejects absolute commands, descriptor arguments,
      `env`, secrets, and unknown configuration fields.
- [ ] A packaged user can explicitly install or repair `pipilot-mcp`; a
      successful result reports installed state and whether clients must
      restart.
- [ ] macOS/Linux installation refuses unsafe/non-PATH targets without editing
      shell profiles or requiring administrator privileges.
- [ ] Windows packages contain `pipilot-mcp.exe` as a CUI entry and user-PATH
      registration preserves unrelated entries.
- [ ] Running `pipilot-mcp` with no arguments completes MCP initialize and tool
      discovery against the enabled GUI bridge.
- [ ] Disabled or stopped PiPilot produces no MCP JSON on stdout, one bounded
      unavailable message on stderr, and exit code 1.
- [ ] Settings provides loading, installed, repair, unsupported, operating, and
      inline error states in English and Simplified Chinese without horizontal
      overflow at 1100x680.
- [ ] A managed installed launcher exposes a confirmed Uninstall action; an
      available but unowned command does not. Removal is idempotent after the
      owned launcher is gone and reports Windows client-restart guidance only
      when PATH changed.
- [ ] PiPilot does not modify any Codex, Claude Code, Pi, `.mcp.json`,
      `config.toml`, or `.claude.json` file.
- [ ] Focused unit, Electron, build, and packaged smoke checks pass; native
      Windows/Linux behavior is verified by their release CI jobs before a
      cross-platform success claim.

## Out Of Scope

- One-click registration with Codex, Claude Code, Pi, or other clients.
- Removing a manually installed same-name command, the Windows packaged
  executable, or any third-party MCP configuration.
- A shared physical configuration file across clients with different native
  formats.
- Administrator-level installation, `/usr/local/bin` mutation, shell-profile
  editing, TCP/HTTP MCP, GUI auto-launch, signing, notarization, or auto-update.
- Legacy compatibility for the previous absolute-path copied configuration;
  version `0.0.1` remains free to adopt the new contract directly.

## Open Questions

None.
