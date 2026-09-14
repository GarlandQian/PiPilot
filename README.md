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

> **Project status:** `v0.0.4` is the current stable release; `v0.0.3` was the
> first public release. The source repository and GitHub Releases are public.
> Unsigned installers are distributed for manual download after native build
> and packaged-smoke verification.

[![CI](https://github.com/GarlandQian/PiPilot/actions/workflows/ci.yml/badge.svg)](https://github.com/GarlandQian/PiPilot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-2f3437.svg)](LICENSE)

The current source workbench is being redesigned around conversation-first
navigation; the installed release may still show the earlier interface.

## Highlights

- **Official embedded Pi Runtime** — runs the pinned official Pi SDK `0.85.1`
  in isolated Electron utility processes while preserving Pi-owned session and
  configuration files.
- **Projects and quick chats** — project directories are explicitly selected
  by the user; projectless conversations are supported without treating the
  home directory as a project.
- **Real Pi sessions** — browse sessions for each project and use connected Pi
  capabilities such as create, open, rename, duplicate, fork, and delete.
  Project headings open their workspace directly; adjacent actions create scoped
  sessions. Search, All/Running filters and Recent/Name sorting organize loaded sessions.
  Catalog scans continue beyond 200 sessions in bounded batches and reuse unchanged
  file metadata on refresh. Opening or deleting still revalidates the actual session file.
- **Full conversation workflow** — questions on the right and replies on the left,
  per-response work logs, rendered Markdown in messages, reasoning, notifications,
  queued messages and tool/subagent narratives; code and configuration remain verbatim.
  Code blocks, tool calls, Queue,
  Follow-up, Steer, models, and Thinking controls. Running messages queue by
  default; sending and stopping remain separate actions, and pending images
  and long messages stay inspectable.
  Unsent text, image attachments, and context references stay with their conversation
  when switching sessions. These drafts are held in memory until the application quits.
  Historical work starts collapsed; live work stays open after completion unless
  you close it. Reasoning has its own visible disclosure, separate from tool logs.
  History reloads preserve newer streaming output and use persisted final tool results
  to recover from missed completion events.
  New failures reveal the affected work; notifications and action
  cards remain visible. Long questions expand on demand without hiding attachments.
- **Commands, Skills, and context** — type `/` to search Commands and Skills;
  type `@` to reference project files or Skills, with keyboard navigation.
- **Developer work panel** — switch between files, continuous Changes/Diff,
  and the terminal from the view menu. Open file tabs retain
  their reading state; refresh a preview after external edits or close individual tabs.
  Search and jump between conversation turns from the chat header without replacing
  the file being inspected.
  Tree refresh preserves expansion and selection; search jumps to a file in the continuous diff.
  Terminal status, copy, clear-display and reconnect-after-exit controls retain the live PTY.
- **Pi integrations** — inspect and manage Packages, Resources, Extensions,
  Skills, Prompts, and Themes with guarded Runtime reload. Protected background
  work defers application; reload failure never silently restarts its Host.
- **MCP management** — edit global `~/.pi/agent/mcp.json` and the active
  project's `.mcp.json` through structured forms or raw JSONC while preserving
  comments and unknown fields. Models/MCP drafts survive Settings navigation
  in bounded memory; save and Runtime application have separate outcomes.
- **Inbound conversation MCP** — explicitly enable the local-only External
  Control integration in Settings to inspect bounded conversation metadata and
  send exact prompts through a packaged stdio MCP command. It is disabled by
  default, uses an authenticated current-user Unix socket or named pipe, and
  never exposes transcript history, tokens, or filesystem session paths.
- **Model management** — manage Pi `models.json`, custom providers and models,
  defaults, and advanced JSON fields. Searchable provider details share one form/JSON
  draft; editing configuration invalidates previous connection-test results.
- **Preferences** — searchable navigation, live appearance previews and custom fonts.
  Batched settings report success only after disk persistence and restore saved values
  on failure. Quit waits for in-flight configuration saves and includes unsubmitted
  provider, model, and MCP form edits in its Save/Discard/Cancel confirmation.
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
- pnpm `12.3.4` (the version used in project CI)

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

CI and release builds share `.github/workflows/verify.yml`: unit contracts run
on macOS, Windows, and Linux, and the complete Electron suite runs on macOS.
Integration cases are part of that Electron suite. Provider contracts run the
installed Pi SDK against isolated local HTTP/SSE fixtures for OpenAI Chat
Completions, OpenAI Responses, Anthropic Messages, and Google Generative AI.
They verify streaming, a real file-writing tool, its returned result, and the
next prompt without using a real provider account or the developer's Pi data.

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

Packaged smoke tests default to the current Node architecture. After building
both macOS targets, run each explicitly:

```bash
PIPILOT_PACKAGED_ARCH=arm64 pnpm test:packaged
PIPILOT_PACKAGED_ARCH=x64 pnpm test:packaged
```

The tests check the Mach-O architecture and fail if the requested bundle is
missing; they never substitute the other architecture. Intel execution on
Apple Silicon requires Rosetta. Release CI runs both macOS targets separately.
These smoke tests exercise the unpacked application; they do not claim to test
the complete DMG, NSIS, or DEB installation flow.

Current targets and distribution policy:

| Platform | Architecture | Artifacts | Trust and update policy |
| --- | --- | --- | --- |
| macOS | arm64, x64 | DMG, ZIP | No Developer ID or notarization; manual download and installation |
| Windows | x64 | NSIS | Unsigned; Windows may show SmartScreen or unknown-publisher warnings |
| Linux | x64 | AppImage, DEB | AppImage update support is being validated; DEB is installed manually |

The current macOS release is not signed with an Apple Developer ID and is not
notarized. After downloading it, users may need to right-click the app and
choose **Open**, or explicitly allow it in System Settings. The Windows release
has no publisher signature and may show a SmartScreen warning. Release notes
and the application describe these states honestly.

Build targets and package boundaries are defined in `electron-builder.yml`;
packaged smoke checks live in `tests/packaged/`.

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
macOS, PiPilot places the wrapper in its private application-data directory
and prepends that directory to the current user's launchd PATH, so Finder-launched
clients can resolve the same command after they restart. PiPilot restores this
registration on a later launch only when its private receipt and exact wrapper
still match. Linux uses a secure stable user directory already present in
`PATH`. Windows registers the packaged `pipilot-mcp.exe` directory in the
current user's PATH without re-encoding Unicode or rebuilding unrelated entries.
Sign out and back in after the first Windows registration so newly launched
clients inherit the updated environment. A launcher proven to be managed by
PiPilot can also be removed after confirmation. Removal leaves External Control
enabled, keeps the packaged Windows executable, and changes only PiPilot's
owned wrapper, receipt, and current-user PATH registration. PiPilot does not
edit Codex, Claude Code, Pi, shell profile, or project MCP files.

## Releases and updates

The public release flow is:

1. A stable tag such as `v0.0.4` starts a release-owned full verification job.
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

PiPilot never silently downloads or installs updates. macOS remains a
manual-download path; native Windows/Linux update actions are enabled only
after the official updater path passes isolated platform tests.

## Pi configuration and data

PiPilot does not scan disks for projects and does not automatically treat the
home directory as a project. A project working directory comes only from the
native folder picker. Projectless chats use an application-private working
directory, while sessions remain under Pi's official session storage.

The default Agent directory is `~/.pi/agent`. When `PI_CODING_AGENT_DIR` is set,
the runtime, package manager, model editor, and global MCP editor all use that
same directory. PiPilot does not import these files into a private database.

Common files at the default location:

- `~/.pi/agent/mcp.json` — global MCP configuration
- `<project>/.mcp.json` — active-project MCP configuration
- `~/.pi/agent/models.json` — custom providers and models
- `~/.pi/agent/settings.json` — Pi global settings and default model
- `~/.pi/agent/auth.json` — Pi authentication, owned by the Pi SDK
- `<project>/.pi/settings.json` — Pi project settings
- `~/.pi/agent/sessions/` — official Pi sessions

MCP files follow PiPilot's extension convention; Pi core does not define an
MCP configuration format. Appearance, navigation and window preferences remain
in Electron's application data directory, separate from Pi configuration.

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
```

## Current development focus

- Validate the first public packages on macOS, Windows, and Linux hardware.
- Continue improving concurrent Pi Session Runtime management and External
  Control operation attribution.
- Continue validating Models, Integrations, inbound/outbound MCP, and
  extension UI against the bundled official Pi SDK.

## Contributing

Read the relevant implementation and tests before changing the project.
PiPilot uses pnpm with a frozen lockfile. Do not commit user sessions, credentials,
build output, or generated test reports.

## License

[MIT](LICENSE)
