# PiPilot

**English** | [简体中文](README.zh-CN.md)

PiPilot is an Electron desktop client powered by the official
[Pi coding agent](https://github.com/earendil-works/pi) SDK. It embeds the pinned
SDK in project-scoped utility processes and presents sessions, tool calls, file
changes, terminals, models, extensions, Skills, and MCP configuration in a
compact GUI.

PiPilot does not embed a parallel Agent Runtime or migrate Pi data into a
PiPilot-specific format. Pi remains the owner of sessions, configuration, and
resources; PiPilot owns the desktop experience.

> **Project status:** `v0.0.1` is the first public release. The source repository
> and GitHub Release are public. The unsigned installers are distributed for
> manual download after native build and packaged-smoke verification.

[![CI](https://github.com/GarlandQian/PiPilot/actions/workflows/ci.yml/badge.svg)](https://github.com/GarlandQian/PiPilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-2f3437.svg)](LICENSE)

![PiPilot desktop dark interface](.agents/skills/pipilot-ui-style/assets/reference-ui/app-shell-desktop-dark.png)

## Highlights

- **Official embedded Pi Runtime** — runs the pinned official Pi SDK `0.84.2`
  in isolated Electron utility processes while preserving Pi-owned session and
  configuration files.
- **Projects and quick chats** — project directories are explicitly selected
  by the user; projectless conversations are supported without treating the
  home directory as a project.
- **Real Pi sessions** — browse sessions for each project and use connected Pi
  capabilities such as create, open, rename, duplicate, fork, and delete.
- **Full conversation workflow** — Markdown, code blocks, tool calls, Queue,
  Follow-up, Steer, models, and Thinking controls.
- **Commands, Skills, and context** — type `/` to search Commands and Skills;
  type `@` to reference project files or Skills, with keyboard navigation.
- **Developer inspector** — file tree, continuous Changes/Diff, conversation
  outline, and a project terminal.
- **Pi integrations** — inspect and manage Packages, Resources, Extensions,
  Skills, Prompts, and Themes with controlled Pi restarts.
- **MCP management** — edit global `~/.pi/agent/mcp.json` and the active
  project's `.mcp.json` through structured forms or raw JSONC while preserving
  comments and unknown fields.
- **Inbound conversation MCP** — explicitly enable the local-only External
  Control integration in Settings to inspect bounded conversation metadata and
  send exact prompts through a packaged stdio MCP command. It is disabled by
  default, uses an authenticated current-user Unix socket or named pipe, and
  never exposes transcript history, tokens, or filesystem session paths.
- **Model management** — manage Pi `models.json`, custom providers and models,
  defaults, and advanced JSON fields.
- **Desktop-native workflow** — light and dark themes, English and Simplified
  Chinese locales, configurable terminal typography, keyboard access, and a
  supported minimum window size of `1100×680`.

PiPilot is an Electron-only desktop application. A web version is not
supported.

## Principles

1. **Pi owns the data; PiPilot owns the experience.** Sessions, models,
   extensions, and configuration continue to use Pi's official files and
   directories.
2. **Use official capabilities first.** When Pi RPC provides a feature,
   PiPilot connects to that protocol instead of maintaining a parallel Agent
   implementation.
3. **Official Pi SDK first.** PiPilot uses the pinned public Pi SDK and loads
   global and project-level plugins, Skills, and resources from the standard Pi
   environment.
4. **Truthful state.** Empty, loading, ready, and error states are distinct.
   Data from a previous session is never presented as belonging to a newly
   selected session.
5. **A compact desktop tool.** PiPilot keeps a quiet, restrained,
   information-dense developer-tool interface across light, dark, and minimum
   window layouts.

## Development requirements

- macOS, Windows, or Linux
- Node.js `24.18.0` (the version used in project CI)
- pnpm `11.16.0` (the version used in project CI)

Packaged users do not need Node.js, pnpm, or a separate Pi executable.
Development uses the exact Pi SDK version pinned in `package.json` and
`pnpm-lock.yaml`.

## Development

```bash
git clone https://github.com/GarlandQian/PiPilot.git
cd PiPilot
pnpm install --frozen-lockfile
pnpm dev
```

Common checks:

```bash
pnpm typecheck
pnpm test:unit
pnpm build
pnpm test:electron
```

The application is split into Electron Main, a sandboxed preload, and a React
renderer. The renderer does not access Node.js, the filesystem, or Pi directly.
Cross-process data moves through shared Zod contracts and allowlisted IPC.

## Local packaging

```bash
# Unpacked application for the current platform and packaged smoke test
pnpm package:dir
pnpm test:packaged

# Native installers
pnpm package:mac
pnpm package:win
pnpm package:linux
```

Current targets and first-release policy:

| Platform | Architecture | Artifacts | Trust and update policy |
| --- | --- | --- | --- |
| macOS | arm64, x64 | DMG, ZIP | No Developer ID or notarization; manual download and installation |
| Windows | x64 | NSIS | Unsigned; Windows may show SmartScreen or unknown-publisher warnings |
| Linux | x64 | AppImage, DEB | AppImage update support is being validated; DEB is installed manually |

The first macOS release is not signed with an Apple Developer ID and is not
notarized. After downloading it, users may need to right-click the app and
choose **Open**, or explicitly allow it in System Settings. The first Windows
release has no publisher signature and may show a SmartScreen warning. Release
notes and the application must describe these states honestly.

See [docs/PACKAGING.md](docs/PACKAGING.md) for the detailed package boundary
and the latest verified packaging evidence.

## External Control

External Control is a separate inbound MCP surface from Pi's outbound MCP
configuration. It is disabled by default and is enabled from the existing
Settings > Integrations tab. PiPilot can explicitly install or repair one
stable `pipilot-mcp` launcher and shows one portable configuration:

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

The capability token, packaged executable, and descriptor path remain private
to Main and are never placed in copied configuration.

The stdio process does not open the GUI or a network listener. It connects to
the running Main process through a current-user-only local Unix-domain socket
on macOS/Linux or named pipe on Windows. The tool-only MVP provides bounded
conversation listing/status, idempotent prompt and abort receipts, operation
status, and bounded waits. Final responses are limited to the operation that
produced them. Disable closes clients, removes the endpoint, and rotates the
credential; a stopped or disabled app returns a bounded unavailable error. On
macOS/Linux PiPilot only installs into a secure stable user directory already
present in `PATH`. On Windows it registers the packaged `pipilot-mcp.exe`
directory in the current user's PATH without re-encoding Unicode or rebuilding
unrelated entries. Sign out and back in after the first Windows registration so
newly launched clients inherit the updated environment. A launcher proven to
be managed by PiPilot can also be removed after confirmation. Removal leaves
External Control enabled, keeps the packaged Windows executable, and changes
only the owned wrapper/receipt or the one PiPilot-added current-user PATH entry.
PiPilot does not edit Codex, Claude Code, Pi, shell profile, or project MCP
files.

## Releases and updates

The public release flow is:

1. A stable tag such as `v0.0.1` starts a release-owned full verification job.
2. After source, unit, build, integration, and Electron checks pass, macOS,
   Windows, and Linux package, inspect their artifacts, and run packaged
   smoke tests independently.
3. One assembly job rejects duplicate filenames and verifies names, versions,
   SHA-256 checksums, and update metadata package sizes/SHA-512.
4. Actions stages a draft GitHub Release and verifies its complete asset set.
5. The Release becomes public only after all verification, native, packaged
   smoke, final assembly, and staged-asset checks have succeeded. The initial
   repository reset may replace only `v0.0.1`, whose tag must point to the
   repository's single root commit; subsequent releases require a higher version.

The initial `0.0.1` version is installed manually. PiPilot never silently
downloads or installs updates. macOS remains a manual-download path; native
Windows/Linux update actions are enabled only after the official updater path
passes isolated platform tests.

## Pi configuration and data

PiPilot does not scan disks for projects and does not automatically treat the
home directory as a project. A project working directory comes only from the
native folder picker. Projectless chats use an application-private working
directory, while sessions remain under Pi's official session storage.

Common Pi files:

- `~/.pi/agent/mcp.json` — global MCP configuration
- `<project>/.mcp.json` — active-project MCP configuration
- `~/.pi/agent/models.json` — custom providers and models
- `~/.pi/agent/settings.json` — Pi global settings and default model
- `~/.pi/agent/sessions/` — official Pi sessions

Do not commit personal configuration containing API keys, tokens, or real
session content.

## Repository layout

```text
src/main/       Electron Main, Pi Runtime, filesystem, terminal, and config services
src/preload/    sandboxed preload and strict IPC facade
src/shared/     cross-process Zod contracts and domain types
src/renderer/   renderer adapters, projectors, and pure logic
src/components/ React UI
src/store/      renderer providers and state owners
tests/          unit, Electron, integration, and packaged smoke tests
.trellis/       project specifications, tasks, and collaboration workflow
```

## Current development focus

- Validate the first public packages on macOS, Windows, and Linux hardware.
- Continue improving concurrent Pi Session Runtime management and External
  Control operation attribution.
- Continue validating Models, Integrations, inbound/outbound MCP, and
  extension UI against the bundled official Pi SDK.

## Contributing

Read [AGENTS.md](AGENTS.md) and the relevant specifications under
`.trellis/spec/` before changing the project. PiPilot uses pnpm with a frozen
lockfile. Do not commit machine-specific Skill symlinks, user sessions,
credentials, build output, or generated test reports.

## License

[MIT](LICENSE)
